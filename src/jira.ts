import { config } from './config';
import { normalizeSummary } from './normalize';
export interface JiraIssue { id: string; key: string; fields?: { summary?: string } }
interface SearchPage { issues?: JiraIssue[]; total?: number }
function authHeader(): string {
  return `Basic ${Buffer.from(`${config.jiraUserEmail}:${config.jiraApiToken}`).toString('base64')}`;
}
async function jiraRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${config.jiraBaseUrl}${path}`, {
    ...init, signal: AbortSignal.timeout(20_000),
    headers: { Authorization: authHeader(), Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Jira API ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  return response.json() as Promise<T>;
}
/** Pages through every open LSD issue, then applies an exact normalized-summary comparison. */
export async function findOpenIssueByNormalizedSummary(normalizedSummary: string): Promise<JiraIssue | undefined> {
  const jql = `project = "${config.jiraProjectKey}" AND statusCategory != Done ORDER BY created DESC`;
  let startAt = 0;
  let total = Number.POSITIVE_INFINITY;
  while (startAt < total) {
    const params = new URLSearchParams({ jql, startAt: String(startAt), maxResults: '100', fields: 'summary' });
    const page = await jiraRequest<SearchPage>(`/rest/api/3/search?${params}`);
    const issues = page.issues ?? [];
    total = page.total ?? startAt + issues.length;
    const match = issues.find((issue) => typeof issue.fields?.summary === 'string' && normalizeSummary(issue.fields.summary) === normalizedSummary);
    if (match) return match;
    if (!issues.length) break;
    startAt += issues.length;
  }
  return undefined;
}
function toAdf(text: string): Record<string, unknown> {
  return { type: 'doc', version: 1, content: text.split(/\r?\n/u).map((line) => ({
    type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [],
  })) };
}
export async function createLsdIssue(input: { summary: string; description: string; issueTypeId: string }): Promise<JiraIssue> {
  return jiraRequest<JiraIssue>('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields: {
    project: { id: config.jiraProjectId }, issuetype: { id: input.issueTypeId }, summary: input.summary, description: toAdf(input.description),
  } }) });
}
export function issueUrl(key: string): string { return `${config.jiraBaseUrl}/browse/${encodeURIComponent(key)}`; }
