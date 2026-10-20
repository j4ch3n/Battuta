// Conservative best-effort redaction; callers also validate extracted output.
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED:private-key]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{8,}|[0-9]{6,}:[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|lin_api_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]+)\b/g,
      "[REDACTED:token]",
    )
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:[A-Za-z][A-Za-z0-9_]*_)?(?:password|passwd|pwd|api[ _-]?key|api[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|client[ _-]?secret|private[ _-]?key|secret[ _-]?key|token)['"]?\s*(?:(?:is(?: set to)?|was(?: set to)?|equals)\s+|[=:]\s*)[^\r\n]+/gi,
      "[REDACTED:credential]",
    );
}
