// Masks secrets in an agent's report before the main session reads it: the inspector
// masks by instruction, this is the backstop. Hashes, ids and $VARIABLES stay as they are.

// A value starting with $ or * is a variable or already masked.
const VALUE = String.raw`(?![$*])`
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***'],
  [/(?<![\w-])sk-[\w-]{32,}/g, '***'],
  [/(?<!\w)(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})/g, '***'],
  [/(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g, '***'],
  [/(?<![\w-])xox[bpas]-[A-Za-z0-9-]{10,}/g, '***'],
  [new RegExp(String.raw`(Authorization:\s*Bearer\s+)${VALUE}[\w.~+/=-]{8,}`, 'gi'), '$1***'],
  // Only the password of a user:password@host link.
  [new RegExp(String.raw`(\b[a-z][\w+.-]*://[^\s:@/]+:)${VALUE}[^\s@/]+(?=@)`, 'gi'), '$1***'],
  [new RegExp(String.raw`((?<![A-Za-z0-9])(?:password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*["']?)${VALUE}[^\s"'&,;]{8,}`, 'gi'), '$1***'],
]

export function redact(text: string): string {
  return SECRETS.reduce((done, [pattern, to]) => done.replace(pattern, to), text)
}
