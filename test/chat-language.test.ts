import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatRequesterContext,
  chatReplyLanguageInstruction,
  chatToolBudgetInstruction,
  containsBotMention
} from "../src/chat/processor.js";

test("chinese comments produce chinese reply instructions", () => {
  const instruction = chatReplyLanguageInstruction("请解释这段代码的作用");
  assert.match(instruction, /Reply in Chinese/);
});

test("english comments produce english reply instructions", () => {
  const instruction = chatReplyLanguageInstruction("What does this PR change?");
  assert.match(instruction, /Reply in English/);
});

test("mixed comments follow the presence of han script", () => {
  assert.match(chatReplyLanguageInstruction("这个 function 是干嘛的"), /Chinese/);
});

test("requester context derives actor categories deterministically", () => {
  assert.deepEqual(
    buildChatRequesterContext({
      commenterLogin: "alice",
      pullRequestAuthorLogin: "alice",
      repositoryPermission: "read"
    }),
    {
      login: "alice",
      isPullRequestAuthor: true,
      repositoryPermission: "read",
      actorType: "repository_reader"
    }
  );
  assert.deepEqual(
    buildChatRequesterContext({
      commenterLogin: "bob",
      pullRequestAuthorLogin: "alice",
      repositoryPermission: "none"
    }),
    {
      login: "bob",
      isPullRequestAuthor: false,
      repositoryPermission: "none",
      actorType: "outside_contributor"
    }
  );
});

test("tool budget instruction forbids asking the user to continue", () => {
  const instruction = chatToolBudgetInstruction();
  assert.match(instruction, /Do not ask the user whether to continue/);
});
