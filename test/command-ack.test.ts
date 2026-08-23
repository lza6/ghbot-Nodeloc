import assert from "node:assert/strict";
import test from "node:test";
import { formatCommandAckMessage } from "../src/github/commandFeedback.js";

test("recheck ack names the requester and sets expectations", () => {
  const message = formatCommandAckMessage("alice", "ghbot bot", "/recheck");
  assert.match(message, /@alice/);
  assert.match(message, /`\/recheck`/);
  assert.match(message, /running now/);
});

test("conflict ack states the time budget and push guard", () => {
  const message = formatCommandAckMessage("bob", "ghbot bot", "/conflict");
  assert.match(message, /45 minutes/);
  assert.match(message, /nothing is pushed unless every guard passes/);
});
