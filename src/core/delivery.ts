// Share normalization between editor checks and queue recovery, without storing draft text.
export const normalizeDraft = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
export function draftFingerprint(text: string): string {
  const normalized = normalizeDraft(text);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
  return `${normalized.length}:${(hash >>> 0).toString(16)}`;
}
