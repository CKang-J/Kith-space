const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i,
];

export function containsSecretShapedText(values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === "string" && SECRET_PATTERNS.some((pattern) => pattern.test(value)));
}
