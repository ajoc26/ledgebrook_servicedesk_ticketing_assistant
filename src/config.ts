import 'dotenv/config';
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function port(): number {
  const value = Number(process.env.SLACK_PORT ?? '3000');
  if (!Number.isInteger(value) || value <= 0) throw new Error('SLACK_PORT must be a positive integer');
  return value;
}
export const config = {
  slackBotToken: required('SLACK_BOT_TOKEN'),
  slackSigningSecret: required('SLACK_SIGNING_SECRET'),
  slackTeamId: required('SLACK_TEAM_ID'),
  slackPort: port(),
  incidentsChannelId: required('SLACK_INCIDENTS_CHANNEL_ID'),
  jiraBaseUrl: required('JIRA_BASE_URL').replace(/\/$/, ''),
  jiraUserEmail: required('JIRA_USER_EMAIL'),
  jiraApiToken: required('JIRA_API_TOKEN'),
  jiraProjectKey: process.env.JIRA_PROJECT_KEY?.trim() || 'LSD',
  jiraProjectId: process.env.JIRA_PROJECT_ID?.trim() || '10179',
  jiraIncidentIssueTypeId: required('JIRA_INCIDENT_ISSUE_TYPE_ID'),
  jiraServiceRequestIssueTypeId: required('JIRA_SERVICE_REQUEST_ISSUE_TYPE_ID'),
  redisUrl: required('REDIS_URL'),
  decisionTreeUrl: process.env.DECISION_TREE_URL?.trim() || 'https://ledgebrook.atlassian.net/wiki/spaces/KB/pages/1722187783/Ledgebrook+Service+Desk+Ticket+Decision+Tree',
};
