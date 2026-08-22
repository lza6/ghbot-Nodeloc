import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import {
  buildWebhookChatPrompt,
  getCommenterPermission,
  parseWebhookMentionEvent,
  webhookPermissionAllows
} from "../src/webhook/processor.js";
import { createWebhookServer, verifyGitHubWebhookSignature } from "../src/webhook/server.js";

const secret = "webhook-test-secret";

function issueCommentPayload(body = "@bot what does this issue do?") {
  return {
    action: "created",
    installation: { id: 12345 },
    repository: {
      id: 99,
      name: "demo",
      full_name: "acme/demo",
      owner: { login: "acme" }
    },
    issue: {
      number: 7,
      title: "A question",
      pull_request: { url: "https://api.github.com/repos/acme/demo/pulls/7" }
    },
    comment: {
      id: 88,
      body,
      user: { login: "alice", type: "User" }
    }
  };
}

function signature(body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

type OctokitLike = Parameters<typeof getCommenterPermission>[0];

function createOctokitStub(calls: string[]): OctokitLike {
  return {
    rest: {
      repos: {
        get: async () => {
          calls.push("repo");
          return { data: { owner: { type: "Organization" } } };
        },
        getCollaboratorPermissionLevel: async () => {
          calls.push("collaborator");
          return { data: { permission: null } };
        }
      },
      orgs: {
        checkMembershipForUser: async () => {
          calls.push("membership");
          return { status: 204 };
        }
      }
    }
  } as unknown as OctokitLike;
}

class TestResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers ?? {})) {
      this.setHeader(name, value);
    }
    return this;
  }

  end(body?: string): this {
    this.body = body ?? "";
    return this;
  }
}

async function request(
  server: http.Server,
  options: {
    method?: string;
    path?: string;
    body?: string;
    delivery?: string;
    signature?: string;
  } = {}
): Promise<{ status: number; body: string }> {
  const body = options.body ?? JSON.stringify(issueCommentPayload());
  const request = Object.assign(Readable.from([Buffer.from(body)]), {
    method: options.method ?? "POST",
    url: options.path ?? "/webhooks/github",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      "x-github-delivery": options.delivery ?? "delivery-1",
      "x-github-event": "issue_comment",
      "x-hub-signature-256": options.signature ?? signature(body)
    }
  }) as http.IncomingMessage;
  const response = new TestResponse();
  const listener = server.listeners("request")[0];
  assert.equal(typeof listener, "function");
  await listener(request, response as unknown as http.ServerResponse);
  return { status: response.statusCode, body: response.body };
}

test("GitHub webhook signatures use the raw payload and constant-time comparison", () => {
  const body = JSON.stringify({ hello: "world" });
  const valid = signature(body);
  assert.equal(verifyGitHubWebhookSignature(body, valid, secret), true);
  assert.equal(verifyGitHubWebhookSignature(body, `${valid}x`, secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, "sha1=bad", secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, valid, ""), false);
});

test("Webhook event parsing only accepts supported mentions and preserves PR context", () => {
  const mention = parseWebhookMentionEvent(
    "issue_comment",
    issueCommentPayload("Please @github-actions[bot] explain this"),
    "delivery-1",
    "github-actions[bot]"
  );
  assert.deepEqual(
    mention && {
      eventName: mention.eventName,
      installationId: mention.installationId,
      owner: mention.owner,
      repo: mention.repo,
      issueNumber: mention.issueNumber,
      targetKind: mention.targetKind,
      replyMode: mention.replyMode
    },
    {
      eventName: "issue_comment",
      installationId: 12345,
      owner: "acme",
      repo: "demo",
      issueNumber: 7,
      targetKind: "pull_request",
      replyMode: "conversation"
    }
  );
  assert.equal(
    parseWebhookMentionEvent(
      "issue_comment",
      issueCommentPayload("ordinary comment"),
      "delivery-2",
      "github-actions[bot]"
    ),
    null
  );
  assert.equal(
    parseWebhookMentionEvent("issues", issueCommentPayload(), "delivery-3", "github-actions[bot]"),
    null
  );
});

test("Webhook permission policy is explicit", () => {
  assert.equal(webhookPermissionAllows(null, "anyone"), true);
  assert.equal(webhookPermissionAllows("organization", "read"), true);
  assert.equal(webhookPermissionAllows("organization", "write"), false);
  assert.equal(webhookPermissionAllows("read", "read"), true);
  assert.equal(webhookPermissionAllows("triage", "read"), true);
  assert.equal(webhookPermissionAllows("read", "write"), false);
  assert.equal(webhookPermissionAllows("write", "write"), true);
  assert.equal(webhookPermissionAllows(null, "read"), false);
});

test("organization members can use webhook chat without repository collaborator access", async () => {
  const calls: string[] = [];
  const octokit = createOctokitStub(calls);
  const permission = await getCommenterPermission(octokit, {
    eventName: "issue_comment",
    action: "created",
    deliveryId: "delivery-org-member",
    installationId: 12345,
    owner: "acme",
    repo: "demo",
    issueNumber: 7,
    targetKind: "issue",
    sourceCommentId: 88,
    commentBody: "@bot help",
    commenterLogin: "alice",
    replyMode: "conversation"
  });

  assert.equal(permission, "organization");
  assert.deepEqual(calls, ["repo", "membership"]);
});

test("Webhook server returns health, verifies signatures, queues asynchronously, and deduplicates deliveries", async () => {
  const handled: string[] = [];
  let resolveHandler: (() => void) | undefined;
  const handlerFinished = new Promise<void>((resolve) => {
    resolveHandler = resolve;
  });
  const server = createWebhookServer({
    secret,
    handleDelivery: async (_eventName, _payload, deliveryId) => {
      handled.push(deliveryId);
      resolveHandler?.();
      await handlerFinished;
    }
  });
  try {
    const health = await request(server, { method: "GET", path: "/healthz", body: "" });
    assert.equal(health.status, 200);

    const body = JSON.stringify(issueCommentPayload());
    const first = await request(server, { body, delivery: "delivery-async" });
    assert.equal(first.status, 202);
    assert.deepEqual(JSON.parse(first.body), { ok: true });
    const duplicate = await request(server, { body, delivery: "delivery-async" });
    assert.equal(duplicate.status, 202);
    assert.deepEqual(JSON.parse(duplicate.body), { ok: true, duplicate: true });
    await handlerFinished;
    assert.deepEqual(handled, ["delivery-async"]);

    const rejected = await request(server, {
      body,
      delivery: "delivery-invalid",
      signature: "sha256=invalid"
    });
    assert.equal(rejected.status, 401);
  } finally {
    // The handler is invoked directly so this test does not require a TCP port.
  }
});

test("A failed webhook delivery can be retried", async () => {
  const attempts: string[] = [];
  const server = createWebhookServer({
    secret,
    handleDelivery: async (_eventName, _payload, deliveryId) => {
      attempts.push(deliveryId);
      if (attempts.length === 1) {
        throw new Error("temporary failure");
      }
    }
  });
  try {
    const body = JSON.stringify(issueCommentPayload());
    assert.equal((await request(server, { body, delivery: "delivery-retry" })).status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retry = await request(server, { body, delivery: "delivery-retry" });
    assert.equal(retry.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(attempts, ["delivery-retry", "delivery-retry"]);
  } finally {
    // The handler is invoked directly so this test does not require a TCP port.
  }
});

test("Webhook chat prompt keeps the mode read-only and follows the comment language", () => {
  const mention = parseWebhookMentionEvent(
    "issue_comment",
    issueCommentPayload("@bot 请解释这个问题"),
    "delivery-prompt",
    "bot"
  );
  assert.ok(mention);
  const prompt = buildWebhookChatPrompt(mention, {
    repository: {
      fullName: "acme/demo",
      description: null,
      defaultBranch: "main",
      readme: "# Demo"
    },
    item: {
      number: 7,
      title: "Question",
      body: "",
      state: "open",
      url: "https://github.com/acme/demo/issues/7",
      kind: "issue",
      author: "alice"
    },
    discussion: []
  });
  assert.match(prompt, /Reply in Chinese\./);
  assert.match(prompt, /read-only GitHub webhook assistant/i);
  assert.match(prompt, /no repository tools/i);
});
