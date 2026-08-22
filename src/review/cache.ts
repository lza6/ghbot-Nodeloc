import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logger } from "../logger.js";
import type { ReviewDecision } from "../types.js";

const findingSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  title: z.string(),
  body: z.string()
});

const reviewDecisionSchema = z.object({
  review: z.array(findingSchema),
  change: z.array(findingSchema),
  comment: z.string(),
  result: z.object({
    canMerge: z.boolean(),
    summary: z.string(),
    shouldClosePullRequest: z.boolean(),
    closeReason: z.string()
  })
});

const reviewCacheSchema = z.object({
  version: z.literal(1),
  repository: z.string(),
  pullNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  reviewedAt: z.string().datetime(),
  decision: reviewDecisionSchema
});

export function parseReviewCacheContent(content: string) {
  return reviewCacheSchema.parse(JSON.parse(content));
}

export function validateReviewCacheContent(content: string): void {
  parseReviewCacheContent(content);
}

export type PreviousReview = {
  headSha: string;
  reviewedAt: string;
  decision: ReviewDecision;
};

export async function loadPreviousReview(params: {
  owner: string;
  repo: string;
  pullNumber: number;
  currentHeadSha: string;
}): Promise<PreviousReview | undefined> {
  try {
    const raw = await fs.readFile(cachePath(params.pullNumber), "utf8");
    const cached = reviewCacheSchema.parse(JSON.parse(raw));

    if (
      cached.repository !== `${params.owner}/${params.repo}` ||
      cached.pullNumber !== params.pullNumber ||
      cached.headSha === params.currentHeadSha
    ) {
      return undefined;
    }

    return {
      headSha: cached.headSha,
      reviewedAt: cached.reviewedAt,
      decision: cached.decision
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }

    logger.warn(
      { error, pullNumber: params.pullNumber },
      "Ignoring invalid previous review cache."
    );
    return undefined;
  }
}

export async function saveReviewCache(params: {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  decision: ReviewDecision;
}): Promise<void> {
  const target = cachePath(params.pullNumber);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    `${JSON.stringify(
      {
        version: 1,
        repository: `${params.owner}/${params.repo}`,
        pullNumber: params.pullNumber,
        headSha: params.headSha,
        reviewedAt: new Date().toISOString(),
        decision: params.decision
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function deleteLocalReviewCache(pullNumber: number): Promise<void> {
  await fs.rm(cachePath(pullNumber), { force: true });
}

function cachePath(pullNumber: number): string {
  return path.join(process.cwd(), ".ghbot-cache", `pr-${pullNumber}.json`);
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
