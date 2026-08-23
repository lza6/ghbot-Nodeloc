import "dotenv/config";
import { z } from "zod";

const optionalString = z.preprocess((value) => {
  return value === "" ? undefined : value;
}, z.string().optional());

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  switch (value.toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    default:
      return value;
  }
}, z.boolean());

function csvListWithDefault(defaultValue: string[]) {
  return z.preprocess((value) => {
    if (typeof value !== "string") {
      return value ?? defaultValue;
    }

    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }, z.array(z.string()));
}

const configSchema = z
  .object({
    port: z.coerce.number().int().positive().default(3000),
    githubToken: optionalString,
    githubAppId: optionalString,
    githubAppPrivateKey: optionalString,
    githubAppInstallationId: z.preprocess((value) => {
      if (value === "" || value === undefined) {
        return undefined;
      }

      return value;
    }, z.coerce.number().int().positive().optional()),
    webhookEnabled: envBoolean.default(false),
    webhookSecret: optionalString,
    webhookPath: z.string().startsWith("/").default("/webhooks/github"),
    webhookChatPermission: z.enum(["anyone", "read", "write"]).default("read"),
    webhookQueueConcurrency: z.coerce.number().int().positive().max(20).default(2),
    webhookQueueLimit: z.coerce.number().int().positive().max(10_000).default(500),
    runtimeDirectory: optionalString,
    gooseModel: optionalString.default("gpt-5.4"),
    gooseThinkingEffort: z.preprocess(
      (value) => {
        if (value === "" || value === undefined) {
          return undefined;
        }

        if (value === "minimal") {
          return "low";
        }

        if (value === "xhigh") {
          return "max";
        }

        return value;
      },
      z.enum(["off", "low", "medium", "high", "max"]).optional()
    ),
    gooseBaseUrl: optionalString.default("https://api.openai.com/v1"),
    gooseApiKey: optionalString,
    reviewPolicy: z.enum(["allow", "require_approval", "reject"]).default("allow"),
    reviewStrictness: z.enum(["normal", "strict"]).default("normal"),
    reviewInstructions: optionalString,
    reviewBranches: csvListWithDefault([]),
    repositoryKnowledgeEnabled: envBoolean.default(true),
    repositoryKnowledgeWrite: envBoolean.default(false),
    r2Endpoint: optionalString,
    r2BucketName: optionalString,
    r2Prefix: optionalString,
    r2AccessKeyId: optionalString,
    r2SecretAccessKey: optionalString,
    triageEnabled: envBoolean.default(true),
    triageLabels: csvListWithDefault([
      "bug",
      "enhancement",
      "documentation",
      "question",
      "maintenance"
    ]).refine((labels) => labels.length > 0, "TRIAGE_LABELS must contain at least one label."),
    triageDuplicateLabel: z.string().min(1).default("duplicate"),
    triageCandidateLimit: z.coerce.number().int().positive().max(100).default(50),
    triageInstructions: optionalString,
    botName: z.string().min(1).default("ghbot"),
    autoMerge: envBoolean.default(false),
    autoResolveConflicts: envBoolean.default(false),
    conflictTestCommand: optionalString,
    mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
    requireChecks: envBoolean.default(true),
    maxPatchChars: z.coerce.number().int().positive().default(120_000),
    logLevel: z.string().min(1).default("info")
  })
  .superRefine((value, ctx) => {
    if (value.webhookEnabled && !value.webhookSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["webhookSecret"],
        message: "WEBHOOK_SECRET is required when WEBHOOK_ENABLED=true."
      });
    }

    const r2Values = [
      value.r2Endpoint,
      value.r2BucketName,
      value.r2AccessKeyId,
      value.r2SecretAccessKey
    ];
    const configuredR2Values = r2Values.filter(Boolean).length;
    if (configuredR2Values > 0 && configuredR2Values < r2Values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["r2Endpoint"],
        message:
          "R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be configured together."
      });
    }
  });

export const config = configSchema.parse({
  port: process.env.PORT,
  githubToken: process.env.GITHUB_TOKEN,
  githubAppId: process.env.GH_APP_ID ?? process.env.GITHUB_APP_ID,
  githubAppPrivateKey: process.env.GH_APP_PRIVATE_KEY ?? process.env.GITHUB_APP_PRIVATE_KEY,
  githubAppInstallationId:
    process.env.GH_APP_INSTALLATION_ID ?? process.env.GITHUB_APP_INSTALLATION_ID,
  webhookEnabled: process.env.WEBHOOK_ENABLED,
  webhookSecret: process.env.WEBHOOK_SECRET,
  webhookPath: process.env.WEBHOOK_PATH,
  webhookChatPermission: process.env.WEBHOOK_CHAT_PERMISSION,
  webhookQueueConcurrency: process.env.WEBHOOK_QUEUE_CONCURRENCY,
  webhookQueueLimit: process.env.WEBHOOK_QUEUE_LIMIT,
  runtimeDirectory: process.env.GHBOT_RUNTIME_DIR,
  gooseModel: process.env.GOOSE_MODEL ?? process.env.OPENCODE_MODEL,
  gooseThinkingEffort: process.env.GOOSE_THINKING_EFFORT ?? process.env.OPENCODE_REASONING_EFFORT,
  gooseBaseUrl: process.env.GOOSE_BASE_URL ?? process.env.OPENCODE_BASE_URL,
  gooseApiKey: process.env.GOOSE_API_KEY ?? process.env.OPENCODE_API_KEY,
  reviewPolicy: process.env.REVIEW_POLICY,
  reviewStrictness: process.env.REVIEW_STRICTNESS,
  reviewInstructions: process.env.REVIEW_INSTRUCTIONS,
  reviewBranches: process.env.REVIEW_BRANCHES,
  repositoryKnowledgeEnabled: process.env.REPOSITORY_KNOWLEDGE_ENABLED,
  repositoryKnowledgeWrite: process.env.REPOSITORY_KNOWLEDGE_WRITE,
  r2Endpoint: process.env.R2_ENDPOINT,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2Prefix: process.env.R2_PREFIX,
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  triageEnabled: process.env.TRIAGE_ENABLED,
  triageLabels: process.env.TRIAGE_LABELS,
  triageDuplicateLabel: process.env.TRIAGE_DUPLICATE_LABEL,
  triageCandidateLimit: process.env.TRIAGE_CANDIDATE_LIMIT,
  triageInstructions: process.env.TRIAGE_INSTRUCTIONS,
  botName: process.env.BOT_NAME,
  autoMerge: process.env.AUTO_MERGE,
  autoResolveConflicts: process.env.AUTO_RESOLVE_CONFLICTS,
  conflictTestCommand: process.env.CONFLICT_TEST_COMMAND,
  mergeMethod: process.env.MERGE_METHOD,
  requireChecks: process.env.REQUIRE_CHECKS,
  maxPatchChars: process.env.MAX_PATCH_CHARS,
  logLevel: process.env.LOG_LEVEL
});
