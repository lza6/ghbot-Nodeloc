import assert from "node:assert/strict";
import test from "node:test";
import { parseWebhookMentionEvent, webhookPermissionAllows } from "../src/webhook/processor.js";

// ---------------------------------------------------------------------------
// parseWebhookMentionEvent
// ---------------------------------------------------------------------------

test("parseWebhookMentionEvent for issue_comment with missing fields returns null", () => {
  // Missing issue number
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { title: "test" },
        comment: { id: 88, body: "@bot hello", user: { login: "alice", type: "User" } }
      },
      "delivery-1",
      "bot"
    ),
    null
  );

  // Missing comment id
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7, pull_request: { url: "" } },
        comment: { body: "@bot hello", user: { login: "alice", type: "User" } }
      },
      "delivery-2",
      "bot"
    ),
    null
  );

  // Missing comment body
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, user: { login: "alice", type: "User" } }
      },
      "delivery-3",
      "bot"
    ),
    null
  );

  // Missing repository owner
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { name: "demo" },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot hello", user: { login: "alice", type: "User" } }
      },
      "delivery-4",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review_comment with valid data", () => {
  const mention = parseWebhookMentionEvent(
    "pull_request_review_comment",
    {
      action: "created",
      installation: { id: 12345 },
      repository: { id: 99, name: "demo", owner: { login: "acme" } },
      pull_request: { number: 7 },
      comment: {
        id: 88,
        body: "@bot please review this comment",
        user: { login: "alice", type: "User" }
      }
    },
    "delivery-review-comment",
    "bot"
  );

  assert.ok(mention);
  assert.equal(mention.eventName, "pull_request_review_comment");
  assert.equal(mention.installationId, 12345);
  assert.equal(mention.owner, "acme");
  assert.equal(mention.repo, "demo");
  assert.equal(mention.issueNumber, 7);
  assert.equal(mention.targetKind, "pull_request");
  assert.equal(mention.sourceCommentId, 88);
  assert.equal(mention.commentBody, "@bot please review this comment");
  assert.equal(mention.commenterLogin, "alice");
  assert.equal(mention.commenterType, "User");
  assert.equal(mention.replyMode, "review_comment");
  assert.equal(mention.action, "created");
  assert.equal(mention.deliveryId, "delivery-review-comment");
  assert.equal(mention.repositoryId, 99);
});

test("parseWebhookMentionEvent for pull_request_review submitted action", () => {
  const mention = parseWebhookMentionEvent(
    "pull_request_review",
    {
      action: "submitted",
      installation: { id: 12345 },
      repository: { id: 99, name: "demo", owner: { login: "acme" } },
      pull_request: { number: 7 },
      review: {
        id: 88,
        body: "@bot thanks for the review",
        user: { login: "bob", type: "User" }
      }
    },
    "delivery-review-submitted",
    "bot"
  );

  assert.ok(mention);
  assert.equal(mention.eventName, "pull_request_review");
  assert.equal(mention.installationId, 12345);
  assert.equal(mention.owner, "acme");
  assert.equal(mention.repo, "demo");
  assert.equal(mention.issueNumber, 7);
  assert.equal(mention.targetKind, "pull_request");
  assert.equal(mention.sourceCommentId, 88);
  assert.equal(mention.commentBody, "@bot thanks for the review");
  assert.equal(mention.commenterLogin, "bob");
  assert.equal(mention.commenterType, "User");
  assert.equal(mention.replyMode, "conversation");
  assert.equal(mention.action, "submitted");
  assert.equal(mention.deliveryId, "delivery-review-submitted");
});

test("parseWebhookMentionEvent for non-submitted pull_request_review returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "dismissed",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-dismissed",
      "bot"
    ),
    null
  );

  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "edited",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-edited",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent with non-created/edited action returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "deleted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-deleted",
      "bot"
    ),
    null
  );

  // "edited" should still work for issue_comment
  assert.ok(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "edited",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7, pull_request: { url: "" } },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-edited-ok",
      "bot"
    )
  );
});

test("parseWebhookMentionEvent with bot sender returns null", () => {
  // Bot type sender
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "some-app", type: "Bot" }
        }
      },
      "delivery-bot-type",
      "bot"
    ),
    null
  );

  // Login matching botName (case-insensitive)
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "BOT", type: "User" }
        }
      },
      "delivery-bot-login",
      "bot"
    ),
    null
  );

  // Login matching botName with [bot] suffix
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "github-actions[bot]", type: "User" }
        }
      },
      "delivery-bot-suffix",
      "github-actions[bot]"
    ),
    null
  );
});

test("parseWebhookMentionEvent with empty payload or deliveryId returns null", () => {
  assert.equal(parseWebhookMentionEvent("issue_comment", null, "delivery-1", "bot"), null);
  assert.equal(
    parseWebhookMentionEvent("issue_comment", "not-an-object", "delivery-2", "bot"),
    null
  );
  assert.equal(parseWebhookMentionEvent("issue_comment", { action: "created" }, "", "bot"), null);
});

test("parseWebhookMentionEvent for pull_request_review with missing review fields returns null", () => {
  // Missing review id
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "submitted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: { body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-missing-review-id",
      "bot"
    ),
    null
  );

  // Missing review body
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "submitted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: { id: 88, user: { login: "alice", type: "User" } }
      },
      "delivery-missing-review-body",
      "bot"
    ),
    null
  );

  // Missing pull_request number
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "submitted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: {},
        review: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-missing-pr-number",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review_comment with missing fields returns null", () => {
  // Missing pull_request number
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: {},
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-pr-comment-missing-pr",
      "bot"
    ),
    null
  );

  // Missing comment id
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        comment: { body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-pr-comment-missing-id",
      "bot"
    ),
    null
  );

  // Missing comment body
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        comment: { id: 88, user: { login: "alice", type: "User" } }
      },
      "delivery-pr-comment-missing-body",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review_comment non-created/edited action returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review_comment",
      {
        action: "deleted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-pr-comment-deleted",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review_comment without bot mention returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        comment: {
          id: 88,
          body: "ordinary comment without mention",
          user: { login: "alice", type: "User" }
        }
      },
      "delivery-pr-comment-no-mention",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review submitted without bot mention returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "submitted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: {
          id: 88,
          body: "ordinary review without mention",
          user: { login: "alice", type: "User" }
        }
      },
      "delivery-review-no-mention",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for pull_request_review with bot reviewer returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "pull_request_review",
      {
        action: "submitted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        pull_request: { number: 7 },
        review: {
          id: 88,
          body: "@bot test",
          user: { login: "some-app", type: "Bot" }
        }
      },
      "delivery-review-bot-reviewer",
      "bot"
    ),
    null
  );
});

test("parseWebhookMentionEvent for issue_comment with null/undefined installation returns null", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-no-installation",
      "bot"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// webhookPermissionAllows
// ---------------------------------------------------------------------------

test("webhookPermissionAllows with anyone policy always returns true", () => {
  assert.equal(webhookPermissionAllows(null, "anyone"), true);
  assert.equal(webhookPermissionAllows(undefined, "anyone"), true);
  assert.equal(webhookPermissionAllows("none", "anyone"), true);
  assert.equal(webhookPermissionAllows("read", "anyone"), true);
  assert.equal(webhookPermissionAllows("write", "anyone"), true);
  assert.equal(webhookPermissionAllows("admin", "anyone"), true);
  assert.equal(webhookPermissionAllows("", "anyone"), true);
});

test("webhookPermissionAllows with read policy requires read+ permissions", () => {
  // Allowed
  assert.equal(webhookPermissionAllows("organization", "read"), true);
  assert.equal(webhookPermissionAllows("read", "read"), true);
  assert.equal(webhookPermissionAllows("triage", "read"), true);
  assert.equal(webhookPermissionAllows("write", "read"), true);
  assert.equal(webhookPermissionAllows("maintain", "read"), true);
  assert.equal(webhookPermissionAllows("admin", "read"), true);

  // Denied
  assert.equal(webhookPermissionAllows(null, "read"), false);
  assert.equal(webhookPermissionAllows(undefined, "read"), false);
});

test("webhookPermissionAllows with write policy requires write+ permissions", () => {
  // Allowed
  assert.equal(webhookPermissionAllows("write", "write"), true);
  assert.equal(webhookPermissionAllows("maintain", "write"), true);
  assert.equal(webhookPermissionAllows("admin", "write"), true);

  // Denied
  assert.equal(webhookPermissionAllows(null, "write"), false);
  assert.equal(webhookPermissionAllows(undefined, "write"), false);
  assert.equal(webhookPermissionAllows("organization", "write"), false);
  assert.equal(webhookPermissionAllows("read", "write"), false);
  assert.equal(webhookPermissionAllows("triage", "write"), false);
});

test("webhookPermissionAllows with null permission returns false for read/write", () => {
  assert.equal(webhookPermissionAllows(null, "read"), false);
  assert.equal(webhookPermissionAllows(undefined, "read"), false);
  assert.equal(webhookPermissionAllows(null, "write"), false);
  assert.equal(webhookPermissionAllows(undefined, "write"), false);
});

// ---------------------------------------------------------------------------
// isCreatedOrEdited (tested indirectly through parseWebhookMentionEvent)
// ---------------------------------------------------------------------------

test("isCreatedOrEdited returns true for created and edited (indirect)", () => {
  // "created" action accepted for issue_comment
  assert.ok(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7, pull_request: { url: "" } },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-created",
      "bot"
    )
  );

  // "edited" action accepted for issue_comment
  assert.ok(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "edited",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7, pull_request: { url: "" } },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-edited",
      "bot"
    )
  );
});

test("isCreatedOrEdited returns false for deleted (indirect)", () => {
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "deleted",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-deleted",
      "bot"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// isBotSender (tested indirectly through parseWebhookMentionEvent)
// ---------------------------------------------------------------------------

test("isBotSender checks type === Bot and login case-insensitive match (indirect)", () => {
  // Bot type
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "some-app", type: "Bot" }
        }
      },
      "delivery-bot-type",
      "bot"
    ),
    null
  );

  // Case-insensitive login match with botName
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "Bot", type: "User" }
        }
      },
      "delivery-bot-login-ci",
      "bot"
    ),
    null
  );

  // Non-bot, non-matching login is allowed
  assert.ok(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7, pull_request: { url: "" } },
        comment: {
          id: 88,
          body: "@bot test",
          user: { login: "alice", type: "User" }
        }
      },
      "delivery-human-user",
      "bot"
    )
  );
});

// ---------------------------------------------------------------------------
// isRecord (tested indirectly through parseWebhookMentionEvent)
// ---------------------------------------------------------------------------

test("isRecord returns false for non-objects (indirect)", () => {
  // Non-object payload
  assert.equal(parseWebhookMentionEvent("issue_comment", "string", "delivery-1", "bot"), null);

  // Null payload
  assert.equal(parseWebhookMentionEvent("issue_comment", null, "delivery-2", "bot"), null);

  // Number payload
  assert.equal(parseWebhookMentionEvent("issue_comment", 42, "delivery-3", "bot"), null);
});

// ---------------------------------------------------------------------------
// asString (tested indirectly through parseWebhookMentionEvent)
// ---------------------------------------------------------------------------

test("asString returns undefined for non-strings (indirect)", () => {
  // Non-string comment body (number)
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: 123, user: { login: "alice", type: "User" } }
      },
      "delivery-non-string-body",
      "bot"
    ),
    null
  );

  // Non-string owner login (array)
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 12345 },
        repository: { id: 99, name: "demo", owner: { login: ["acme"] } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-non-string-owner",
      "bot"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// asPositiveInteger (tested indirectly through parseWebhookMentionEvent)
// ---------------------------------------------------------------------------

test("asPositiveInteger validates positive safe integers (indirect)", () => {
  // Zero installation id
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 0 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-zero-installation",
      "bot"
    ),
    null
  );

  // Negative installation id
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: -1 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-negative-installation",
      "bot"
    ),
    null
  );

  // Non-integer installation id
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: 1.5 },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-float-installation",
      "bot"
    ),
    null
  );

  // Non-number installation id
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      {
        action: "created",
        installation: { id: "12345" },
        repository: { id: 99, name: "demo", owner: { login: "acme" } },
        issue: { number: 7 },
        comment: { id: 88, body: "@bot test", user: { login: "alice", type: "User" } }
      },
      "delivery-string-installation",
      "bot"
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// Issue with null targetKind (issue without pull_request marker)
// ---------------------------------------------------------------------------

test("parseWebhookMentionEvent for issue_comment on an issue (not PR)", () => {
  const mention = parseWebhookMentionEvent(
    "issue_comment",
    {
      action: "created",
      installation: { id: 12345 },
      repository: { id: 99, name: "demo", owner: { login: "acme" } },
      issue: { number: 7 },
      comment: { id: 88, body: "@bot question about issue", user: { login: "alice", type: "User" } }
    },
    "delivery-issue-only",
    "bot"
  );

  assert.ok(mention);
  assert.equal(mention.targetKind, "issue");
  assert.equal(mention.issueNumber, 7);
  assert.equal(mention.replyMode, "conversation");
});
