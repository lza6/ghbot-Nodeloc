import assert from "node:assert/strict";
import test from "node:test";
import { formatPermissionDeniedMessage } from "../src/github/commandFeedback.js";

test("permission denied message names the commenter, command, and remedy", () => {
  const message = formatPermissionDeniedMessage("alice", "/recheck");
  assert.match(message, /@alice/);
  assert.match(message, /`\/recheck`/);
  assert.match(message, /write.*maintain.*admin|maintainer/i);
});
