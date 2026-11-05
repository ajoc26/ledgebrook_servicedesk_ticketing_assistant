import { App, ExpressReceiver } from '@slack/bolt';
import Redis from 'ioredis';
import { config } from './config';
import { categories, categoryGuidance, getCategory, type Category } from './decision-tree';
import { issueUrl } from './jira';
import { submitToServiceDesk } from './submission';
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
redis.on('error', (error) => console.error('Redis connection error', error.message));
const receiver = new ExpressReceiver({ signingSecret: config.slackSigningSecret, endpoints: '/slack/events' });
receiver.router.get('/healthz', (_req, res) => res.status(200).send('ok'));
const app = new App({ token: config.slackBotToken, receiver });
function option(value: string, label: string) { return { text: { type: 'plain_text' as const, text: label }, value }; }
function intakeModal(channelId: string, selectedCategory: Category = 'unsure', summary = '', details = '', requiredBy = ''): any {
  const selected = categories.find((category) => category.value === selectedCategory) ?? categories[7];
  return {
    type: 'modal', callback_id: 'servicedesk_submit', private_metadata: JSON.stringify({ channelId }),
    title: { type: 'plain_text', text: 'Service Desk' }, submit: { type: 'plain_text', text: 'Submit Ticket' }, close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'input', block_id: 'category_block', dispatch_action: true, label: { type: 'plain_text', text: 'What do you need help with?' }, element: {
        type: 'static_select', action_id: 'category', placeholder: { type: 'plain_text', text: 'Choose a request type' },
        options: categories.map((c) => option(c.value, c.label)), initial_option: option(selected.value, selected.label),
      } },
      { type: 'input', block_id: 'summary_block', label: { type: 'plain_text', text: 'Short title' }, element: {
        type: 'plain_text_input', action_id: 'summary', max_length: 200, ...(summary ? { initial_value: summary } : {}), placeholder: { type: 'plain_text', text: 'For example: Production quote workflow unavailable' },
      } },
      { type: 'input', block_id: 'details_block', label: { type: 'plain_text', text: 'Details' }, hint: {
        type: 'plain_text', text: `${categoryGuidance[selected.value]} Do not include passwords, secrets, or API tokens.`,
      }, element: { type: 'plain_text_input', action_id: 'details', multiline: true, max_length: 3000, ...(details ? { initial_value: details } : {}), placeholder: {
        type: 'plain_text', text: 'Add the information needed to route and resolve your request.',
      } } },
      { type: 'input', block_id: 'required_by_block', optional: true, label: { type: 'plain_text', text: 'Required-by date (optional)' }, element: {
        type: 'datepicker', action_id: 'required_by', ...(requiredBy ? { initial_date: requiredBy } : {}), placeholder: { type: 'plain_text', text: 'Select a date' },
      } },
      { type: 'section', block_id: 'decision_tree_help', text: { type: 'mrkdwn', text: `Use one ticket per request. If unsure, submit your best description and Service Desk can redirect it. <${config.decisionTreeUrl}|Open the full decision tree>.` } },
    ],
  };
}
function inputText(view: any, blockId: string, actionId: string): string {
  return view.state.values[blockId]?.[actionId]?.value ?? '';
}
app.command('/servicedesk', async ({ ack, command, client }) => {
  await ack();
  if (command.team_id !== config.slackTeamId) {
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: 'This Service Desk app is available only in the Ledgebrook Slack workspace.' });
    return;
  }
  try { await client.views.open({ trigger_id: command.trigger_id, view: intakeModal(command.channel_id) }); }
  catch (error) {
    console.error('Unable to open Service Desk modal', error);
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: 'I could not open the request form. Please try /servicedesk again.' });
  }
});
app.action('category', async ({ ack, body, action, client }) => {
  await ack();
  const currentView = (body as any).view;
  const selectedValue = (action as any).selected_option?.value;
  const selectedCategory = getCategory(String(selectedValue ?? 'unsure'));
  if (!currentView || !selectedCategory || (body as any).team?.id !== config.slackTeamId) return;
  let channelId = '';
  try { channelId = JSON.parse(currentView.private_metadata || '{}').channelId ?? ''; } catch { return; }
  const values = currentView.state.values;
  const summary = values.summary_block?.summary?.value ?? '';
  const details = values.details_block?.details?.value ?? '';
  const requiredBy = values.required_by_block?.required_by?.selected_date ?? '';
  await client.views.update({
    view_id: currentView.id,
    hash: currentView.hash,
    view: intakeModal(channelId, selectedCategory.value, summary, details, requiredBy),
  });
});

app.view('servicedesk_submit', async ({ ack, body, view, client, logger }) => {
  await ack();
  const categoryValue = view.state.values.category_block?.category?.selected_option?.value ?? 'unsure';
  const category = getCategory(categoryValue);
  let channelId = '';
  try { channelId = JSON.parse(view.private_metadata || '{}').channelId ?? ''; } catch { logger.error('Invalid Service Desk modal metadata'); }
  if (body.team?.id !== config.slackTeamId || !category || !channelId) { logger.error('Rejected invalid workspace/form metadata'); return; }
  const userId = body.user.id;
  const summary = inputText(view, 'summary_block', 'summary');
  const details = inputText(view, 'details_block', 'details');
  const requiredBy = view.state.values.required_by_block?.required_by?.selected_date ?? undefined;
  try {
    const result = await submitToServiceDesk(redis, { teamId: body.team.id, userId, viewId: view.id, category: category.value as Category, summary, details, requiredBy });
    if (result.kind === 'created') {
      try {
        await client.chat.postEphemeral({ channel: channelId, user: userId, text: `Ticket created: <${result.url}|${result.key}>.` });
      } catch (notifyError) {
        logger.error(`Ticket ${result.key} was created, but the submitter notification failed: ${String(notifyError)}`);
      }
      if (category.issueKind === 'incident') {
        try {
          await client.chat.postMessage({ channel: config.incidentsChannelId, text: `New Service Desk incident: <${result.url}|${result.key}> — ${summary}`, unfurl_links: false, unfurl_media: false });
        } catch (notifyError) {
          logger.error(`Ticket ${result.key} was created, but incident-channel notification failed: ${String(notifyError)}`);
        }
      }
    } else if (result.kind === 'duplicate') {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: `I found an open ticket with the same normalized summary: <${result.url}|${result.key}>. Please add information to that ticket instead of creating a duplicate.` });
    } else if (result.kind === 'in_progress') {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'This request is already being processed or an identical summary is being submitted. Please wait and check again before retrying.' });
    } else {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'The request is missing a required title, category, or details. Please reopen /servicedesk and try again.' });
    }
  } catch (error) {
    logger.error(`Service Desk submission failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'I could not confirm whether Jira accepted this ticket. To avoid a duplicate, please do not resubmit immediately; contact Service Desk if no ticket appears.' });
  }
});
app.error(async (error) => console.error('Slack Bolt error', error));
async function main() { await redis.ping(); await app.start(config.slackPort); console.log(`Service Desk app listening on port ${config.slackPort}`); }
main().catch((error) => { console.error('Failed to start app', error); process.exit(1); });
