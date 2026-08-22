import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { createGitHubAppInstallationCredentials } from "../github/client.js";
import { logger } from "../logger.js";
import { parseWebhookMentionEvent, processWebhookMention } from "./processor.js";

const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
const DELIVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TASK_ATTEMPTS = 2;

export type WebhookDeliveryHandler = (
  eventName: string,
  payload: unknown,
  deliveryId: string
) => Promise<void>;

export type WebhookServerOptions = {
  secret: string;
  path?: string;
  maxBodyBytes?: number;
  queueConcurrency?: number;
  queueLimit?: number;
  botName?: string;
  handleDelivery?: WebhookDeliveryHandler;
};

export function verifyGitHubWebhookSignature(
  payload: Buffer | string,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith("sha256=") || !secret) {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
    "utf8"
  );
  const supplied = Buffer.from(signature, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createWebhookServer(options: WebhookServerOptions): http.Server {
  if (!options.secret) {
    throw new Error("WEBHOOK_SECRET is required to create the GitHub webhook server.");
  }
  const webhookPath = options.path ?? "/webhooks/github";
  const maxBodyBytes = options.maxBodyBytes ?? MAX_WEBHOOK_BODY_BYTES;
  const queue = new WebhookTaskQueue(
    options.queueConcurrency ?? config.webhookQueueConcurrency,
    options.queueLimit ?? config.webhookQueueLimit
  );
  const handleDelivery =
    options.handleDelivery ?? createDefaultDeliveryHandler(options.botName ?? config.botName);

  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/healthz") {
      writeJson(response, 200, { ok: true, webhook: true });
      return;
    }
    if (request.method !== "POST" || pathname !== webhookPath) {
      response.setHeader("allow", "GET, POST");
      writeJson(response, 404, { error: "Not found." });
      return;
    }

    const deliveryId = singleHeader(request.headers["x-github-delivery"]);
    const eventName = singleHeader(request.headers["x-github-event"]);
    const signature = singleHeader(request.headers["x-hub-signature-256"]);
    if (!deliveryId || !eventName || !signature) {
      writeJson(response, 400, { error: "Missing GitHub webhook headers." });
      return;
    }

    let body: Buffer;
    try {
      body = await readRawBody(request, maxBodyBytes);
    } catch (error) {
      logger.warn(
        { error, deliveryId, eventName },
        "Rejected oversized or unreadable GitHub webhook body."
      );
      writeJson(response, 413, { error: "Webhook payload is too large." });
      return;
    }
    if (!verifyGitHubWebhookSignature(body, signature, options.secret)) {
      writeJson(response, 401, { error: "Invalid webhook signature." });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      writeJson(response, 400, { error: "Webhook payload is not valid JSON." });
      return;
    }

    try {
      const accepted = queue.enqueue(deliveryId, () =>
        handleDelivery(eventName, payload, deliveryId)
      );
      if (!accepted) {
        writeJson(response, 202, { ok: true, duplicate: true });
        return;
      }
    } catch (error) {
      logger.warn(
        { error, deliveryId, eventName },
        "Webhook queue is full; asking GitHub to retry."
      );
      writeJson(response, 503, { error: "Webhook queue is temporarily full." });
      return;
    }

    writeJson(response, 202, { ok: true });
  });
}

export async function startWebhookServer(): Promise<http.Server> {
  if (!config.webhookEnabled) {
    throw new Error(
      "Webhook support is disabled. Set WEBHOOK_ENABLED=true to start the webhook service."
    );
  }
  if (!config.webhookSecret) {
    throw new Error("WEBHOOK_SECRET is required when WEBHOOK_ENABLED=true.");
  }
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    throw new Error("GH_APP_ID and GH_APP_PRIVATE_KEY are required when WEBHOOK_ENABLED=true.");
  }

  const server = createWebhookServer({
    secret: config.webhookSecret,
    path: config.webhookPath,
    queueConcurrency: config.webhookQueueConcurrency,
    queueLimit: config.webhookQueueLimit
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  logger.info(
    { port: config.port, path: config.webhookPath },
    "GitHub webhook server is listening."
  );
  return server;
}

function createDefaultDeliveryHandler(botName: string): WebhookDeliveryHandler {
  return async (eventName, payload, deliveryId) => {
    const mention = parseWebhookMentionEvent(eventName, payload, deliveryId, botName);
    if (!mention) {
      logger.debug(
        { eventName, deliveryId },
        "Ignoring GitHub webhook without a supported bot mention."
      );
      return;
    }
    const { octokit } = await createGitHubAppInstallationCredentials(mention.installationId);
    await processWebhookMention(octokit, mention);
  };
}

class WebhookTaskQueue {
  private readonly pending: Array<{ deliveryId: string; run: () => Promise<void> }> = [];
  private readonly seen = new Map<string, number>();
  private readonly attempts = new Map<string, number>();
  private active = 0;

  constructor(
    private readonly concurrency: number,
    private readonly limit: number
  ) {}

  enqueue(deliveryId: string, run: () => Promise<void>): boolean {
    this.pruneSeen();
    if (this.seen.has(deliveryId)) {
      return false;
    }
    if (this.pending.length >= this.limit) {
      throw new Error("Webhook queue limit reached.");
    }
    this.seen.set(deliveryId, Date.now());
    this.pending.push({ deliveryId, run });
    this.drain();
    return true;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()!;
      this.active += 1;
      void task
        .run()
        .then(() => {
          this.attempts.delete(task.deliveryId);
        })
        .catch((error) => {
          // Retry the failed handler up to MAX_TASK_ATTEMPTS in-process before
          // releasing the delivery so GitHub can redeliver it.
          const attempt = (this.attempts.get(task.deliveryId) ?? 0) + 1;
          logger.error(
            { error, deliveryId: task.deliveryId, attempt },
            "GitHub webhook delivery failed."
          );
          if (attempt < MAX_TASK_ATTEMPTS) {
            this.attempts.set(task.deliveryId, attempt);
            this.pending.push(task);
            return;
          }
          this.attempts.delete(task.deliveryId);
          this.seen.delete(task.deliveryId);
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  private pruneSeen(): void {
    const cutoff = Date.now() - DELIVERY_RETENTION_MS;
    for (const [deliveryId, acceptedAt] of this.seen) {
      if (acceptedAt < cutoff) {
        this.seen.delete(deliveryId);
      }
    }
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(request: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maxBytes) {
      throw new Error(`Webhook body exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startWebhookServer().catch((error) => {
    logger.error({ error }, "GitHub webhook server failed to start.");
    process.exitCode = 1;
  });
}
