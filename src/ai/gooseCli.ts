import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { startOneRunApiProxy } from "./apiProxy.js";

const GOOSE_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const GOOSE_DOCKER_IMAGE = "node:24-bookworm";
const GOOSE_DOCKER_VERSION = "v1.46.0";
const GOOSE_CONTAINER_PATH = "/usr/local/bin/goose";
const ISOLATED_VALIDATION_WORKSPACE = "/tmp/ghbot-validation-workspace";
const GOOSE_CONTAINER_BOOTSTRAP = [
  "set -eu",
  "cleanup_workspace() { chmod -R a+rwX /workspace 2>/dev/null || true; }",
  "trap cleanup_workspace EXIT",
  'mkdir -p "$HOME"',
  "git config --global --add safe.directory /workspace",
  "if ! command -v goose >/dev/null 2>&1; then",
  "  curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh -o /tmp/download_cli.sh",
  `  if ! GOOSE_VERSION="${GOOSE_DOCKER_VERSION}" GOOSE_BIN_DIR=/tmp/goose-bin CONFIGURE=false bash /tmp/download_cli.sh >/tmp/goose-install.log 2>&1; then`,
  "    cat /tmp/goose-install.log >&2",
  "    exit 1",
  "  fi",
  '  export PATH="/tmp/goose-bin:$PATH"',
  "fi",
  'goose "$@"'
].join("\n");
const GOOSE_WORKSPACE_PERMISSION_SCRIPT = [
  "set -eu",
  "find /workspace \\( -type d -o -type f \\) -uid 0 -exec chmod a+rwX {} +"
].join("\n");
const ISOLATED_VALIDATION_BOOTSTRAP = [
  "set -eu",
  'mkdir -p "$HOME"',
  `validation_workspace="${ISOLATED_VALIDATION_WORKSPACE}"`,
  'mkdir -p "$validation_workspace"',
  'cp -R --no-preserve=ownership /workspace/. "$validation_workspace/"',
  'chmod -R u+rwX "$validation_workspace"',
  'cd "$validation_workspace"',
  'git config --global --add safe.directory "$validation_workspace"',
  'exec sh -lc "$1"'
].join("\n");

export async function runGoosePrompt(
  prompt: string,
  options: {
    workingDirectory?: string;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  if (!config.gooseApiKey) {
    throw new Error("GOOSE_API_KEY is required when running a goose prompt.");
  }

  const tempRoot = path.join(process.cwd(), ".ghbot-tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempRoot, "goose-"));
  const workingDirectory = options.workingDirectory
    ? await fs.realpath(options.workingDirectory)
    : process.cwd();
  const args = [
    "run",
    "--no-session",
    "--no-profile",
    "--quiet",
    "--output-format",
    "json",
    "--provider",
    "openai",
    "--model",
    config.gooseModel,
    "--text",
    prompt
  ];

  logger.info(
    {
      model: config.gooseModel,
      thinkingEffort: config.gooseThinkingEffort,
      baseUrl: normalizeBaseUrl(config.gooseBaseUrl)
    },
    "Running goose prompt."
  );

  try {
    const stdout = await runGoose(
      args,
      buildGooseEnv(tempDir),
      workingDirectory,
      options.timeoutMs
    );
    return extractGooseFinalText(stdout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function runGooseAgent(
  prompt: string,
  workingDirectory: string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  if (!config.gooseApiKey) {
    throw new Error("GOOSE_API_KEY is required when running a goose agent.");
  }

  const realWorkingDirectory = await fs.realpath(workingDirectory);
  const proxy = await startOneRunApiProxy(
    normalizeBaseUrl(config.gooseBaseUrl),
    config.gooseApiKey
  );
  const containerName = `ghbot-agent-${randomBytes(12).toString("hex")}`;
  const hostGooseBinary = await resolveHostGooseBinary();
  const containerEnv = buildGooseAgentEnvironment({
    apiToken: proxy.token,
    proxyPort: proxy.port
  });
  const args = buildGooseAgentDockerArgs({
    containerName,
    realWorkingDirectory,
    containerEnv,
    hostGooseBinary,
    prompt
  });

  try {
    const stdout = await runProcess(
      "docker",
      args,
      containerEnv,
      realWorkingDirectory,
      "goose agent container",
      options.timeoutMs
    );
    return extractGooseFinalText(stdout);
  } finally {
    try {
      await removeDockerContainer(containerName, realWorkingDirectory);
    } finally {
      try {
        await restoreAgentWorkspacePermissions(realWorkingDirectory);
      } finally {
        await proxy.close();
      }
    }
  }
}

export async function runIsolatedWorkspaceCommand(
  command: string,
  workingDirectory: string,
  options: { timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const realWorkingDirectory = await fs.realpath(workingDirectory);
  const containerName = `ghbot-validation-${randomBytes(12).toString("hex")}`;
  const args = buildIsolatedWorkspaceCommandDockerArgs({
    containerName,
    realWorkingDirectory,
    command
  });

  try {
    const stdout = await runProcess(
      "docker",
      args,
      {},
      realWorkingDirectory,
      "isolated repository validation",
      options.timeoutMs
    );
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    if (isProcessExitError(error)) {
      return {
        code: typeof error.code === "number" ? error.code : 1,
        stdout: typeof error.stdout === "string" ? error.stdout : "",
        stderr: typeof error.stderr === "string" ? error.stderr : ""
      };
    }
    throw error;
  } finally {
    await removeDockerContainer(containerName, realWorkingDirectory);
  }
}

export function buildGooseAgentEnvironment(params: {
  apiToken: string;
  proxyPort: number;
}): Record<string, string> {
  return {
    HOME: "/tmp/goose-home",
    XDG_CONFIG_HOME: "/tmp/goose-home/config",
    XDG_DATA_HOME: "/tmp/goose-home/data",
    XDG_STATE_HOME: "/tmp/goose-home/state",
    XDG_CACHE_HOME: "/tmp/goose-home/cache",
    GOOSE_PROVIDER: "openai",
    GOOSE_MODEL: config.gooseModel,
    GOOSE_MODE: "auto",
    GOOSE_DISABLE_KEYRING: "true",
    GOOSE_DISABLE_SESSION_NAMING: "true",
    GOOSE_TELEMETRY_ENABLED: "false",
    GOOSE_MAX_TURNS: "50",
    CONTEXT_FILE_NAMES: "[]",
    OPENAI_API_KEY: params.apiToken,
    OPENAI_BASE_URL: `http://host.docker.internal:${params.proxyPort}/v1`,
    OPENAI_TIMEOUT: "600",
    ...(config.gooseThinkingEffort ? { GOOSE_THINKING_EFFORT: config.gooseThinkingEffort } : {})
  };
}

export function buildGooseAgentDockerArgs(params: {
  containerName: string;
  realWorkingDirectory: string;
  containerEnv: Record<string, string>;
  prompt: string;
  hostGooseBinary?: string;
}): string[] {
  return [
    "run",
    "--name",
    params.containerName,
    "--init",
    "--user",
    "root",
    "--cpus",
    "2",
    "--memory",
    "4g",
    "--pids-limit",
    "512",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--add-host",
    "host.docker.internal:host-gateway",
    "--mount",
    `type=bind,source=${params.realWorkingDirectory},target=/workspace`,
    ...(params.hostGooseBinary
      ? [
          "--mount",
          `type=bind,source=${params.hostGooseBinary},target=${GOOSE_CONTAINER_PATH},readonly`
        ]
      : []),
    "--workdir",
    "/workspace",
    ...Object.keys(params.containerEnv).flatMap((key) => ["--env", key]),
    GOOSE_DOCKER_IMAGE,
    "sh",
    "-lc",
    GOOSE_CONTAINER_BOOTSTRAP,
    "ghbot",
    "run",
    "--no-session",
    "--no-profile",
    "--quiet",
    "--output-format",
    "json",
    "--provider",
    "openai",
    "--model",
    config.gooseModel,
    "--with-builtin",
    "developer",
    "--text",
    params.prompt
  ];
}

export function buildWorkspacePermissionDockerArgs(realWorkingDirectory: string): string[] {
  return [
    "run",
    "--rm",
    "--init",
    "--user",
    "root",
    "--cpus",
    "1",
    "--memory",
    "256m",
    "--pids-limit",
    "64",
    "--network",
    "none",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--mount",
    `type=bind,source=${realWorkingDirectory},target=/workspace`,
    "--workdir",
    "/workspace",
    GOOSE_DOCKER_IMAGE,
    "sh",
    "-lc",
    GOOSE_WORKSPACE_PERMISSION_SCRIPT
  ];
}

export function buildIsolatedWorkspaceCommandDockerArgs(params: {
  containerName: string;
  realWorkingDirectory: string;
  command: string;
}): string[] {
  return [
    "run",
    "--name",
    params.containerName,
    "--init",
    "--user",
    "root",
    "--cpus",
    "2",
    "--memory",
    "4g",
    "--pids-limit",
    "512",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--mount",
    `type=bind,source=${params.realWorkingDirectory},target=/workspace,readonly`,
    "--workdir",
    "/workspace",
    "--env",
    "HOME=/tmp/ghbot-validation-home",
    "--env",
    "CI=true",
    GOOSE_DOCKER_IMAGE,
    "sh",
    "-lc",
    ISOLATED_VALIDATION_BOOTSTRAP,
    "ghbot-validation",
    params.command
  ];
}

async function restoreAgentWorkspacePermissions(realWorkingDirectory: string): Promise<void> {
  await runProcess(
    "docker",
    buildWorkspacePermissionDockerArgs(realWorkingDirectory),
    {},
    realWorkingDirectory,
    "goose agent workspace permission cleanup"
  );
}

async function resolveHostGooseBinary(): Promise<string | undefined> {
  const configuredPath = process.env.GHBOT_GOOSE_BINARY?.trim();
  if (!configuredPath || process.platform !== "linux") {
    return undefined;
  }

  try {
    const resolvedPath = await fs.realpath(configuredPath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile() || resolvedPath.includes(",")) {
      throw new Error("configured Goose binary is not a mountable file path");
    }
    await fs.access(resolvedPath, fsConstants.X_OK);
    logger.info(
      { hostGooseBinary: resolvedPath },
      "Using the workflow Goose binary inside the agent container."
    );
    return resolvedPath;
  } catch (error) {
    logger.warn(
      { error, configuredPath },
      "Configured workflow Goose binary is unavailable; falling back to an in-container install."
    );
    return undefined;
  }
}

function buildGooseEnv(tempDir: string): Record<string, string> {
  return {
    HOME: path.join(tempDir, "home"),
    XDG_CONFIG_HOME: path.join(tempDir, "config"),
    XDG_DATA_HOME: path.join(tempDir, "data"),
    XDG_STATE_HOME: path.join(tempDir, "state"),
    XDG_CACHE_HOME: path.join(tempDir, "cache"),
    GOOSE_PROVIDER: "openai",
    GOOSE_MODEL: config.gooseModel,
    GOOSE_MODE: "chat",
    GOOSE_DISABLE_KEYRING: "true",
    GOOSE_DISABLE_SESSION_NAMING: "true",
    GOOSE_TELEMETRY_ENABLED: "false",
    GOOSE_MAX_TURNS: "2",
    CONTEXT_FILE_NAMES: "[]",
    OPENAI_API_KEY: config.gooseApiKey ?? "",
    OPENAI_BASE_URL: normalizeBaseUrl(config.gooseBaseUrl),
    OPENAI_TIMEOUT: "600",
    ...(config.gooseThinkingEffort ? { GOOSE_THINKING_EFFORT: config.gooseThinkingEffort } : {})
  };
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function runGoose(
  args: string[],
  extraEnv: Record<string, string>,
  workingDirectory: string,
  timeoutMs?: number
): Promise<string> {
  return runProcess("goose", args, extraEnv, workingDirectory, "goose process", timeoutMs);
}

async function runProcess(
  command: string,
  args: string[],
  extraEnv: Record<string, string>,
  workingDirectory: string,
  label: string,
  timeoutMs = GOOSE_RUN_TIMEOUT_MS
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const childEnv = buildChildEnv(extraEnv);
    logger.info(
      {
        cmd: command,
        args: redactProcessArgs(args, label),
        timeoutMs
      },
      `Spawning ${label}.`
    );

    const child = spawn(command, args, {
      cwd: workingDirectory,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      reject(
        Object.assign(new Error(`${label} timed out after ${timeoutMs}ms.`), { stdout, stderr })
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      streamStderr(text, label);
    });
    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      logger.info({ code, signal }, `${label} exited.`);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        Object.assign(
          new Error(`${label} exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`),
          { code, signal, stdout, stderr }
        )
      );
    });
  });
}

function isProcessExitError(error: unknown): error is {
  code?: number | null;
  stdout?: string;
  stderr?: string;
} {
  return typeof error === "object" && error !== null && "code" in error;
}

async function removeDockerContainer(
  containerName: string,
  workingDirectory: string
): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("docker", ["rm", "--force", containerName], {
      cwd: workingDirectory,
      env: buildChildEnv({}),
      stdio: "ignore"
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

function buildChildEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "USER",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "CI",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR"
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  Object.assign(env, extraEnv);
  return env;
}

export function extractGooseFinalText(stdout: string): string {
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch (error) {
    throw new Error("goose did not emit valid JSON output.", { cause: error });
  }

  if (typeof result !== "object" || result === null || !("messages" in result)) {
    throw new Error("goose JSON output did not contain messages.");
  }

  const messages = result.messages;
  if (!Array.isArray(messages)) {
    throw new Error("goose JSON output messages were invalid.");
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      message.role !== "assistant" ||
      !("content" in message) ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    const content = message.content as unknown[];
    const text = content
      .filter(
        (item: unknown): item is { type: "text"; text: string } =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
      )
      .map((item: { type: "text"; text: string }) => item.text)
      .join("")
      .trim();
    if (text) {
      return stripMarkdownFence(text);
    }
  }

  throw new Error("goose did not emit a final assistant text result.");
}

function stripMarkdownFence(value: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim());
  return match?.[1]?.trim() ?? value.trim();
}

function redactPrompt(args: string[]): string[] {
  const textIndex = args.indexOf("--text");
  if (textIndex < 0) {
    return [...args];
  }
  const promptIndex = textIndex + 1;
  return args.map((arg, index) =>
    index === promptIndex ? `[goose prompt: ${arg.length} chars]` : arg
  );
}

export function redactProcessArgs(args: string[], label: string): string[] {
  const redacted = redactPrompt(args);
  if (label === "isolated repository validation" && redacted.length > 0) {
    const commandIndex = redacted.length - 1;
    redacted[commandIndex] = `[validation command: ${args[commandIndex]?.length ?? 0} chars]`;
  }
  return redacted;
}

function streamStderr(text: string, label: string): void {
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim()) {
      process.stderr.write(`[${label} stderr] ${line}\n`);
    }
  }
}
