import type { PullRequestFile } from "../types.js";

export type StalenessDecision =
  { action: "unchanged" } | { action: "append"; additionalPrompt: string } | { action: "discard" };

/**
 * Evaluate whether a head SH change during LLM review should be:
 * - "unchanged": head did not change; proceed normally
 * - "append": head changed with a small additive delta; append a suffix to a
 *             new prompt so the model re-checks without a full re-run
 * - "discard": head changed with a large or non-additive delta; drop the
 *              stale result and re-review from scratch
 */
export function evaluateReviewStaleness(params: {
  beforeFiles: PullRequestFile[];
  afterFiles: PullRequestFile[];
  oldHeadSha: string;
  newHeadSha: string;
  maxPatchChars: number;
}): StalenessDecision {
  if (params.oldHeadSha === params.newHeadSha) {
    return { action: "unchanged" };
  }

  const beforeNames = new Set(params.beforeFiles.map((file) => file.filename));

  // Detect any file that was removed or modified beyond addition. If a file
  // existed before and its patch differs, it is not a pure additive delta.
  for (const file of params.afterFiles) {
    if (!beforeNames.has(file.filename)) {
      continue;
    }
    const before = params.beforeFiles.find((item) => item.filename === file.filename);
    if (!before || before.patch !== file.patch) {
      return { action: "discard" };
    }
  }

  // Collect newly added files only (files that did not exist before).
  const addedFiles = params.afterFiles.filter((file) => !beforeNames.has(file.filename));
  const addedPatchChars = addedFiles.reduce((total, file) => total + (file.patch?.length ?? 0), 0);

  if (addedPatchChars > params.maxPatchChars / 2) {
    return { action: "discard" };
  }

  const addedSuffix = addedFiles
    .map((file) => ({ path: file.filename, patch: file.patch ?? "" }))
    .filter((file) => file.patch.length > 0);

  if (addedSuffix.length === 0) {
    return { action: "discard" };
  }

  return {
    action: "append",
    additionalPrompt: [
      "Additional changes were pushed while the review was running.",
      "Re-evaluate only the additions below against the existing review context.",
      JSON.stringify(addedSuffix, null, 2)
    ].join("\n")
  };
}
