import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeObjectPrefix,
  pullRequestReviewHistoryObjectKey,
  pullRequestReviewObjectKey,
  repositoryKnowledgeObjectKey,
  restorePersistentCache,
  savePersistentCache,
  type PersistentObjectStore
} from "../src/storage/cacheStore.js";
import { saveRepositoryKnowledgeCache } from "../src/repository/knowledge.js";
import { saveReviewCache } from "../src/review/cache.js";

const decision = {
  review: [],
  change: [],
  comment: "Looks good.",
  result: {
    canMerge: true,
    summary: "Safe to merge.",
    shouldClosePullRequest: false,
    closeReason: ""
  }
};

test("R2 cache keys are repository scoped and support a safe object prefix", () => {
  assert.equal(
    repositoryKnowledgeObjectKey("12345", "forum-114614"),
    "forum-114614/repositories/12345/knowledge/repository.md"
  );
  assert.equal(
    pullRequestReviewObjectKey("12345", 17, "/forum-114614/"),
    "forum-114614/repositories/12345/pulls/17/latest.json"
  );
  assert.equal(
    pullRequestReviewHistoryObjectKey("12345", 17, "a".repeat(40), "forum-114614"),
    `forum-114614/repositories/12345/pulls/17/reviews/${"a".repeat(40)}.json`
  );
  assert.equal(normalizeObjectPrefix(" nested/cache "), "nested/cache");
  assert.throws(() => normalizeObjectPrefix("../escape"), /safe slash-separated/);
  assert.throws(() => repositoryKnowledgeObjectKey("owner-name"), /only digits/);
});

test("persistent cache restores and saves validated repository and PR state", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-r2-source-"));
  const restored = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-r2-restored-"));
  const objects = new Map<string, Buffer>();
  const storage: PersistentObjectStore = {
    download: async (key) => objects.get(key),
    upload: async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
    }
  };

  try {
    const originalCwd = process.cwd();
    process.chdir(source);
    try {
      await saveRepositoryKnowledgeCache("# Tests\n\nRun npm test.\n", source);
      await saveReviewCache({
        owner: "forumlify",
        repo: "public",
        pullNumber: 17,
        headSha: "a".repeat(40),
        decision
      });
      await savePersistentCache({
        repositoryId: "12345",
        owner: "forumlify",
        repo: "public",
        saveRepositoryKnowledge: true,
        pullNumber: 17,
        prefix: "forum-114614",
        runtimeDirectory: source,
        storage
      });
    } finally {
      process.chdir(originalCwd);
    }

    assert.equal(objects.size, 3);
    await restorePersistentCache({
      repositoryId: "12345",
      owner: "forumlify",
      repo: "public",
      pullNumber: 17,
      prefix: "forum-114614",
      runtimeDirectory: restored,
      storage
    });
    assert.equal(
      await fs.readFile(path.join(restored, ".ghbot-knowledge/repository.md"), "utf8"),
      "# Tests\n\nRun npm test.\n"
    );
    const restoredReview = JSON.parse(
      await fs.readFile(path.join(restored, ".ghbot-cache/pr-17.json"), "utf8")
    );
    assert.equal(restoredReview.headSha, "a".repeat(40));
  } finally {
    await fs.rm(source, { recursive: true, force: true });
    await fs.rm(restored, { recursive: true, force: true });
  }
});

test("persistent cache does not overwrite newer repository knowledge when this run did not change it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-r2-stale-"));
  const knowledgeKey = repositoryKnowledgeObjectKey("12345", "forum-114614");
  const objects = new Map<string, Buffer>([
    [knowledgeKey, Buffer.from("# Newer knowledge\n\nKeep the Lite branch facts.\n")]
  ]);
  const storage: PersistentObjectStore = {
    download: async (key) => objects.get(key),
    upload: async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
    }
  };

  try {
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      await saveRepositoryKnowledgeCache("# Stale knowledge\n\nOnly next is known.\n", root);
      await saveReviewCache({
        owner: "forumlify",
        repo: "public",
        pullNumber: 17,
        headSha: "b".repeat(40),
        decision
      });
      await savePersistentCache({
        repositoryId: "12345",
        owner: "forumlify",
        repo: "public",
        saveRepositoryKnowledge: false,
        pullNumber: 17,
        prefix: "forum-114614",
        runtimeDirectory: root,
        storage
      });
    } finally {
      process.chdir(originalCwd);
    }

    assert.equal(
      objects.get(knowledgeKey)?.toString("utf8"),
      "# Newer knowledge\n\nKeep the Lite branch facts.\n"
    );
    assert.ok(objects.has(pullRequestReviewObjectKey("12345", 17, "forum-114614")));
    assert.ok(
      objects.has(pullRequestReviewHistoryObjectKey("12345", 17, "b".repeat(40), "forum-114614"))
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("persistent cache rejects a review object belonging to another repository", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-r2-invalid-"));
  const key = pullRequestReviewObjectKey("12345", 17);
  const storage: PersistentObjectStore = {
    download: async (requestedKey) =>
      requestedKey === key
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              repository: "attacker/fork",
              pullNumber: 17,
              headSha: "b".repeat(40),
              reviewedAt: new Date().toISOString(),
              decision
            })
          )
        : undefined,
    upload: async () => undefined
  };
  try {
    await assert.rejects(
      restorePersistentCache({
        repositoryId: "12345",
        owner: "forumlify",
        repo: "public",
        pullNumber: 17,
        runtimeDirectory: root,
        storage
      }),
      /identity does not match/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
