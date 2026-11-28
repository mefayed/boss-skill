// Masks secrets in an agent's report before the main session reads it: the inspector
// masks by instruction, this is the backstop. Hashes, ids and $VARIABLES stay as they are.

// A value starting with $ or * is a variable or already masked; <redacted>, [hidden], {{KEY}} and
// a bare REDACTED or xxxxxxxx are placeholders an agent wrote, not secrets.
const VALUE = String.raw`(?![$*<\[{]|(?:redacted|hidden|x{8,})(?![\w-]))`
// Each with the kind the person is told was hidden, in plain words.
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'a private key'],
  [/(?<![\w-])sk-[\w-]{32,}/g, 'an API key'],
  [/(?<!\w)(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})/g, 'a GitHub token'],
  [/(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g, 'an AWS key'],
  [/(?<![\w-])xox[bpas]-[A-Za-z0-9-]{10,}/g, 'a Slack token'],
  [new RegExp(String.raw`(Authorization:\s*Bearer\s+)${VALUE}[\w.~+/=-]{8,}`, 'gi'), 'an access token'],
  // Only the password of a user:password@host link.
  [new RegExp(String.raw`(\b[a-z][\w+.-]*://[^\s:@/]+:)${VALUE}[^\s@/]+(?=@)`, 'gi'), 'a password in a link'],
  [new RegExp(String.raw`((?<![A-Za-z0-9])(?:password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*["']?)${VALUE}[^\s"'&,;]{8,}`, 'gi'), 'a password or key'],
]

// Masks each secret, keeping the label before it (Bearer, password=), and adds what it hid to `found`.
export function redact(text: string, found: { kind: string; value: string }[] = []): string {
  return SECRETS.reduce((done, [pattern, kind]) => done.replace(pattern, (match, label: unknown) => {
    const keep = typeof label === 'string' ? label : ''
    found.push({ kind, value: match.slice(keep.length) })
    return `${keep}***`
  }), text)
}
