import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger.js";
import {
  REPOSITORY_KNOWLEDGE_CACHE_PATH,
  validateRepositoryKnowledge
} from "../repository/knowledge.js";
import { parseReviewCacheContent } from "../review/cache.js";
import { downloadR2Object, isR2Configured, uploadR2Object } from "./r2.js";

const MAX_REVIEW_CACHE_BYTES = 256 * 1024;

export type PersistentObjectStore = {
  download: (key: string) => Promise<Buffer | undefined>;
  upload: (params: { key: string; body: Uint8Array; contentType: string }) => Promise<void>;
};

const r2Store: PersistentObjectStore = {
  download: downloadR2Object,
  upload: uploadR2Object
};

export function repositoryKnowledgeObjectKey(repositoryId: string, prefix?: string): string {
  return `${repositoryObjectPrefix(repositoryId, prefix)}/knowledge/repository.md`;
}

export function pullRequestReviewObjectKey(
  repositoryId: string,
  pullNumber: number,
  prefix?: string
): string {
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("Pull request number must be a positive integer.");
  }
  return `${repositoryObjectPrefix(repositoryId, prefix)}/pulls/${pullNumber}/latest.json`;
}

export function pullRequestReviewHistoryObjectKey(
  repositoryId: string,
  pullNumber: number,
  headSha: string,
  prefix?: string
): string {
  if (!/^[0-9a-f]{40,64}$/i.test(headSha)) {
    throw new Error("Review head SHA must contain 40-64 hexadecimal characters.");
  }
  return `${repositoryObjectPrefix(repositoryId, prefix)}/pulls/${pullNumber}/reviews/${headSha.toLowerCase()}.json`;
}

export async function restorePersistentCache(params: {
  repositoryId: string;
  owner: string;
  repo: string;
  pullNumber?: number;
  runtimeDirectory?: string;
  prefix?: string;
  storage?: PersistentObjectStore;
}): Promise<void> {
  if (!params.storage && !isR2Configured()) {
    return;
  }
  const runtimeDirectory = params.runtimeDirectory ?? process.cwd();
  const storage = params.storage ?? r2Store;

  await restoreObject({
    key: repositoryKnowledgeObjectKey(params.repositoryId, params.prefix),
    target: path.join(runtimeDirectory, REPOSITORY_KNOWLEDGE_CACHE_PATH),
    validate: (content) => validateRepositoryKnowledge(content.toString("utf8")),
    storage
  });

  if (params.pullNumber) {
    await restoreObject({
      key: pullRequestReviewObjectKey(params.repositoryId, params.pullNumber, params.prefix),
      target: reviewCacheFilePath(params.pullNumber, runtimeDirectory),
      validate: (content) => validateReviewBuffer(content, params),
      storage
    });
  }
}

export async function savePersistentCache(params: {
  repositoryId: string;
  owner: string;
  repo: string;
  saveRepositoryKnowledge: boolean;
  pullNumber?: number;
  runtimeDirectory?: string;
  prefix?: string;
  storage?: PersistentObjectStore;
}): Promise<void> {
  if (!params.storage && !isR2Configured()) {
    return;
  }
  const runtimeDirectory = params.runtimeDirectory ?? process.cwd();
  const storage = params.storage ?? r2Store;

  if (params.saveRepositoryKnowledge) {
    await saveObjectIfPresent({
      key: repositoryKnowledgeObjectKey(params.repositoryId, params.prefix),
      source: path.join(runtimeDirectory, REPOSITORY_KNOWLEDGE_CACHE_PATH),
      contentType: "text/markdown; charset=utf-8",
      validate: (content) => validateRepositoryKnowledge(content.toString("utf8")),
      storage
    });
  }

  if (params.pullNumber) {
    const source = reviewCacheFilePath(params.pullNumber, runtimeDirectory);
    let reviewContent: Buffer | undefined;
    await saveObjectIfPresent({
      key: pullRequestReviewObjectKey(params.repositoryId, params.pullNumber, params.prefix),
      source,
      contentType: "application/json; charset=utf-8",
      validate: (content) => validateReviewBuffer(content, params),
      storage,
      afterRead: (content) => {
        reviewContent = content;
      }
    });
    if (reviewContent) {
      const cached = parseReviewCacheContent(reviewContent.toString("utf8"));
      await storage.upload({
        key: pullRequestReviewHistoryObjectKey(
          params.repositoryId,
          params.pullNumber,
          cached.headSha,
          params.prefix
        ),
        body: reviewContent,
        contentType: "application/json; charset=utf-8"
      });
    }
  }
}

function repositoryObjectPrefix(repositoryId: string, prefix?: string): string {
  if (!/^\d+$/.test(repositoryId)) {
    throw new Error(
      "Repository id must contain only digits before it can be used in an R2 object key."
    );
  }
  const normalizedPrefix = normalizeObjectPrefix(prefix);
  return `${normalizedPrefix ? `${normalizedPrefix}/` : ""}repositories/${repositoryId}`;
}

export function normalizeObjectPrefix(value: string | undefined): string {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (!normalized) {
    return "";
  }
  if (
    !normalized.split("/").every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment))
  ) {
    throw new Error("R2_PREFIX must contain only safe slash-separated object-key segments.");
  }
  return normalized;
}

function reviewCacheFilePath(pullNumber: number, runtimeDirectory: string): string {
  return path.join(runtimeDirectory, ".ghbot-cache", `pr-${pullNumber}.json`);
}

async function restoreObject(params: {
  key: string;
  target: string;
  validate: (content: Buffer) => void;
  storage: PersistentObjectStore;
}): Promise<void> {
  const content = await params.storage.download(params.key);
  if (!content) {
    logger.info({ key: params.key }, "No persistent R2 cache object was found.");
    return;
  }
  params.validate(content);
  await fs.mkdir(path.dirname(params.target), { recursive: true });
  await fs.writeFile(params.target, content, { mode: 0o600 });
  logger.info(
    { key: params.key, bytes: content.byteLength },
    "Restored persistent cache object from R2."
  );
}

async function saveObjectIfPresent(params: {
  key: string;
  source: string;
  contentType: string;
  validate: (content: Buffer) => void;
  storage: PersistentObjectStore;
  afterRead?: (content: Buffer) => void;
}): Promise<void> {
  let content: Buffer;
  try {
    content = await fs.readFile(params.source);
  } catch (error) {
    if (isFileNotFound(error)) {
      return;
    }
    throw error;
  }
  params.validate(content);
  params.afterRead?.(content);
  await params.storage.upload({ key: params.key, body: content, contentType: params.contentType });
  logger.info(
    { key: params.key, bytes: content.byteLength },
    "Saved persistent cache object to R2."
  );
}

function validateReviewBuffer(
  content: Buffer,
  expected: { owner: string; repo: string; pullNumber?: number }
): void {
  if (content.byteLength > MAX_REVIEW_CACHE_BYTES) {
    throw new Error(`Review cache exceeds ${MAX_REVIEW_CACHE_BYTES} bytes.`);
  }
  const cached = parseReviewCacheContent(content.toString("utf8"));
  if (
    cached.repository !== `${expected.owner}/${expected.repo}` ||
    cached.pullNumber !== expected.pullNumber
  ) {
    throw new Error(
      "Review cache identity does not match the current repository and pull request."
    );
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
