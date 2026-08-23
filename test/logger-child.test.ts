import assert from "node:assert/strict";
import test from "node:test";
import { createEventLogger } from "../src/logger.js";

test("event logger child bindings include owner/repo/eventName", () => {
  const child = createEventLogger({
    eventName: "issue_comment",
    owner: "acme",
    repo: "demo",
    pullNumber: 7
  });
  assert.equal(typeof child.info, "function");
  assert.equal(typeof child.error, "function");
});
