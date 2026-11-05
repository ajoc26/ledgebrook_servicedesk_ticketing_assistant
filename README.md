# Ledgebrook Service Desk Slack app

Fresh Slack Bolt app for `/servicedesk` intake into Jira Service Desk (`LSD`, project ID `10179`). It uses the decision-tree rules from the [Ledgebrook Service Desk Ticket Decision Tree](https://ledgebrook.atlassian.net/wiki/spaces/KB/pages/1722187783/Ledgebrook+Service+Desk+Ticket+Decision+Tree). It does not call Glean or Confluence at runtime; the source page is linked from the form and its routing logic is represented in `src/decision-tree.ts`.

## Behavior

- Any authenticated member of the configured Ledgebrook Slack workspace can submit.
- The explicit **Submit Ticket** modal action creates the ticket directly; no second approval step.
- Incidents/security events use the configured Incident Jira issue type and are posted to the configured incidents channel. Other decision-tree categories use the configured Service Request issue type.
- Before creation, all non-Done LSD tickets are paged and summaries are compared exactly after NFKC normalization, lowercasing, trimming, and whitespace collapse. Punctuation remains significant.
- Redis holds per-modal idempotency markers and distributed summary locks. If Jira creation times out after a request may have reached Jira, the app fails closed to avoid a duplicate.

## Prerequisites

- Node.js 20+ and Redis.
- A Slack app installed in the Ledgebrook workspace with `commands` and `chat:write` bot scopes. Add `/servicedesk` with Request URL `https://YOUR_HOST/slack/events`. The bot must be able to post in the incidents channel.
- A Jira Cloud integration account with browse/create permissions for LSD. Issues are created under this integration account; the Slack submitter ID is recorded in the issue description.
- Confirm the Incident and Service Request issue type IDs in LSD and set them in the environment. IDs are deliberately not guessed.

## Run

```sh
cp .env.example .env
# Fill in all required values in .env
npm install
npm test
npm run dev
```

Expose the local server through approved HTTPS ingress and point Slack to `/slack/events`. Never commit `.env` or secrets.

## Production

Build with `npm install && npm run build`; run with `npm start`. Use persistent Redis, HTTPS ingress, managed secrets, monitoring, and a process supervisor/container platform. Update `src/decision-tree.ts` when the Confluence decision-tree guidance changes, then review and redeploy.
