/**
 * Git pre-commit 钩子（Node 版，Windows/Linux/macOS 通用）。
 * 执行：磁盘上语法/完整性检查 + 生成物提交防护。
 */
"use strict";

const { execSync } = require("node:child_process");

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

// 1) 暂存区生成物防护：graft/、.codegraph/、.code-review-graph/、dist/ 等不允许进仓库。
const staged = run("git diff --cached --name-only").split("\n").filter(Boolean);
const blockedPrefixes = ["graft/", ".codegraph/", ".code-review-graph/", "dist/", ".ghbot-tmp/"];
const blocked = staged.filter((file) => blockedPrefixes.some((p) => file === p.slice(0, -1) || file.startsWith(p)));
if (blocked.length > 0) {
  console.error("[pre-commit] BLOCKED：以下生成物/索引文件被暂存，已拒绝提交：");
  blocked.forEach((f) => console.error(`  - ${f}`));
  console.error("请先 git rm --cached -r 它们。");
  process.exit(1);
}

// 2) 磁盘上被修改过的 TS 文件跑一轮 tsc（增量，仅当本机装了 typescript）。
const changedTs = staged
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => f.replace(/\\/g, "/"));
if (changedTs.length > 0) {
  const tsc = run("npm run typecheck");
  if (tsc && /error TS\d+/.test(tsc)) {
    console.error("[pre-commit] TypeScript 类型错误，已阻止提交：");
    console.error(tsc.split("\n").filter((l) => /error TS/.test(l)).slice(0, 20).join("\n"));
    process.exit(1);
  }
}

process.exit(0);