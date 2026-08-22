import type { ReviewDecision } from "../types.js";

export type NormalizedReviewDecision = {
  decision: ReviewDecision;
  warnings: string[];
};

/**
 * Sanitize a model-produced review decision before it drives merge policy:
 * - drop findings that point at files outside the PR or at invalid lines
 *   (they cannot be posted inline and would otherwise be lost silently),
 * - force the conservative canMerge=false when blocking findings exist,
 *   even if the model claimed the result was safe.
 */
export function normalizeReviewDecision(
  decision: ReviewDecision,
  knownPaths: string[]
): NormalizedReviewDecision {
  const warnings: string[] = [];
  const known = new Set(knownPaths);

  const keepFinding = (
    finding: { path: string; line: number; title: string },
    category: "review" | "change"
  ) => {
    if (!known.has(finding.path)) {
      warnings.push(
        `${category} finding for unknown file ${finding.path}:${finding.line} (${finding.title})`
      );
      return false;
    }
    if (!Number.isInteger(finding.line) || finding.line <= 0) {
      warnings.push(
        `${category} finding with invalid line ${finding.path}:${finding.line} (${finding.title})`
      );
      return false;
    }
    return true;
  };

  const review = decision.review.filter((finding) => keepFinding(finding, "review"));
  const change = decision.change.filter((finding) => keepFinding(finding, "change"));

  const canMerge = change.length > 0 ? false : decision.result.canMerge;

  return {
    decision: {
      ...decision,
      review,
      change,
      result: { ...decision.result, canMerge }
    },
    warnings
  };
}
