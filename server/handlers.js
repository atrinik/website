// @ts-check
// Request handlers behind the thin Cloudflare Pages Function routes.

import {
  BodyTooLargeError,
  decodeUtf8,
  emptyResponse,
  jsonResponse,
  methodNotAllowed,
  readBoundedBytes,
} from "./http.js";
import { RELEASE_REPOSITORY, isStatusResponse } from "./record.js";
import {
  acquireRefreshLock,
  isStale,
  readRecord,
  refreshDownloadRecord,
} from "./releases.js";
import { fetchDirectory, statusFromDirectory } from "./status.js";

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;
const STATUS_TTL_SECONDS = 60;
const STATUS_FAILURE_TTL_SECONDS = 30;
const signaturePattern = /^sha256=([0-9a-f]{64})$/u;

/**
 * @typedef {import("./releases.js").Env} Env
 * @typedef {import("./releases.js").Deps} Deps
 * @typedef {import("./releases.js").KvNamespace} KvNamespace
 * @typedef {import("./record.js").StatusResponse} StatusResponse
 * @typedef {{ request: Request, env: Env, waitUntil(promise: Promise<unknown>): void }} PagesContext
 * @typedef {{
 *   get(key: string): Promise<StatusResponse | null>,
 *   put(key: string, value: StatusResponse, ttlSeconds: number): Promise<void>,
 * }} StatusCache
 */

/** @returns {Deps} */
export function defaultDeps() {
  return { fetch: (input, init) => fetch(input, init), now: () => Date.now() };
}

const unavailable = () => jsonResponse(503, { available: false });

/** @param {string} reason */
function logFailure(reason) {
  // Reason codes only: never request bodies, headers, or visitor identifiers.
  console.warn(`classic download refresh: ${reason}`);
}

/**
 * @param {Env} env
 * @returns {env is Env & { DOWNLOADS: KvNamespace }}
 */
function hasStore(env) {
  return (
    env.DOWNLOADS !== undefined &&
    env.DOWNLOADS !== null &&
    typeof env.DOWNLOADS.get === "function" &&
    typeof env.DOWNLOADS.put === "function"
  );
}

/**
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 */
async function backgroundRefresh(env, deps) {
  try {
    const result = await refreshDownloadRecord(env, deps);
    if (result.outcome !== "updated") logFailure(result.reason ?? "unknown");
  } catch {
    logFailure("exception");
  }
}

/** @param {string} hex */
function hexBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/**
 * Verifies a GitHub `X-Hub-Signature-256` header. `crypto.subtle.verify`
 * compares the MAC in constant time.
 * @param {string} secret
 * @param {string | null} header
 * @param {Uint8Array} body
 */
export async function verifyGithubSignature(secret, header, body) {
  const match = header === null ? null : signaturePattern.exec(header);
  if (!match || secret.length === 0) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    /** @type {BufferSource} */ (hexBytes(/** @type {string} */ (match[1]))),
    /** @type {BufferSource} */ (body),
  );
}

/**
 * POST /api/github/release
 * @param {PagesContext} context
 * @param {Deps} [deps]
 */
export async function handleGithubRelease(context, deps = defaultDeps()) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed("POST");
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (typeof secret !== "string" || secret.length === 0)
    return emptyResponse(503);
  const signature = request.headers.get("x-hub-signature-256");
  if (signature === null || !signaturePattern.test(signature))
    return emptyResponse(401);
  let body;
  try {
    body = await readBoundedBytes(request, WEBHOOK_BODY_LIMIT);
  } catch (error) {
    return emptyResponse(error instanceof BodyTooLargeError ? 413 : 400);
  }
  if (!(await verifyGithubSignature(secret, signature, body)))
    return emptyResponse(401);

  const event = request.headers.get("x-github-event");
  if (event === "ping") return emptyResponse(204);
  if (event !== "release") return emptyResponse(400);
  let payload;
  try {
    payload = JSON.parse(decodeUtf8(body));
  } catch {
    return emptyResponse(400);
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.repository === null ||
    typeof payload.repository !== "object" ||
    payload.repository.full_name !== RELEASE_REPOSITORY
  )
    return emptyResponse(422);
  if (!hasStore(env)) return emptyResponse(503);
  // The payload is only a cue: the release is re-read from GitHub's API.
  context.waitUntil(backgroundRefresh(env, deps));
  return emptyResponse(202);
}

/**
 * GET /api/downloads/classic
 * @param {PagesContext} context
 * @param {Deps} [deps]
 */
export async function handleClassicDownload(context, deps = defaultDeps()) {
  const { request, env } = context;
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!hasStore(env)) return unavailable();
  const record = await readRecord(env.DOWNLOADS);
  if (record) {
    if (
      isStale(record, deps.now()) &&
      (await acquireRefreshLock(env.DOWNLOADS))
    )
      context.waitUntil(backgroundRefresh(env, deps));
    return jsonResponse(200, record, { maxAge: 60 });
  }
  if (!(await acquireRefreshLock(env.DOWNLOADS))) return unavailable();
  try {
    const result = await refreshDownloadRecord(env, deps);
    if (result.record) return jsonResponse(200, result.record, { maxAge: 60 });
    logFailure(result.reason ?? "unknown");
  } catch {
    logFailure("exception");
  }
  return unavailable();
}

/** @returns {StatusCache} */
export function memoryStatusCache() {
  /** @type {Map<string, { value: StatusResponse, expires: number }>} */
  const entries = new Map();
  return {
    async get(key) {
      const entry = entries.get(key);
      return entry && entry.expires > Date.now() ? entry.value : null;
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
  };
}

/**
 * Combines a per-isolate memory cache with the per-location Cache API.
 * @returns {StatusCache}
 */
function edgeStatusCache() {
  const memory = memoryStatusCache();
  const cacheUrl = "https://atrinik.org/__status-cache/v1";
  const open = async () =>
    typeof caches === "undefined" ? null : caches.open("atrinik-status");
  return {
    async get(key) {
      const local = await memory.get(key);
      if (local) return local;
      try {
        const cached = await (await open())?.match(`${cacheUrl}/${key}`);
        if (!cached) return null;
        const value = await cached.json();
        return isStatusResponse(value) ? value : null;
      } catch {
        return null;
      }
    },
    async put(key, value, ttlSeconds) {
      await memory.put(key, value, ttlSeconds);
      try {
        await (
          await open()
        )?.put(
          `${cacheUrl}/${key}`,
          new Response(JSON.stringify(value), {
            headers: {
              "Cache-Control": `public, max-age=${ttlSeconds}`,
              "Content-Type": "application/json",
            },
          }),
        );
      } catch {
        // The memory cache still bounds directory requests.
      }
    },
  };
}

const sharedStatusCache = edgeStatusCache();

/**
 * GET /api/status
 * @param {PagesContext} context
 * @param {Deps & { cache?: StatusCache }} [deps]
 */
export async function handleStatus(context, deps = defaultDeps()) {
  const { request, env } = context;
  if (request.method !== "GET") return methodNotAllowed("GET");
  const cache = deps.cache ?? sharedStatusCache;
  const key = "official";
  /** @type {StatusResponse | null} */
  let status = null;
  try {
    status = await cache.get(key);
  } catch {
    status = null;
  }
  if (status === null) {
    try {
      status = statusFromDirectory(await fetchDirectory(env, deps));
    } catch {
      status = { available: false };
    }
    await cache
      .put(
        key,
        status,
        status.available ? STATUS_TTL_SECONDS : STATUS_FAILURE_TTL_SECONDS,
      )
      .catch(() => {});
  }
  return status.available
    ? jsonResponse(200, status, { maxAge: STATUS_TTL_SECONDS })
    : unavailable();
}
