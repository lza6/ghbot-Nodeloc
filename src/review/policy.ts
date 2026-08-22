import { config } from "../config.js";
import type { ReviewDecision, ReviewMode } from "../types.js";

export type ReviewDisposition = {
  event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  blocksMerge: boolean;
  requiresAdminApproval: boolean;
  outcome: "pass" | "block";
};

export type BotReviewOutcome = {
  mode: ReviewMode;
  outcome: "pass" | "block";
  requiresAdminApproval: boolean;
};

type ReviewState = {
  id?: number;
  state: string;
  commitId: string | null;
  login?: string;
  submittedAt?: string | null;
};

export function evaluateReviewDecision(
  decision: ReviewDecision,
  reviewPolicy: "allow" | "require_approval" | "reject" = config.reviewPolicy
): ReviewDisposition {
  const modelBlocksMerge =
    decision.result.shouldClosePullRequest ||
    !decision.result.canMerge ||
    decision.change.length > 0;
  const policyBlocksReviewNotes = reviewPolicy === "reject" && decision.review.length > 0;
  const blocksMerge = modelBlocksMerge || policyBlocksReviewNotes;

  if (blocksMerge) {
    return {
      event: "REQUEST_CHANGES",
      blocksMerge: true,
      requiresAdminApproval: false,
      outcome: "block"
    };
  }

  const requiresAdminApproval = reviewPolicy === "require_approval" && decision.review.length > 0;

  return {
    event: requiresAdminApproval ? "COMMENT" : "APPROVE",
    blocksMerge: false,
    requiresAdminApproval,
    outcome: "pass"
  };
}

export function isReviewBranchEnabled(baseBranch: string): boolean {
  if (config.reviewBranches.length === 0) {
    return true;
  }

  return config.reviewBranches.some((pattern) => branchPatternToRegExp(pattern).test(baseBranch));
}

export function approvedLoginsForHead(reviews: ReviewState[], headSha: string): string[] {
  const latestDecisionByLogin = new Map<string, "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED">();
  const orderedReviews = [...reviews].sort((left, right) => {
    const timeDifference = reviewTimestamp(left.submittedAt) - reviewTimestamp(right.submittedAt);
    return timeDifference || (left.id ?? 0) - (right.id ?? 0);
  });

  for (const review of orderedReviews) {
    if (
      review.commitId !== headSha ||
      !review.login ||
      !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)
    ) {
      continue;
    }

    latestDecisionByLogin.set(
      review.login,
      review.state as "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED"
    );
  }

  return [...latestDecisionByLogin]
    .filter(([, state]) => state === "APPROVED")
    .map(([login]) => login);
}

export function formatReviewStateMarker(
  mode: ReviewMode,
  disposition: ReviewDisposition,
  reviewCount: number,
  changeCount: number
): string {
  return `<!-- ghbot-review:v1 mode=${mode} outcome=${disposition.outcome} requires-admin=${disposition.requiresAdminApproval} review=${reviewCount} change=${changeCount} -->`;
}

export function formatReviewExternalId(mode: ReviewMode, disposition: ReviewDisposition): string {
  return `ghbot-review:v1:mode=${mode}:outcome=${disposition.outcome}:requires-admin=${disposition.requiresAdminApproval}`;
}

export function parseReviewExternalId(value: string | null | undefined): BotReviewOutcome | null {
  if (!value) {
    return null;
  }

  const match =
    /^ghbot-review:v1:mode=(strict|normal|lenient):outcome=(pass|block):requires-admin=(true|false)$/.exec(
      value
    );
  if (!match) {
    return null;
  }

  return {
    mode: normalizeReviewMode(match[1]),
    outcome: match[2] as "pass" | "block",
    requiresAdminApproval: match[3] === "true"
  };
}

export function parseReviewStateMarker(body: string | null | undefined): BotReviewOutcome | null {
  if (!body) {
    return null;
  }

  const match =
    /<!-- ghbot-review:v1 mode=(strict|normal|lenient) outcome=(pass|block) requires-admin=(true|false) review=\d+ change=\d+ -->/.exec(
      body
    );
  if (!match) {
    return null;
  }

  return {
    mode: normalizeReviewMode(match[1]),
    outcome: match[2] as "pass" | "block",
    requiresAdminApproval: match[3] === "true"
  };
}

function normalizeReviewMode(value: string): ReviewMode {
  return value === "strict" ? "strict" : "normal";
}

export function branchPatternToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    source += character?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "";
  }

  return new RegExp(`${source}$`);
}

function reviewTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
