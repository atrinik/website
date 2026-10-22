// @ts-check
// Bounded, allowlisted HTTP helpers for the /api runtime.

export const FETCH_TIMEOUT_MS = 5_000;
export const USER_AGENT = "atrinik-website (+https://atrinik.org)";

/**
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike
 */

export class UpstreamError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "UpstreamError";
    this.code = code;
  }
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("body-too-large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads at most `limit` bytes, rejecting a larger declared or actual body.
 * @param {Request | Response} message
 * @param {number} limit
 * @returns {Promise<Uint8Array>}
 */
export async function readBoundedBytes(message, limit) {
  const declared = message.headers.get("content-length");
  if (declared !== null) {
    if (!/^[0-9]{1,15}$/u.test(declared)) throw new BodyTooLargeError();
    if (Number(declared) > limit) {
      await message.body?.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
  }
  if (message.body === null) return new Uint8Array(0);
  const reader = message.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 */
export function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Fetches an https URL on an allowlisted host, following at most
 * `maxRedirects` redirects whose targets are also allowlisted.
 * @param {FetchLike} fetchImpl
 * @param {string} url
 * @param {{
 *   hosts: ReadonlySet<string>,
 *   limit: number,
 *   headers?: Record<string, string>,
 *   authorizedHost?: string,
 *   token?: string | undefined,
 *   maxRedirects?: number,
 * }} options
 * @returns {Promise<Uint8Array>}
 */
export async function fetchBounded(fetchImpl, url, options) {
  let current = new URL(url);
  const maxRedirects = options.maxRedirects ?? 0;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (
      current.protocol !== "https:" ||
      current.username !== "" ||
      current.password !== "" ||
      current.port !== "" ||
      !options.hosts.has(current.hostname)
    )
      throw new UpstreamError("host-not-allowed");
    /** @type {Record<string, string>} */
    const headers = { "User-Agent": USER_AGENT, ...options.headers };
    if (
      options.token &&
      options.authorizedHost &&
      current.hostname === options.authorizedHost
    )
      headers["Authorization"] = `Bearer ${options.token}`;
    let response;
    try {
      response = await fetchImpl(current.href, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new UpstreamError("fetch-failed");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (location === null) throw new UpstreamError("redirect-without-target");
      current = new URL(location, current);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new UpstreamError(`status-${response.status}`);
    }
    try {
      return await readBoundedBytes(response, options.limit);
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        throw new UpstreamError("too-large");
      throw new UpstreamError("read-failed");
    }
  }
  throw new UpstreamError("too-many-redirects");
}

/**
 * @param {FetchLike} fetchImpl
 * @param {string} url
 * @param {Parameters<typeof fetchBounded>[2]} options
 * @returns {Promise<unknown>}
 */
export async function fetchJson(fetchImpl, url, options) {
  const bytes = await fetchBounded(fetchImpl, url, options);
  try {
    return JSON.parse(decodeUtf8(bytes));
  } catch {
    throw new UpstreamError("invalid-json");
  }
}

const apiHeaders = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

/**
 * @param {number} status
 * @param {unknown} body
 * @param {{ maxAge?: number, headers?: Record<string, string> }} [options]
 */
export function jsonResponse(status, body, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    ...apiHeaders,
    "Content-Type": "application/json; charset=utf-8",
    ...options.headers,
  };
  if (options.maxAge !== undefined)
    headers["Cache-Control"] = `public, max-age=${options.maxAge}`;
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 */
export function emptyResponse(status, extraHeaders = {}) {
  return new Response(null, {
    status,
    headers: { ...apiHeaders, ...extraHeaders },
  });
}

/** @param {string} allow */
export function methodNotAllowed(allow) {
  return emptyResponse(405, { Allow: allow });
}
