import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildChatRequesterContext,
  chatToolBudgetInstruction,
  chatReplyLanguageInstruction,
  containsBotMention,
  createRepositorySnapshot,
  isTrustedChatPermission
} from "../src/chat/processor.js";

test("PR chat receives host-verified requester role context", () => {
  assert.deepEqual(
    buildChatRequesterContext({
      commenterLogin: "maintainer",
      pullRequestAuthorLogin: "contributor",
      repositoryPermission: "admin"
    }),
    {
      login: "maintainer",
      isPullRequestAuthor: false,
      repositoryPermission: "admin",
      actorType: "repository_admin"
    }
  );

  assert.deepEqual(
    buildChatRequesterContext({
      commenterLogin: "Contributor",
      pullRequestAuthorLogin: "contributor",
      repositoryPermission: "none"
    }),
    {
      login: "Contributor",
      isPullRequestAuthor: true,
      repositoryPermission: "none",
      actorType: "outside_pull_request_author"
    }
  );

  assert.equal(
    buildChatRequesterContext({
      commenterLogin: "visitor",
      pullRequestAuthorLogin: "contributor",
      repositoryPermission: "none"
    }).actorType,
    "outside_contributor"
  );
});

test("PR chat replies in the language of the latest user comment", () => {
  assert.match(chatReplyLanguageInstruction("@bot Introduce it"), /^Reply in English\./);
  assert.match(chatReplyLanguageInstruction("@bot 请介绍一下这个 PR"), /^Reply in Chinese\./);
  assert.match(chatReplyLanguageInstruction("@bot 请 review this PR"), /^Reply in Chinese\./);
});

test("PR chat must finish within its tool budget without asking to continue", () => {
  assert.match(chatToolBudgetInstruction(), /Do not ask the user whether to continue/);
  assert.match(chatToolBudgetInstruction(), /return the best complete final answer/);
});

test("PR chat recognizes @bot and the configured bot login", () => {
  assert.equal(containsBotMention("@bot can this merge?", "github-actions[bot]"), true);
  assert.equal(
    containsBotMention("Could @github-actions explain this?", "github-actions[bot]"),
    true
  );
  assert.equal(containsBotMention("Ping @github-actions[bot]", "github-actions[bot]"), true);
});

test("PR chat does not trigger on partial usernames or ordinary text", () => {
  assert.equal(containsBotMention("@botany please check", "github-actions[bot]"), false);
  assert.equal(
    containsBotMention("This mentions bot without an at sign", "github-actions[bot]"),
    false
  );
});

test("only collaborators with write access can invoke the full repository agent", () => {
  assert.equal(isTrustedChatPermission("admin"), true);
  assert.equal(isTrustedChatPermission("maintain"), true);
  assert.equal(isTrustedChatPermission("write"), true);
  assert.equal(isTrustedChatPermission("triage"), false);
  assert.equal(isTrustedChatPermission("read"), false);
  assert.equal(isTrustedChatPermission(null), false);
});

test("PR chat snapshot excludes repository instructions, secrets, git data, and symlinks", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "ghbot-chat-source-"));
  let snapshot: string | undefined;

  try {
    await fs.mkdir(path.join(source, ".git"));
    await fs.mkdir(path.join(source, ".goose"));
    await fs.mkdir(path.join(source, ".opencode"));
    await fs.mkdir(path.join(source, ".agents"));
    await fs.mkdir(path.join(source, ".ghbot"));
    await fs.mkdir(path.join(source, "src"));
    await fs.mkdir(path.join(source, "scripts"));
    await Promise.all([
      fs.writeFile(path.join(source, ".git", "config"), "credential data"),
      fs.writeFile(path.join(source, ".goose", "config.yaml"), "untrusted goose config"),
      fs.writeFile(path.join(source, ".opencode", "plugin.ts"), "untrusted plugin"),
      fs.writeFile(path.join(source, ".agents", "SKILL.md"), "untrusted skill"),
      fs.writeFile(path.join(source, ".ghbot", "repository-knowledge.md"), "untrusted knowledge"),
      fs.writeFile(path.join(source, ".env"), "TOKEN=secret"),
      fs.writeFile(path.join(source, ".env.local"), "TOKEN=local-secret"),
      fs.writeFile(path.join(source, "AGENTS.md"), "untrusted instructions"),
      fs.writeFile(path.join(source, "opencode.json"), "{}"),
      fs.writeFile(path.join(source, ".goosehints"), "untrusted hints"),
      fs.writeFile(path.join(source, "src", "index.ts"), "export const safe = true;\n"),
      fs.writeFile(path.join(source, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755
      }),
      fs.symlink(path.join(source, ".env"), path.join(source, "secret-link"))
    ]);

    snapshot = await createRepositorySnapshot(source);
    assert.equal(
      await fs.readFile(path.join(snapshot, "src", "index.ts"), "utf8"),
      "export const safe = true;\n"
    );
    // Windows collapses chmod to read/write bits; the exact container contract
    // (dirs 0o777, files 0o666/0o777) is only assertable on POSIX.
    if (process.platform === "win32") {
      assert.equal((await fs.stat(snapshot)).mode & 0o222, 0o222);
      assert.equal((await fs.stat(path.join(snapshot, "src"))).mode & 0o222, 0o222);
    } else {
      assert.equal((await fs.stat(snapshot)).mode & 0o777, 0o777);
      assert.equal((await fs.stat(path.join(snapshot, "src"))).mode & 0o777, 0o777);
      assert.equal((await fs.stat(path.join(snapshot, "src", "index.ts"))).mode & 0o777, 0o666);
      assert.equal((await fs.stat(path.join(snapshot, "scripts", "check.sh"))).mode & 0o777, 0o777);
    }
    for (const excluded of [
      ".git",
      ".goose",
      ".opencode",
      ".agents",
      ".ghbot",
      ".env",
      ".env.local",
      "AGENTS.md",
      "opencode.json",
      ".goosehints",
      "secret-link"
    ]) {
      await assert.rejects(fs.lstat(path.join(snapshot, excluded)), { code: "ENOENT" });
    }
  } finally {
    await fs.rm(source, { recursive: true, force: true });
    if (snapshot) {
      await fs.rm(snapshot, { recursive: true, force: true });
    }
  }
});
