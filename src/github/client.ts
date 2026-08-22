import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "../config.js";
import { logger } from "../logger.js";

export async function createGitHubClient(params?: {
  owner: string;
  repo: string;
}): Promise<Octokit> {
  return (await createGitHubCredentials(params)).octokit;
}

export async function createGitHubCredentials(params?: {
  owner: string;
  repo: string;
}): Promise<{ octokit: Octokit; token: string }> {
  if (config.githubAppId && config.githubAppPrivateKey) {
    try {
      const auth = createConfiguredAppAuth();

      const installationId =
        config.githubAppInstallationId ??
        (params ? await resolveInstallationId(auth, params.owner, params.repo) : undefined);

      if (!installationId) {
        throw new Error(
          "GitHub App installation id is not configured and could not be resolved from the repository."
        );
      }

      const installationAuthentication = await auth({
        type: "installation",
        installationId
      });

      return {
        octokit: new Octokit({ auth: installationAuthentication.token }),
        token: installationAuthentication.token
      };
    } catch (error) {
      logger.warn(
        {
          error,
          githubAppId: config.githubAppId,
          githubAppInstallationId: config.githubAppInstallationId,
          owner: params?.owner,
          repo: params?.repo
        },
        "Failed to create GitHub App installation client; falling back to GITHUB_TOKEN."
      );
    }
  }

  if (!config.githubToken) {
    throw new Error(
      "GitHub authentication is not configured. Provide GITHUB_TOKEN, or set GH_APP_ID and GH_APP_PRIVATE_KEY."
    );
  }

  return {
    octokit: new Octokit({ auth: config.githubToken }),
    token: config.githubToken
  };
}

export async function createGitHubAppInstallationCredentials(
  installationId: number
): Promise<{ octokit: Octokit; token: string }> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error("A valid GitHub App installation id is required.");
  }

  const auth = createConfiguredAppAuth();
  const installationAuthentication = await auth({
    type: "installation",
    installationId
  });
  return {
    octokit: new Octokit({ auth: installationAuthentication.token }),
    token: installationAuthentication.token
  };
}

function createConfiguredAppAuth(): ReturnType<typeof createAppAuth> {
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    throw new Error("GH_APP_ID and GH_APP_PRIVATE_KEY are required for GitHub App authentication.");
  }

  return createAppAuth({
    appId: config.githubAppId,
    privateKey: normalizePrivateKey(config.githubAppPrivateKey)
  });
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

async function resolveInstallationId(
  auth: ReturnType<typeof createAppAuth>,
  owner: string,
  repo: string
): Promise<number | undefined> {
  const appAuthentication = await auth({ type: "app" });
  const appOctokit = new Octokit({
    auth: appAuthentication.token
  });

  const { data } = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo
  });

  return data.id;
}
