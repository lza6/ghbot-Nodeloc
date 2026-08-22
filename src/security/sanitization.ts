/**
 * Shared sanitization policy for untrusted repository content that may enter
 * an agent workspace or a protected path check. Single source of truth used by
 * both the PR-chat snapshot copier and the conflict-resolution path validator.
 */

export const PROTECTED_DIRECTORIES = new Set([
  ".git",
  ".ghbot",
  ".goose",
  ".opencode",
  ".agents",
  ".claude",
  ".codex",
  ".cursor"
]);

export const PROTECTED_FILE_NAMES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  ".goosehints",
  ".cursorrules",
  ".windsurfrules",
  "opencode.json",
  "opencode.jsonc",
  // Deployment / provider configuration that can carry secrets or exfiltrate data.
  "vercel.json",
  "netlify.toml",
  "wrangler.toml",
  "wrangler.json",
  "railway.json"
]);

export const PROTECTED_FILE_PREFIXES = [".env"];

export function isProtectedBasename(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (PROTECTED_FILE_NAMES.has(lower)) {
    return true;
  }
  return PROTECTED_FILE_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}.`)
  );
}

export function hasProtectedSegment(segments: readonly string[]): boolean {
  return segments.some(
    (segment) => segment !== "" && PROTECTED_DIRECTORIES.has(segment.toLowerCase())
  );
}
