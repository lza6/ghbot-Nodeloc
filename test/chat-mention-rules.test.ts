import assert from "node:assert/strict";
import test from "node:test";
import { containsBotMention } from "../src/chat/processor.js";

test("bot mention detection accepts configured aliases", () => {
  assert.equal(containsBotMention("@bot help me", "ghbot"), true);
  assert.equal(containsBotMention("@ghbot please review", "ghbot"), true);
  assert.equal(containsBotMention("@ghbot[bot] ping", "ghbot[bot]"), true);
});

test("partial usernames and ordinary text never trigger the bot", () => {
  assert.equal(containsBotMention("email me at user@botmail.com", "ghbot"), false);
  assert.equal(containsBotMention("the @botanist knows", "ghbot"), false);
  assert.equal(containsBotMention("no mention here", "ghbot"), false);
  assert.equal(containsBotMention("@anotherbot hi", "ghbot"), false);
});

test("mention detection is case-insensitive", () => {
  assert.equal(containsBotMention("@BOT hello", "ghbot"), true);
  assert.equal(containsBotMention("@GHBOT[BOT] hello", "ghbot[bot]"), true);
});
