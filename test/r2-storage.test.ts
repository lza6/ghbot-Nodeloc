import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../src/config.js";
import {
  normalizeEndpoint,
  isR2Configured,
  downloadR2Object,
  uploadR2Object
} from "../src/storage/r2.js";

// ── Mock S3Client.prototype.send ──────────────────────────────────────────
const mockSend = mock.fn<(...args: unknown[]) => Promise<unknown>>();
mock.method(S3Client.prototype, "send", mockSend);

let _lastGetObjectInput: Record<string, unknown> | undefined;
let _lastPutObjectInput: Record<string, unknown> | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────

function setR2Config(
  opts: {
    endpoint?: string;
    bucketName?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  } = {}
): void {
  config.r2Endpoint = opts.endpoint;
  config.r2BucketName = opts.bucketName;
  config.r2AccessKeyId = opts.accessKeyId;
  config.r2SecretAccessKey = opts.secretAccessKey;
}

function clearR2Config(): void {
  setR2Config();
}

/** Reset the S3 send mock and attach a default handler that captures commands. */
function resetSendMock(handler?: (command: unknown) => Promise<unknown>): void {
  mockSend.mock.resetCalls();
  _lastGetObjectInput = undefined;
  _lastPutObjectInput = undefined;

  mockSend.mock.mockImplementation(
    handler ??
      (async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          _lastGetObjectInput = command.input;
          return { Body: undefined };
        }
        if (command instanceof PutObjectCommand) {
          _lastPutObjectInput = command.input;
          return {};
        }
        return {};
      })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// normalizeEndpoint
// ═══════════════════════════════════════════════════════════════════════════

test("normalizeEndpoint with valid HTTPS URL returns normalized", () => {
  assert.equal(
    normalizeEndpoint("https://account.r2.cloudflarestorage.com"),
    "https://account.r2.cloudflarestorage.com"
  );
});

test("normalizeEndpoint removes trailing slash", () => {
  assert.equal(
    normalizeEndpoint("https://account.r2.cloudflarestorage.com/"),
    "https://account.r2.cloudflarestorage.com"
  );
  assert.equal(
    normalizeEndpoint("https://account.r2.cloudflarestorage.com/my-prefix/"),
    "https://account.r2.cloudflarestorage.com/my-prefix"
  );
});

test("normalizeEndpoint with invalid URL throws", () => {
  assert.throws(() => normalizeEndpoint("not a url"), /valid HTTPS URL/);
  assert.throws(() => normalizeEndpoint(""), /valid HTTPS URL/);
});

test("normalizeEndpoint with userinfo in URL throws", () => {
  assert.throws(() => normalizeEndpoint("https://user:pass@host.com"), /credential-free HTTPS/);
  assert.throws(() => normalizeEndpoint("https://user@host.com"), /credential-free HTTPS/);
});

test("normalizeEndpoint with non-HTTPS protocol throws", () => {
  assert.throws(() => normalizeEndpoint("http://r2.example.com"), /credential-free HTTPS/);
  assert.throws(() => normalizeEndpoint("ftp://r2.example.com"), /credential-free HTTPS/);
});

test("normalizeEndpoint with query string throws", () => {
  assert.throws(() => normalizeEndpoint("https://r2.example.com?foo=bar"), /credential-free HTTPS/);
});

test("normalizeEndpoint with hash fragment throws", () => {
  assert.throws(() => normalizeEndpoint("https://r2.example.com#section"), /credential-free HTTPS/);
});

// ═══════════════════════════════════════════════════════════════════════════
// isR2Configured
// ═══════════════════════════════════════════════════════════════════════════

test("isR2Configured returns false when no config values set", () => {
  clearR2Config();
  assert.equal(isR2Configured(), false);
});

test("isR2Configured throws when config is partial", () => {
  clearR2Config();
  config.r2Endpoint = "https://example.r2.cloudflarestorage.com";

  assert.throws(() => isR2Configured(), /R2 cache configuration is incomplete/);
});

// ═══════════════════════════════════════════════════════════════════════════
// downloadR2Object
// ═══════════════════════════════════════════════════════════════════════════

test("downloadR2Object returns Buffer for valid response", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      _lastGetObjectInput = command.input;
      return {
        Body: {
          transformToByteArray: async () => new Uint8Array([104, 101, 108, 108, 111])
        }
      };
    }
    return {};
  });

  const result = await downloadR2Object("some/key.json");
  assert.ok(result !== undefined, "expected a Buffer, got undefined");
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.toString(), "hello");
  assert.equal(mockSend.mock.calls.length, 1);
});

test("downloadR2Object returns empty Buffer when Body is absent", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      _lastGetObjectInput = command.input;
      return { Body: undefined };
    }
    return {};
  });

  const result = await downloadR2Object("some/key.json");
  assert.ok(result !== undefined, "expected a Buffer, got undefined");
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.byteLength, 0);
  assert.equal(mockSend.mock.calls.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// uploadR2Object
// ═══════════════════════════════════════════════════════════════════════════

test("uploadR2Object calls PutObjectCommand with correct params", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock();

  await uploadR2Object({
    key: "test/object.json",
    body: JSON.stringify({ foo: "bar" }),
    contentType: "application/json"
  });

  assert.equal(mockSend.mock.calls.length, 1);
  assert.ok(_lastPutObjectInput, "PutObjectCommand was not instantiated");
  assert.equal(_lastPutObjectInput!.Bucket, "my-bucket");
  assert.equal(_lastPutObjectInput!.Key, "test/object.json");
  assert.equal(_lastPutObjectInput!.ContentType, "application/json");
  assert.equal(_lastPutObjectInput!.CacheControl, "no-store");
  assert.deepEqual(_lastPutObjectInput!.Metadata, { "ghbot-format": "v1" });
  assert.equal(_lastPutObjectInput!.Body, JSON.stringify({ foo: "bar" }));
});

test("uploadR2Object with Uint8Array body", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock();

  const binaryBody = new Uint8Array([1, 2, 3]);
  await uploadR2Object({
    key: "binary/data.bin",
    body: binaryBody,
    contentType: "application/octet-stream"
  });

  assert.equal(mockSend.mock.calls.length, 1);
  assert.ok(_lastPutObjectInput, "PutObjectCommand was not instantiated");
  assert.equal(_lastPutObjectInput!.Body, binaryBody);
  assert.equal(_lastPutObjectInput!.ContentType, "application/octet-stream");
});

// ═══════════════════════════════════════════════════════════════════════════
// validateBucketName (tested through isR2Configured)
// ═══════════════════════════════════════════════════════════════════════════

test("validateBucketName with valid name passes", () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-valid-bucket-123",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  assert.doesNotThrow(() => isR2Configured());
});

test("validateBucketName with invalid name throws", () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "UPPERCASE_BUCKET",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  assert.throws(() => isR2Configured(), /R2_BUCKET_NAME must be a valid S3-compatible bucket name/);
});

test("validateBucketName with name starting with dash throws", () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "-invalid-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  assert.throws(() => isR2Configured(), /R2_BUCKET_NAME must be a valid S3-compatible bucket name/);
});

// ═══════════════════════════════════════════════════════════════════════════
// isMissingObject (tested through downloadR2Object)
// ═══════════════════════════════════════════════════════════════════════════

test("isMissingObject with NoSuchKey returns undefined", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    const err = new Error("NoSuchKey") as Error & { name: string };
    err.name = "NoSuchKey";
    throw err;
  });

  const result = await downloadR2Object("missing-key.json");
  assert.equal(result, undefined);
});

test("isMissingObject with 404 status returns undefined", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    const err = new Error("NotFound") as Error & {
      name: string;
      $metadata?: { httpStatusCode: number };
    };
    err.name = "NotFound";
    err.$metadata = { httpStatusCode: 404 };
    throw err;
  });

  const result = await downloadR2Object("missing-key.json");
  assert.equal(result, undefined);
});

test("isMissingObject with other errors rethrows", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    throw new Error("Network failure");
  });

  await assert.rejects(() => downloadR2Object("some-key.json"), /Network failure/);
});

test("isMissingObject with non-object error rethrows", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    throw new Error("string error");
  });

  await assert.rejects(() => downloadR2Object("some-key.json"), /string error/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Extra edge cases
// ═══════════════════════════════════════════════════════════════════════════

test("downloadR2Object with 403 error rethrows", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    const err = new Error("Forbidden") as Error & {
      name: string;
      $metadata?: { httpStatusCode: number };
    };
    err.name = "Forbidden";
    err.$metadata = { httpStatusCode: 403 };
    throw err;
  });

  await assert.rejects(() => downloadR2Object("forbidden-key.json"), /Forbidden/);
});

test("downloadR2Object with AccessDenied error rethrows", async () => {
  setR2Config({
    endpoint: "https://example.r2.cloudflarestorage.com",
    bucketName: "my-bucket",
    accessKeyId: "akid",
    secretAccessKey: "sak"
  });

  resetSendMock(async () => {
    const err = new Error("AccessDenied") as Error & { name: string };
    err.name = "AccessDenied";
    throw err;
  });

  await assert.rejects(() => downloadR2Object("restricted-key.json"), /AccessDenied/);
});
