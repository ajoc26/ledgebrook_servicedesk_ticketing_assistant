import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { config } from './config';
import { getCategory, type Category } from './decision-tree';
import { createLsdIssue, findOpenIssueByNormalizedSummary, issueUrl } from './jira';
import { normalizeSummary, summaryHash } from './normalize';
export interface IntakeSubmission { teamId: string; userId: string; viewId: string; category: Category; summary: string; details: string; requiredBy?: string }
export type SubmissionResult = { kind: 'created' | 'duplicate'; key: string; url: string } | { kind: 'in_progress' | 'invalid' };
const submissionTtl = 86400;
const releaseScript = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
export async function submitToServiceDesk(redis: Redis, input: IntakeSubmission): Promise<SubmissionResult> {
  const category = getCategory(input.category);
  const summary = input.summary.trim();
  const details = input.details.trim();
  if (!category || !summary || !details) return { kind: 'invalid' };
  const normalized = normalizeSummary(summary);
  if (!normalized) return { kind: 'invalid' };

  const submitKey = `sd:submit:${input.teamId}:${input.userId}:${input.viewId}`;
  const submitToken = randomUUID();
  if (await redis.set(submitKey, `PROCESSING:${submitToken}`, 'EX', submissionTtl, 'NX') !== 'OK') {
    const previous = await redis.get(submitKey);
    if (previous?.startsWith('DONE:')) { const key = previous.slice(5); return { kind: 'created', key, url: issueUrl(key) }; }
    if (previous?.startsWith('DUPLICATE:') && previous !== 'DUPLICATE:IN_FLIGHT') {
      const key = previous.slice('DUPLICATE:'.length); return { kind: 'duplicate', key, url: issueUrl(key) };
    }
    return { kind: 'in_progress' };
  }

  const hash = summaryHash(normalized);
  const lockKey = `sd:summary-lock:${hash}`;
  const successKey = `sd:summary-success:${hash}`;
  const lockToken = randomUUID();
  if (await redis.set(lockKey, lockToken, 'EX', 120, 'NX') !== 'OK') {
    const existing = await redis.get(successKey);
    await redis.set(submitKey, existing ? `DUPLICATE:${existing}` : 'DUPLICATE:IN_FLIGHT', 'EX', submissionTtl);
    return existing ? { kind: 'duplicate', key: existing, url: issueUrl(existing) } : { kind: 'in_progress' };
  }

  let createAttempted = false;
  try {
    const recentSuccess = await redis.get(successKey);
    if (recentSuccess) {
      await redis.set(submitKey, `DUPLICATE:${recentSuccess}`, 'EX', submissionTtl);
      return { kind: 'duplicate', key: recentSuccess, url: issueUrl(recentSuccess) };
    }
    const existing = await findOpenIssueByNormalizedSummary(normalized);
    if (existing) {
      await redis.set(submitKey, `DUPLICATE:${existing.key}`, 'EX', submissionTtl);
      return { kind: 'duplicate', key: existing.key, url: issueUrl(existing.key) };
    }
    const description = [
      `Category: ${category.label}`, `Submitted by Slack user: ${input.userId}`, '', 'Request details:', details,
      ...(input.requiredBy ? ['', `Required by: ${input.requiredBy}`] : []), '', 'Source: Ledgebrook Service Desk Ticket Decision Tree', config.decisionTreeUrl,
      '', 'Do not include passwords, secrets, API tokens, or other credentials.',
    ].join('\n');
    createAttempted = true;
    const issue = await createLsdIssue({ summary, description, issueTypeId: category.issueKind === 'incident' ? config.jiraIncidentIssueTypeId : config.jiraServiceRequestIssueTypeId });
    await redis.set(submitKey, `DONE:${issue.key}`, 'EX', submissionTtl);
    await redis.set(successKey, issue.key, 'EX', 300);
    return { kind: 'created', key: issue.key, url: issueUrl(issue.key) };
  } catch (error) {
    // Keep the form idempotency marker after an uncertain Jira create call; fail closed to avoid duplicates.
    if (!createAttempted) await redis.del(submitKey);
    throw error;
  } finally {
    await redis.eval(releaseScript, 1, lockKey, lockToken);
  }
}
