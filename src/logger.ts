import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "gitToken",
      "*.gitToken",
      "GHBOT_GIT_TOKEN",
      "*.GHBOT_GIT_TOKEN",
      "gooseApiKey",
      "*.gooseApiKey",
      "authorization",
      "*.authorization",
      "WEBHOOK_SECRET",
      "*.WEBHOOK_SECRET",
      "R2_SECRET_ACCESS_KEY",
      "*.R2_SECRET_ACCESS_KEY",
      "githubToken",
      "*.githubToken",
      "GITHUB_TOKEN",
      "*.GITHUB_TOKEN",
      "GOOSE_API_KEY",
      "*.GOOSE_API_KEY",
      "OPENAI_API_KEY",
      "*.OPENAI_API_KEY",
      "webhookSecret",
      "*.webhookSecret",
      "r2SecretAccessKey",
      "*.r2SecretAccessKey",
      "err.stderr",
      "error.stderr",
      "*.stderr"
    ],
    censor: "[REDACTED]"
  }
});

export function createEventLogger(bindings: {
  eventName: string;
  owner?: string;
  repo?: string;
  pullNumber?: number;
  issueNumber?: number;
}) {
  return logger.child(bindings);
}
