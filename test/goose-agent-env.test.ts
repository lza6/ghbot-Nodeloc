import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGooseAgentEnvironment,
  extractGooseFinalText,
  redactProcessArgs
} from "../src/ai/gooseCli.js";
import { config } from "../src/config.js";

const originalEffort = config.gooseThinkingEffort;

test("agent environment isolates home dirs and never carries real credentials", () => {
  const env = buildGooseAgentEnvironment({ apiToken: "one-run-token", proxyPort: 45678 });
  assert.equal(env.OPENAI_API_KEY, "one-run-token");
  assert.equal(env.OPENAI_BASE_URL, "http://host.docker.internal:45678/v1");
  assert.equal(env.HOME, "/tmp/goose-home");
  assert.equal(env.GOOSE_DISABLE_KEYRING, "true");
  assert.equal(env.GOOSE_TELEMETRY_ENABLED, "false");
  assert.equal(env.GOOSE_MODE, "auto");
});

test("thinking effort is forwarded when configured", () => {
  (config as { gooseThinkingEffort: string | undefined }).gooseThinkingEffort = "high";
  const env = buildGooseAgentEnvironment({ apiToken: "t", proxyPort: 1 });
  assert.equal(env.GOOSE_THINKING_EFFORT, "high");
  (config as { gooseThinkingEffort: string | undefined }).gooseThinkingEffort = originalEffort;
});

test("extractGooseFinalText returns the last assistant text block", () => {
  const stdout = JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "final answer" }] }
    ]
  });
  assert.equal(extractGooseFinalText(stdout), "final answer");
});

test("extractGooseFinalText strips a surrounding markdown fence", () => {
  const stdout = JSON.stringify({
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: '```json\n{"ok":true}\n```' }]
      }
    ]
  });
  assert.equal(extractGooseFinalText(stdout), '{"ok":true}');
});

test("extractGooseFinalText rejects invalid or empty outputs", () => {
  assert.throws(() => extractGooseFinalText("not json"), /valid JSON/);
  assert.throws(
    () =>
      extractGooseFinalText(
        JSON.stringify({ messages: [{ role: "assistant", content: [{ type: "text", text: "" }] }] })
      ),
    /final assistant text/
  );
});

test("redactProcessArgs hides the goose prompt body", () => {
  const args = ["run", "--text", "secret prompt content"];
  const redacted = redactProcessArgs(args, "goose process");
  assert.equal(redacted[2], "[goose prompt: 21 chars]");
  assert.equal(redacted[0], "run");
});

test("redactProcessArgs hides the validation command via explicit sentinel", () => {
  const args = ["sh", "-lc", "bootstrap", "ghbot-validation", "npm test && cat secrets"];
  const redacted = redactProcessArgs(args, "isolated repository validation", {
    redactLastAsValidationCommand: true
  });
  assert.equal(redacted.at(-1), "[validation command: 23 chars]");
  // Without the sentinel the label alone must not trigger redaction (D-09).
  const untouched = redactProcessArgs(args, "isolated repository validation");
  assert.equal(untouched.at(-1), "npm test && cat secrets");
});
