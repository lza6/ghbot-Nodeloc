#!/usr/bin/env node
/**
 * Windows 兼容的 husky 安装器（不使用 .sh 脚本）。
 * 用本仓库自带的 Node 脚本把 husky 的 prepare 钩子写到 .git/hooks/pre-commit。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const gitDir = path.join(root, ".git");
const hooksDir = path.join(gitDir, "hooks");
const hookPath = path.join(hooksDir, "pre-commit");

if (!fs.existsSync(gitDir)) {
  console.warn("[install-husky] 未找到 .git 目录（例如在 CI 中），跳过 pre-commit 钩子安装。");
  process.exit(0);
}

fs.mkdirSync(hooksDir, { recursive: true });

const separator = os.platform() === "win32" ? "\\" : "/";
const nodeBinary = process.execPath;
const hookScript = [
  "#!/bin/sh",
  `node "${nodeBinary.replace(/\\/g, "/")}" "${path.join(root, "scripts", "husky-pre-commit.cjs").replace(/\\/g, "/")}"`,
].join("\n");

fs.writeFileSync(hookPath, `${hookScript}\n`, { mode: 0o755 });
console.log(`[install-husky] 已写入 git pre-commit 钩子: ${hookPath}`);