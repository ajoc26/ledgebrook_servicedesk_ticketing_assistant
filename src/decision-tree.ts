export const categories = [
  { value: 'incident', label: 'Incident / security event', issueKind: 'incident' },
  { value: 'access', label: 'Access request', issueKind: 'service' },
  { value: 'software', label: 'Software request', issueKind: 'service' },
  { value: 'hardware', label: 'Hardware / device request', issueKind: 'service' },
  { value: 'data', label: 'Data / reporting request', issueKind: 'service' },
  { value: 'howto', label: 'How-to / technical support', issueKind: 'service' },
  { value: 'idea', label: 'New feature / idea', issueKind: 'service' },
  { value: 'unsure', label: 'Not sure — guide me', issueKind: 'service' },
] as const;
export type Category = (typeof categories)[number]['value'];
export const categoryGuidance: Record<Category, string> = {
  incident: 'Describe what is happening, when it started, who or what is affected, business impact, errors/links, and any workaround. Do not wait to determine severity.',
  access: 'Include system/resource, requested role, environment, business justification, temporary end date if relevant, and approver if known.',
  software: 'Include software/version, device/OS, business justification, license status, and required-by date.',
  hardware: 'Include equipment or environment needed. If something is broken, describe the failure and impact.',
  data: 'Include the data/report, business purpose, population/date range, delivery format, and privacy/security considerations.',
  howto: 'Include steps followed, expected result, actual result, and relevant error text or links.',
  idea: 'Describe today’s situation, proposed change, and expected benefit.',
  unsure: 'Describe what you need. Service Desk can redirect the request if needed.',
};
export function getCategory(value: string) { return categories.find((category) => category.value === value); }
