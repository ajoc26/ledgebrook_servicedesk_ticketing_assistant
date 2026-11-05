import { createHash } from 'node:crypto';
/** Case-insensitive NFKC normalization with trim/whitespace collapse; punctuation remains significant. */
export function normalizeSummary(summary: string): string {
  return summary.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/gu, ' ');
}
export function summaryHash(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}
