import fs from "node:fs/promises";
import path from "node:path";
import { containsSecret } from "../security/secrets.js";

export const REPOSITORY_KNOWLEDGE_CACHE_PATH = ".ghbot-knowledge/repository.md";
export const REPOSITORY_KNOWLEDGE_SCRATCH_PATH = ".ghbot/repository-knowledge.md";
export const MAX_REPOSITORY_KNOWLEDGE_BYTES = 32 * 1024;

const EMPTY_KNOWLEDGE = `# ghbot repository knowledge

Record only verified, durable facts about this repository, such as architecture,
supported environments, test commands, conventions, and recurring pitfalls.
The repository can evolve. Revise or remove entries when newer code or verified
results show that earlier knowledge is outdated, replaced, or no longer true.
Never record credentials, tokens, private keys, personal data, or temporary PR state.
`;

export async function loadRepositoryKnowledge(
  runtimeDirectory: string = process.cwd()
): Promise<string> {
  try {
    const content = await fs.readFile(
      path.join(runtimeDirectory, REPOSITORY_KNOWLEDGE_CACHE_PATH),
      "utf8"
    );
    validateRepositoryKnowledge(content);
    return normalizeKnowledge(content);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    const initial = normalizeKnowledge(EMPTY_KNOWLEDGE);
    await saveRepositoryKnowledgeCache(initial, runtimeDirectory);
    return initial;
  }
}

export async function writeKnowledgeScratch(snapshot: string, content: string): Promise<void> {
  validateRepositoryKnowledge(content);
  const target = path.join(snapshot, REPOSITORY_KNOWLEDGE_SCRATCH_PATH);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.chmod(path.dirname(target), 0o777);
  await fs.writeFile(target, normalizeKnowledge(content), "utf8");
  await fs.chmod(target, 0o666);
}

export async function readKnowledgeScratch(snapshot: string): Promise<string> {
  const content = await fs.readFile(path.join(snapshot, REPOSITORY_KNOWLEDGE_SCRATCH_PATH), "utf8");
  validateRepositoryKnowledge(content);
  return normalizeKnowledge(content);
}

export async function saveRepositoryKnowledgeCache(
  content: string,
  runtimeDirectory: string = process.cwd()
): Promise<void> {
  validateRepositoryKnowledge(content);
  const target = path.join(runtimeDirectory, REPOSITORY_KNOWLEDGE_CACHE_PATH);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, normalizeKnowledge(content), "utf8");
}

export function validateRepositoryKnowledge(content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0 || bytes > MAX_REPOSITORY_KNOWLEDGE_BYTES) {
    throw new Error(`Repository knowledge must contain 1-${MAX_REPOSITORY_KNOWLEDGE_BYTES} bytes.`);
  }
  if (content.includes("\0")) {
    throw new Error("Repository knowledge must be plain text.");
  }

  if (containsSecret(content)) {
    throw new Error("Repository knowledge appears to contain a credential or private key.");
  }
}

/**
 * Normalize repository knowledge to a stable LF line-ending form so a
 * knowledge round trip through git checkouts, editors, or the agent
 * scratch directory is byte-identical on every platform.
 */
export function normalizeKnowledge(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return `${normalized}\n`;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
