import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";

type R2Settings = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let cachedClient: S3Client | undefined;
let cachedSettings: R2Settings | undefined;

export function isR2Configured(): boolean {
  return Boolean(readR2Settings());
}

export async function downloadR2Object(key: string): Promise<Buffer | undefined> {
  const settings = requireR2Settings();
  try {
    const response = await getR2Client(settings).send(
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: key
      })
    );
    return response.Body
      ? Buffer.from(await response.Body.transformToByteArray())
      : Buffer.alloc(0);
  } catch (error) {
    if (isMissingObject(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function uploadR2Object(params: {
  key: string;
  body: string | Uint8Array;
  contentType: string;
}): Promise<void> {
  const settings = requireR2Settings();
  await getR2Client(settings).send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: "no-store",
      Metadata: {
        "ghbot-format": "v1"
      }
    })
  );
}

function readR2Settings(): R2Settings | undefined {
  const values = [
    config.r2Endpoint,
    config.r2BucketName,
    config.r2AccessKeyId,
    config.r2SecretAccessKey
  ];
  const configuredCount = values.filter(Boolean).length;
  if (configuredCount === 0) {
    return undefined;
  }
  if (configuredCount !== values.length) {
    throw new Error(
      "R2 cache configuration is incomplete. Set R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY together."
    );
  }

  const endpoint = normalizeEndpoint(config.r2Endpoint!);
  return {
    endpoint,
    bucket: validateBucketName(config.r2BucketName!),
    accessKeyId: config.r2AccessKeyId!,
    secretAccessKey: config.r2SecretAccessKey!
  };
}

function requireR2Settings(): R2Settings {
  const settings = readR2Settings();
  if (!settings) {
    throw new Error("R2 cache is not configured.");
  }
  return settings;
}

function getR2Client(settings: R2Settings): S3Client {
  if (
    cachedClient &&
    cachedSettings?.endpoint === settings.endpoint &&
    cachedSettings.bucket === settings.bucket &&
    cachedSettings.accessKeyId === settings.accessKeyId &&
    cachedSettings.secretAccessKey === settings.secretAccessKey
  ) {
    return cachedClient;
  }

  cachedSettings = settings;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: settings.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey
    }
  });
  return cachedClient;
}

export function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new Error("R2_ENDPOINT must be a valid HTTPS URL.", { cause: error });
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      "R2_ENDPOINT must be a credential-free HTTPS URL without query or fragment components."
    );
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  return endpoint.toString().replace(/\/$/, "");
}

function validateBucketName(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)) {
    throw new Error("R2_BUCKET_NAME must be a valid S3-compatible bucket name.");
  }
  return value;
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}
