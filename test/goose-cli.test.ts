import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGooseAgentDockerArgs,
  buildGooseAgentEnvironment,
  buildIsolatedWorkspaceCommandDockerArgs,
  buildWorkspacePermissionDockerArgs,
  extractGooseFinalText,
  redactProcessArgs
} from "../src/ai/gooseCli.js";

test("goose agent mounts the workflow binary read-only and keeps a visible install fallback", () => {
  const args = buildGooseAgentDockerArgs({
    containerName: "ghbot-agent-test",
    realWorkingDirectory: "/tmp/worktree",
    containerEnv: { OPENAI_API_KEY: "one-run-token" },
    hostGooseBinary: "/tmp/goose/bin/goose",
    prompt: "introduce this pull request"
  });

  assert.ok(
    args.includes("type=bind,source=/tmp/goose/bin/goose,target=/usr/local/bin/goose,readonly")
  );
  const bootstrap = args[args.indexOf("-lc") + 1];
  assert.match(bootstrap!, /command -v goose/);
  assert.match(bootstrap!, /cat \/tmp\/goose-install\.log >&2/);
  assert.match(bootstrap!, /trap cleanup_workspace EXIT/);
  assert.match(bootstrap!, /safe\.directory \/workspace/);
  assert.match(bootstrap!, /chmod -R a\+rwX \/workspace/);
  assert.doesNotMatch(bootstrap!, /exec goose "\$@"/);
  assert.equal(args.at(-1), "introduce this pull request");
});

test("isolated validation receives the repository but no model or GitHub credentials", () => {
  const args = buildIsolatedWorkspaceCommandDockerArgs({
    containerName: "ghbot-validation-test",
    realWorkingDirectory: "/tmp/worktree",
    command: "npm ci && npm test"
  });

  assert.ok(args.includes("type=bind,source=/tmp/worktree,target=/workspace,readonly"));
  assert.ok(args.includes("HOME=/tmp/ghbot-validation-home"));
  assert.ok(args.includes("CI=true"));
  const bootstrap = args[args.indexOf("-lc") + 1];
  assert.match(bootstrap!, /cp -R --no-preserve=ownership/);
  assert.match(bootstrap!, /safe\.directory "\$validation_workspace"/);
  assert.match(bootstrap!, /exec sh -lc "\$1"/);
  assert.equal(args.at(-2), "ghbot-validation");
  assert.equal(args.at(-1), "npm ci && npm test");
  assert.equal(
    args.some((arg) => /OPENAI|GITHUB|GHBOT_GIT_TOKEN/.test(arg)),
    false
  );
});

test("process logging redacts only prompts and trusted validation commands", () => {
  assert.deepEqual(redactProcessArgs(["run", "--rm"], "workspace cleanup"), ["run", "--rm"]);
  assert.deepEqual(redactProcessArgs(["run", "--text", "secret prompt"], "goose agent container"), [
    "run",
    "--text",
    "[goose prompt: 13 chars]"
  ]);
  assert.deepEqual(
    redactProcessArgs(["run", "sh", "-lc", "npm ci && npm test"], "isolated repository validation", {
      redactLastAsValidationCommand: true
    }),
    ["run", "sh", "-lc", "[validation command: 18 chars]"]
  );
});

test("goose agent can fall back to installing inside the container", () => {
  const args = buildGooseAgentDockerArgs({
    containerName: "ghbot-agent-test",
    realWorkingDirectory: "/tmp/worktree",
    containerEnv: {},
    prompt: "inspect this pull request"
  });

  assert.equal(
    args.some((arg) => arg.includes("target=/usr/local/bin/goose")),
    false
  );
  assert.match(args[args.indexOf("-lc") + 1]!, /GOOSE_VERSION="v1\.46\.0"/);
});

test("goose repository agent has enough turns to finish tool-heavy tasks", () => {
  const environment = buildGooseAgentEnvironment({
    apiToken: "one-run-token",
    proxyPort: 43123
  });

  assert.equal(environment.GOOSE_MAX_TURNS, "50");
  assert.equal(environment.OPENAI_BASE_URL, "http://host.docker.internal:43123/v1");
});

test("goose agent restores host-cleanable permissions for root-owned workspace entries", () => {
  const args = buildWorkspacePermissionDockerArgs("/tmp/worktree");

  assert.ok(args.includes("--rm"));
  assert.ok(args.includes("none"));
  assert.ok(args.includes("type=bind,source=/tmp/worktree,target=/workspace"));
  const script = args[args.indexOf("-lc") + 1];
  assert.match(script!, /find \/workspace/);
  assert.match(script!, /-uid 0/);
  assert.match(script!, /chmod a\+rwX/);
});

test("goose output extracts the latest assistant text", () => {
  const output = JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "text", text: "review this" }] },
      { role: "assistant", content: [{ type: "text", text: "first response" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "final " },
          { type: "text", text: "response" }
        ]
      }
    ],
    metadata: { status: "completed" }
  });

  assert.equal(extractGooseFinalText(output), "final response");
});

test("goose output strips a surrounding JSON markdown fence", () => {
  const output = JSON.stringify({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: '```json\n{"ok":true}\n```' }]
      }
    ]
  });

  assert.equal(extractGooseFinalText(output), '{"ok":true}');
});

test("goose output rejects a response without assistant text", () => {
  assert.throws(
    () => extractGooseFinalText(JSON.stringify({ messages: [{ role: "user", content: [] }] })),
    /final assistant text/
  );
});
