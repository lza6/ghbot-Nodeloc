import type { PullRequestFile } from "../types.js";

export function compactFilesForReview(
  files: PullRequestFile[],
  maxPatchChars: number
): PullRequestFile[] {
  let remaining = maxPatchChars;

  return files.map((file) => {
    if (!file.patch || remaining <= 0) {
      return { ...file, patch: undefined };
    }

    const patch = file.patch.slice(0, remaining);
    remaining -= patch.length;

    return {
      ...file,
      patch: patch.length < file.patch.length ? `${patch}\n[patch truncated]` : patch
    };
  });
}
