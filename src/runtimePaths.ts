import path from "node:path";
import process from "node:process";

/**
 * Runtime scratch/cache directories live under one configurable root so
 * deployments with read-only or restricted working directories (D-13) can move
 * them without code changes. Defaults to the process working directory.
 */
export function runtimeDirectory(): string {
  const configured = process.env.GHBOT_RUNTIME_DIR?.trim();
  return configured ? configured : process.cwd();
}

export function tempRootDirectory(): string {
  return path.join(runtimeDirectory(), ".ghbot-tmp");
}

export function cacheRootDirectory(): string {
  return path.join(runtimeDirectory(), ".ghbot-cache");
}
