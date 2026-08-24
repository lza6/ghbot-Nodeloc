/**
 * MergeGuard prevents duplicate merge attempts by tracking recently-attempted
 * PR merge operations in memory. It is not persisted across restarts.
 */
export class MergeGuard {
  #attempted = new Set<string>();
  #recentAttempts: string[] = [];

  /**
   * Build a stable key for a PR.
   */
  static #key(owner: string, repo: string, pullNumber: number): string {
    return `${owner}/${repo}#${pullNumber}`;
  }

  /**
   * Returns true if a merge has already been attempted for this PR.
   */
  isAlreadyAttempted(owner: string, repo: string, pullNumber: number): boolean {
    return this.#attempted.has(MergeGuard.#key(owner, repo, pullNumber));
  }

  /**
   * Record a merge attempt for the given PR.
   */
  markAttempt(owner: string, repo: string, pullNumber: number): void {
    const key = MergeGuard.#key(owner, repo, pullNumber);
    this.#attempted.add(key);
    this.#recentAttempts.push(key);
  }

  /**
   * Returns the total number of recorded merge attempts across all PRs.
   */
  getAttemptedCount(): number {
    return this.#recentAttempts.length;
  }

  /**
   * Returns the list of recently-attempted PR keys, in the order they were
   * first attempted.
   */
  getRecentAttempts(): string[] {
    return [...this.#recentAttempts];
  }
}
