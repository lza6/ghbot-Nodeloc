import http from "node:http";
import type { Socket } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { logger } from "../logger.js";

export async function startOneRunApiProxy(
  upstreamBaseUrl: string,
  realApiKey: string
): Promise<{ port: number; token: string; close: () => Promise<void> }> {
  const upstream = new URL(`${upstreamBaseUrl.replace(/\/+$/, "")}/chat/completions`);
  const token = randomBytes(32).toString("base64url");
  const sockets = new Set<Socket>();
  const upstreamRequests = new Set<AbortController>();
  const server = http.createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/v1/chat/completions" ||
        !hasMatchingBearerToken(request.headers.authorization, token)
      ) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end('{"error":{"message":"Forbidden"}}');
        return;
      }

      const body = await readRequestBody(request, 20 * 1024 * 1024);
      const controller = new AbortController();
      upstreamRequests.add(controller);
      let upstreamResponse: Response;
      try {
        upstreamResponse = await fetch(upstream, {
          method: "POST",
          headers: {
            authorization: `Bearer ${realApiKey}`,
            "content-type": request.headers["content-type"] ?? "application/json",
            accept: request.headers.accept ?? "*/*"
          },
          body: body.toString("utf8"),
          signal: controller.signal
        });
      } finally {
        upstreamRequests.delete(controller);
      }

      response.writeHead(upstreamResponse.status, copyResponseHeaders(upstreamResponse.headers));
      if (!upstreamResponse.body) {
        response.end();
        return;
      }

      Readable.fromWeb(upstreamResponse.body as WebReadableStream)
        .on("error", (error) => response.destroy(error as Error))
        .pipe(response);
    } catch (error) {
      logger.error({ error }, "goose API proxy request failed.");
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end('{"error":{"message":"goose proxy request failed"}}');
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("goose API proxy did not receive a TCP port.");
  }

  return {
    port: address.port,
    token,
    close: async () => {
      for (const controller of upstreamRequests) {
        controller.abort();
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

function hasMatchingBearerToken(value: string | undefined, expectedToken: string): boolean {
  const suppliedToken = value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : "";
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readRequestBody(request: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maxBytes) {
      throw new Error(`goose proxy request exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function copyResponseHeaders(headers: Headers): Record<string, string> {
  const copied: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "x-request-id"]) {
    const value = headers.get(name);
    if (value) {
      copied[name] = value;
    }
  }
  return copied;
}
