import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadRepositoryKnowledge,
  readKnowledgeScratch,
  saveRepositoryKnowledgeCache,
  validateRepositoryKnowledge,
  writeKnowledgeScratch
} from "../src/repository/knowledge.js";

test("repository knowledge round trips through the agent scratch file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-knowledge-"));
  try {
    await writeKnowledgeScratch(root, "# Architecture\n\nUse npm test.\n");
    assert.equal(await readKnowledgeScratch(root), "# Architecture\n\nUse npm test.\n");
    // Windows maps every chmod to the read/write bits (no execute bit), so the
    // container-facing 0o777/0o666 contract can only be asserted on POSIX.
    if (process.platform === "win32") {
      assert.equal((await fs.stat(path.join(root, ".ghbot"))).mode & 0o222, 0o222);
      assert.equal((await fs.stat(path.join(root, ".ghbot", "repository-knowledge.md"))).mode & 0o222, 0o222);
    } else {
      assert.equal((await fs.stat(path.join(root, ".ghbot"))).mode & 0o777, 0o777);
      assert.equal(
        (await fs.stat(path.join(root, ".ghbot", "repository-knowledge.md"))).mode & 0o777,
        0o666
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("repository knowledge persists in a repository-level cache file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-knowledge-cache-"));
  try {
    await saveRepositoryKnowledgeCache("# Tests\n\nRun npm test.\n", root);
    assert.equal(await loadRepositoryKnowledge(root), "# Tests\n\nRun npm test.\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("loading an empty repository knowledge cache initializes the persisted file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-knowledge-initial-"));
  try {
    const knowledge = await loadRepositoryKnowledge(root);
    assert.match(knowledge, /repository can evolve/i);
    assert.equal(await loadRepositoryKnowledge(root), knowledge);
    assert.equal(
      await fs.readFile(path.join(root, ".ghbot-knowledge", "repository.md"), "utf8"),
      knowledge
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("repository knowledge rejects credentials and oversized content", () => {
  assert.throws(
    () => validateRepositoryKnowledge("-----BEGIN PRIVATE KEY-----\nsecret"),
    /credential or private key/
  );
  assert.throws(() => validateRepositoryKnowledge(`sk-${"a".repeat(40)}`), /credential/);
  assert.throws(() => validateRepositoryKnowledge("x".repeat(33 * 1024)), /1-32768 bytes/);
});
