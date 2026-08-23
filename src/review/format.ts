import type { ReviewDecision, ReviewFinding, ReviewMode } from "../types.js";
import { config } from "../config.js";
import { formatReviewStateMarker, type ReviewDisposition } from "./policy.js";

export type CategorizedFinding = ReviewFinding & {
  category: "review" | "change";
};

export function formatReviewBody(
  decision: ReviewDecision,
  unpostedFindings: CategorizedFinding[],
  mode: ReviewMode,
  disposition: ReviewDisposition
): string {
  const lines = [
    formatReviewStateMarker(mode, disposition, decision.review.length, decision.change.length),
    `## Automated review`,
    "",
    formatStatusBanner(disposition, decision),
    "",
    `Mode: ${mode}`,
    ""
  ];

  if (decision.change.length > 0) {
    lines.push(
      `### Change request`,
      "",
      `${decision.change.length} blocking finding(s) were submitted first as a change request.`,
      ""
    );
  }

  if (decision.review.length > 0) {
    lines.push(
      `### Review`,
      "",
      `${decision.review.length} non-blocking review note(s) were submitted after the change request.`,
      ""
    );
  }

  lines.push(
    `### Comment`,
    "",
    decision.comment,
    "",
    `### Result for maintainers`,
    "",
    decision.result.summary,
    "",
    ...(decision.result.shouldClosePullRequest
      ? [`Close PR: yes`, "", `Close reason: ${decision.result.closeReason}`, ""]
      : []),
    `Model decision: ${decision.result.canMerge && decision.change.length === 0 ? "safe to merge" : "do not merge"}`,
    `Applied review policy: ${config.reviewPolicy}`,
    `Final status: ${formatDisposition(disposition)}`,
    "",
    `**Required changes: ${decision.change.length}**`,
    `**Review notes: ${decision.review.length}**`
  );

  if (decision.change.length > 0 && !decision.result.shouldClosePullRequest) {
    lines.push("", "After updating the pull request, comment `/recheck` to run the review again.");
  }

  if (unpostedFindings.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Findings that could not be attached inline (${unpostedFindings.length})</summary>`,
      ""
    );
    for (const finding of unpostedFindings) {
      lines.push(
        "",
        `- ${finding.path}:${finding.line} [${finding.category}] ${finding.title}`,
        `  ${finding.body}`
      );
    }
    lines.push("", "</details>");
  }

  return lines.join("\n");
}

function formatStatusBanner(disposition: ReviewDisposition, decision: ReviewDecision): string {
  if (decision.result.shouldClosePullRequest) {
    return "> 🚨 **Malicious code detected — this pull request will be closed.**";
  }
  if (disposition.blocksMerge) {
    return "> ❌ **Changes requested** — blocking findings must be fixed before merge.";
  }
  if (disposition.requiresAdminApproval) {
    return "> ⏸️ **Waiting for administrator approval** — review notes require an admin approval of this head commit.";
  }
  return "> ✅ **Safe to merge** under the configured review policy.";
}

export function formatFindingReviewBody(
  decision: ReviewDecision,
  category: "review" | "change",
  unpostedFindings: CategorizedFinding[],
  mode: ReviewMode,
  disposition: ReviewDisposition
): string {
  const findings = category === "change" ? decision.change : decision.review;
  const lines = [
    formatReviewStateMarker(mode, disposition, decision.review.length, decision.change.length),
    `## ${category === "change" ? "Change request" : "Review"}`,
    "",
    category === "change"
      ? "These blocking findings must be fixed before the pull request can merge."
      : "These are non-blocking review notes for the pull request author.",
    "",
    `Findings: ${findings.length}`
  ];

  if (unpostedFindings.length > 0) {
    lines.push("", "Findings that could not be attached inline:");
    for (const finding of unpostedFindings) {
      lines.push(
        "",
        `- ${finding.path}:${finding.line} [${finding.category}] ${finding.title}`,
        `  ${finding.body}`
      );
    }
  }

  return lines.join("\n");
}

function formatDisposition(disposition: ReviewDisposition): string {
  if (disposition.blocksMerge) {
    return "changes requested";
  }

  if (disposition.requiresAdminApproval) {
    return "waiting for repository administrator approval";
  }

  return "safe to merge";
}
