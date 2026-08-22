#!/usr/bin/env node
/**
 * Windows 兼容的 pre-commit 钩子安装器（不使用 .sh 业务脚本）。
 * 钩子内部用仓库相对路径调用 Node 脚本，避免绝对路径中的空格/中文目录问题。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const gitDir = path.join(root, ".git");
const hooksDir = path.join(gitDir, "hooks");
const hookPath = path.join(hooksDir, "pre-commit");

if (!fs.existsSync(gitDir)) {
  console.warn("[install-husky] 未找到 .git 目录（例如在 CI 中），跳过 pre-commit 钩子安装。");
  process.exit(0);
}

fs.mkdirSync(hooksDir, { recursive: true });

// git hooks 以仓库根为工作目录，相对路径在 Windows 与 POSIX 下都可靠。
const hookScript = ["#!/bin/sh", 'node scripts/husky-pre-commit.cjs'].join("\n");

fs.writeFileSync(hookPath, `${hookScript}\n`, { mode: 0o755 });
console.log(`[install-husky] 已写入 git pre-commit 钩子: ${hookPath}`);