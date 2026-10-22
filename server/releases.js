// @ts-check
// Classic release selection. Every remote input is untrusted: release bodies,
// asset lists, checksum files, protocol schemas and the server directory are
// validated against closed expectations, and a failed or empty lookup never
// replaces a good stored record.

import {
  MAX_FILES,
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  RELEASE_REPOSITORY,
  clientAssetNames,
  isAssetName,
  isDownloadRecord,
  isNoteScope,
  isPlainNoteText,
  isTimestamp,
  isVersion,
  releaseAssetUrl,
  releasePageUrl,
} from "./record.js";
import { UpstreamError, decodeUtf8, fetchBounded, fetchJson } from "./http.js";
import { fetchOfficialServer } from "./status.js";

// The refresh gate doubles as the staleness window: a visit starts a
// background refresh only when the gate key has expired.
export const REFRESH_GATE_TTL_SECONDS = 15 * 60;
export const WEBHOOK_GATE_TTL_SECONDS = 60;
export const TAG_COMMIT_TTL_SECONDS = 24 * 60 * 60;
const MAX_LINE_LENGTH = 1_000;
const RECORD_LIMIT = 256 * 1024;
const RELEASES_LIMIT = 2 * 1024 * 1024;
const REF_LIMIT = 16 * 1024;
const PROTOCOL_LIMIT = 64 * 1024;
const CHECKSUMS_LIMIT = 64 * 1024;
const MAX_PROTOCOL_LOOKUPS = 10;
const API_ROOT = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;
const RAW_ROOT = `https://raw.githubusercontent.com/${RELEASE_REPOSITORY}`;
const apiHosts = new Set(["api.github.com"]);
const rawHosts = new Set(["raw.githubusercontent.com"]);
const releaseAssetHosts = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const commitPattern = /^[0-9a-f]{40}$/u;
const tagPattern =
  /^v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;
const digestPattern = /^sha256:([0-9a-f]{64})$/u;

/**
 * @typedef {import("./record.js").DownloadRecord} DownloadRecord
 * @typedef {import("./record.js").ReleaseNote} ReleaseNote
 * @typedef {import("./record.js").ReleaseFile} ReleaseFile
 * @typedef {import("./http.js").FetchLike} FetchLike
 * @typedef {{
 *   get(key: string): Promise<string | null>,
 *   put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>,
 * }} KvNamespace
 * @typedef {{
 *   DOWNLOADS?: KvNamespace,
 *   GITHUB_WEBHOOK_SECRET?: string,
 *   GITHUB_TOKEN?: string,
 *   OFFICIAL_SERVER_HOST?: string,
 *   CF_PAGES_BRANCH?: string,
 * }} Env
 * @typedef {{ fetch: FetchLike, now: () => number }} Deps
 * @typedef {{ tag: string, version: string, publishedAt: string, body: string, files: ReleaseFile[], windows: ReleaseFile & { sha256: string }, linux: ReleaseFile & { sha256: string }, checksums: ReleaseFile & { sha256: string } }} Candidate
 */

/**
 * KV keys, namespaced so preview deployments can never touch production
 * records even if they were bound to the same namespace.
 * @param {Env} env
 */
export function storageKeys(env) {
  const prefix = env.CF_PAGES_BRANCH === "main" ? "" : "preview:";
  return {
    record: `${prefix}classic:download:v1`,
    refreshGate: `${prefix}classic:download:refresh-gate:v1`,
    webhookGate: `${prefix}classic:download:webhook-gate:v1`,
    tagCommit: (/** @type {string} */ tag) =>
      `${prefix}classic:tag-commit:v1:${tag}`,
    protocol: (/** @type {string} */ commit) =>
      `${prefix}classic:protocol:v1:${commit}`,
  };
}

/**
 * Compares two validated X.Y.Z versions numerically.
 * @param {string} left
 * @param {string} right
 */
export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/**
 * @param {Env} env
 * @param {number} [limit]
 */
function githubOptions(env, limit = REF_LIMIT) {
  return {
    hosts: apiHosts,
    limit,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    authorizedHost: "api.github.com",
    token: env.GITHUB_TOKEN,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turns a semantic-release Markdown body into at most eight plain-text
 * highlights. Unknown sections, HTML, links and emphasis are dropped.
 * @param {unknown} body
 * @returns {ReleaseNote[]}
 */
export function parseReleaseNotes(body) {
  if (typeof body !== "string") return [];
  /** @type {ReleaseNote[]} */
  const notes = [];
  /** @type {ReleaseNote["kind"] | null} */
  let kind = null;
  for (const rawLine of body.slice(0, 20_000).split("\n")) {
    if (notes.length >= MAX_NOTES) break;
    // Bounding and trimming each line first keeps every pattern below linear.
    const line = rawLine.slice(0, MAX_LINE_LENGTH).trim();
    if (line.startsWith("#")) {
      kind = sectionKind(line);
      continue;
    }
    if (kind === null || !(line.startsWith("* ") || line.startsWith("- ")))
      continue;
    let text = line.slice(2).trim();
    /** @type {string | undefined} */
    let scope;
    const scoped = /^\*\*([^*]{1,60}):\*\*\s*(.*)$/u.exec(text);
    if (scoped) {
      const candidate = (scoped[1] ?? "").trim().toLowerCase();
      if (isNoteScope(candidate)) scope = candidate;
      text = scoped[2] ?? "";
    }
    text = plainText(stripTrailingReferences(text));
    if (text === "") continue;
    if ([...text].length > MAX_NOTE_LENGTH)
      text = `${[...text]
        .slice(0, MAX_NOTE_LENGTH - 1)
        .join("")
        .trimEnd()}…`;
    if (!isPlainNoteText(text)) continue;
    notes.push(scope === undefined ? { kind, text } : { kind, scope, text });
  }
  return notes;
}

/**
 * Maps a Markdown heading line to a highlight kind without backtracking.
 * @param {string} line a trimmed line starting with "#"
 * @returns {ReleaseNote["kind"] | null}
 */
function sectionKind(line) {
  let start = 0;
  while (start < line.length && line[start] === "#") start += 1;
  if (start > 6 || (line[start] !== " " && line[start] !== "\t")) return null;
  let end = line.length;
  while (end > start && line[end - 1] === "#") end -= 1;
  const title = line.slice(start, end).trim().toLowerCase();
  return title === "features"
    ? "feature"
    : title === "bug fixes"
      ? "fix"
      : title === "performance improvements"
        ? "performance"
        : null;
}

/**
 * Drops trailing issue/commit references such as ([#12](url)) ([abc](url)).
 * @param {string} text
 */
function stripTrailingReferences(text) {
  let result = text.trimEnd();
  for (let count = 0; count < 4 && result.endsWith("))"); count += 1) {
    const start = result.lastIndexOf("([");
    if (
      start < 0 ||
      !/^\(\[[^\]]{0,100}\]\([^()\s]{0,300}\)\)$/u.test(result.slice(start))
    )
      break;
    result = result.slice(0, start).trimEnd();
  }
  return result;
}

/** @param {string} markdown */
function plainText(markdown) {
  return markdown
    .replace(/<[^>]*>?/gu, " ")
    .replace(
      /!?\[([^\]]{0,200})\]\((?:[^()]|\([^()]{0,100}\)){0,300}\)/gu,
      "$1",
    )
    .replace(/[<>]/gu, " ")
    .replace(/(\*\*|__|\*|_|~~|`)/gu, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Parses a SHA256SUMS file strictly: every non-empty line must be a lowercase
 * digest, two separators, and a safe unique file name.
 * @param {string} text
 * @returns {Map<string, string> | null}
 */
export function parseChecksums(text) {
  /** @type {Map<string, string>} */
  const digests = new Map();
  const lines = text.split("\n");
  if (lines.length > 201) return null;
  for (const [index, line] of lines.entries()) {
    if (line === "") {
      if (index !== lines.length - 1) return null;
      continue;
    }
    const match = /^([0-9a-f]{64}) [ *]([^\s]+)$/u.exec(line);
    if (!match || !isAssetName(match[2]) || digests.has(match[2] ?? ""))
      return null;
    digests.set(
      /** @type {string} */ (match[2]),
      /** @type {string} */ (match[1]),
    );
  }
  return digests.size > 0 ? digests : null;
}

/**
 * Applies every check that needs no further request.
 * @param {unknown} release
 * @returns {Candidate | null}
 */
export function releaseCandidate(release) {
  if (
    !isObject(release) ||
    release["draft"] !== false ||
    release["prerelease"] !== false ||
    release["immutable"] !== true ||
    typeof release["tag_name"] !== "string"
  )
    return null;
  const tagMatch = tagPattern.exec(release["tag_name"]);
  const version = tagMatch?.[1];
  if (!tagMatch || version === undefined || !isVersion(version)) return null;
  const tag = release["tag_name"];
  const publishedAt = release["published_at"];
  if (!isTimestamp(publishedAt) || release["html_url"] !== releasePageUrl(tag))
    return null;
  const assets = release["assets"];
  if (!Array.isArray(assets) || assets.length < 1 || assets.length > MAX_FILES)
    return null;
  /** @type {ReleaseFile[]} */
  const files = [];
  for (const asset of assets) {
    if (
      !isObject(asset) ||
      !isAssetName(asset["name"]) ||
      asset["state"] !== "uploaded" ||
      typeof asset["size"] !== "number" ||
      !Number.isSafeInteger(asset["size"]) ||
      asset["size"] < 1 ||
      asset["size"] > 4 * 1024 ** 3
    )
      return null;
    const name = /** @type {string} */ (asset["name"]);
    const url = releaseAssetUrl(tag, name);
    if (asset["browser_download_url"] !== url) return null;
    const digest =
      typeof asset["digest"] === "string"
        ? digestPattern.exec(asset["digest"])?.[1]
        : undefined;
    files.push(
      digest === undefined
        ? { name, url, size: asset["size"] }
        : { name, url, size: asset["size"], sha256: digest },
    );
  }
  if (new Set(files.map(({ name }) => name)).size !== files.length) return null;
  const names = clientAssetNames(version);
  const find = (/** @type {string} */ name) => {
    const file = files.find((candidate) => candidate.name === name);
    return file?.sha256 === undefined
      ? null
      : /** @type {ReleaseFile & { sha256: string }} */ (file);
  };
  const windows = find(names.windows);
  const linux = find(names.linux);
  const checksums = find("SHA256SUMS");
  if (!windows || !linux || !checksums) return null;
  return {
    tag,
    version,
    publishedAt: /** @type {string} */ (publishedAt),
    body: typeof release["body"] === "string" ? release["body"] : "",
    files,
    windows,
    linux,
    checksums,
  };
}

/**
 * @param {Candidate} candidate
 * @param {Deps} deps
 */
export async function verifyChecksums(candidate, deps) {
  const bytes = await fetchBounded(deps.fetch, candidate.checksums.url, {
    hosts: releaseAssetHosts,
    limit: CHECKSUMS_LIMIT,
    headers: { Accept: "application/octet-stream" },
    maxRedirects: 3,
  });
  const actual = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        /** @type {BufferSource} */ (bytes),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== candidate.checksums.sha256) return false;
  let text;
  try {
    text = decodeUtf8(bytes);
  } catch {
    return false;
  }
  const digests = parseChecksums(text);
  if (!digests) return false;
  if (
    digests.get(candidate.windows.name) !== candidate.windows.sha256 ||
    digests.get(candidate.linux.name) !== candidate.linux.sha256
  )
    return false;
  for (const file of candidate.files) {
    const listed = digests.get(file.name);
    if (
      listed !== undefined &&
      file.sha256 !== undefined &&
      listed !== file.sha256
    )
      return false;
  }
  return true;
}

/**
 * @param {KvNamespace} kv
 * @param {string} key
 */
async function kvGet(kv, key) {
  try {
    return await kv.get(key);
  } catch {
    return null;
  }
}

/**
 * Resolves a tag to its commit, dereferencing annotated tags.
 * @param {string} tag
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 * @returns {Promise<string>}
 */
async function tagCommit(tag, env, deps) {
  const cacheKey = storageKeys(env).tagCommit(tag);
  const cached = await kvGet(env.DOWNLOADS, cacheKey);
  if (cached !== null && commitPattern.test(cached)) return cached;
  let target = await fetchJson(
    deps.fetch,
    `${API_ROOT}/git/ref/tags/${tag}`,
    githubOptions(env),
  );
  let object = isObject(target) ? target["object"] : null;
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      !isObject(object) ||
      typeof object["sha"] !== "string" ||
      !commitPattern.test(object["sha"])
    )
      throw new UpstreamError("invalid-tag-ref");
    if (object["type"] === "commit") {
      // Tags can in principle move, so this cache expires; commits cannot.
      await env.DOWNLOADS.put(cacheKey, object["sha"], {
        expirationTtl: TAG_COMMIT_TTL_SECONDS,
      }).catch(() => {});
      return object["sha"];
    }
    if (object["type"] !== "tag") throw new UpstreamError("invalid-tag-ref");
    target = await fetchJson(
      deps.fetch,
      `${API_ROOT}/git/tags/${object["sha"]}`,
      githubOptions(env),
    );
    object = isObject(target) ? target["object"] : null;
  }
  throw new UpstreamError("tag-chain-too-deep");
}

/**
 * Reads the integer protocol version at an immutable commit.
 * @param {string} commit
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 * @returns {Promise<number>}
 */
async function commitProtocol(commit, env, deps) {
  const cacheKey = storageKeys(env).protocol(commit);
  const cached = await kvGet(env.DOWNLOADS, cacheKey);
  if (cached !== null && /^[1-9][0-9]{0,9}$/u.test(cached)) {
    const value = Number(cached);
    if (value <= 2_147_483_647) return value;
  }
  const schema = await fetchJson(
    deps.fetch,
    `${RAW_ROOT}/${commit}/protocol/schema/game-commands.json`,
    { hosts: rawHosts, limit: PROTOCOL_LIMIT },
  );
  const protocol = isObject(schema) ? schema["protocol_version"] : undefined;
  if (
    typeof protocol !== "number" ||
    !Number.isSafeInteger(protocol) ||
    protocol < 1 ||
    protocol > 2_147_483_647
  )
    throw new UpstreamError("invalid-protocol");
  await env.DOWNLOADS.put(cacheKey, String(protocol)).catch(() => {});
  return protocol;
}

/**
 * @param {string} tag
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 */
export async function tagProtocol(tag, env, deps) {
  const commit = await tagCommit(tag, env, deps);
  return { commit, protocol: await commitProtocol(commit, env, deps) };
}

/**
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @returns {Promise<DownloadRecord | null>}
 */
export async function readRecord(env) {
  const raw = await kvGet(env.DOWNLOADS, storageKeys(env).record);
  if (raw === null || raw.length > RECORD_LIMIT) return null;
  try {
    const value = JSON.parse(raw);
    return isDownloadRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {Candidate} candidate
 * @param {{ commit: string, protocol: number }} source
 * @param {{ version: string } | null} server
 * @param {boolean} serverMatch
 * @param {number} now
 * @returns {DownloadRecord}
 */
function buildRecord(candidate, source, server, serverMatch, now) {
  return {
    schemaVersion: 1,
    version: candidate.version,
    tag: candidate.tag,
    commit: source.commit,
    publishedAt: candidate.publishedAt,
    releaseUrl: releasePageUrl(candidate.tag),
    protocol: source.protocol,
    serverMatch,
    server,
    platforms: {
      windows: { ...candidate.windows },
      linux: { ...candidate.linux },
    },
    files: candidate.files.map((file) => ({ ...file })),
    notes: parseReleaseNotes(candidate.body),
    checkedAt: new Date(now).toISOString(),
  };
}

/**
 * @typedef {{ outcome: "updated" | "kept" | "unavailable", record: DownloadRecord | null, reason?: string }} RefreshResult
 */

/**
 * @param {DownloadRecord} record
 */
function contentOf(record) {
  const { checkedAt: _checkedAt, ...content } = record;
  return JSON.stringify(content);
}

/**
 * Stores a record only when its content differs from the stored one, so
 * routine confirmations cost no KV write. `checkedAt` therefore records when
 * the current content was first selected.
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {DownloadRecord | null} stored
 * @param {DownloadRecord} record
 * @returns {Promise<RefreshResult>}
 */
async function store(env, stored, record) {
  if (stored && contentOf(stored) === contentOf(record))
    return { outcome: "kept", record: stored, reason: "unchanged" };
  await env.DOWNLOADS.put(storageKeys(env).record, JSON.stringify(record));
  return { outcome: "updated", record };
}

/**
 * Recomputes the selected Classic release and stores it when it is at least
 * as trustworthy as the stored record.
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 * @returns {Promise<RefreshResult>}
 */
export async function refreshDownloadRecord(env, deps) {
  const stored = await readRecord(env);
  const keep = (/** @type {string} */ reason) =>
    /** @type {RefreshResult} */ ({
      outcome: stored ? "kept" : "unavailable",
      record: stored,
      reason,
    });

  /** @type {{ version: string, protocol: number } | null} */
  let official = null;
  try {
    const server = await fetchOfficialServer(env, deps);
    if (server !== null && isVersion(server.version))
      official = {
        version: server.version,
        protocol: (await tagProtocol(`v${server.version}`, env, deps)).protocol,
      };
  } catch {
    official = null;
  }
  if (official === null && stored) return keep("official-server-unknown");

  let releases;
  try {
    releases = await fetchJson(
      deps.fetch,
      `${API_ROOT}/releases?per_page=10`,
      githubOptions(env, RELEASES_LIMIT),
    );
  } catch {
    return keep("releases-unavailable");
  }
  if (!Array.isArray(releases)) return keep("releases-invalid");

  if (official === null)
    // Nothing is stored and the server is unknown: offer the newest fully
    // verified release, explicitly marked as unmatched.
    return refreshFallback(env, deps, releases, null);

  // While the stored release still matches the server, a transient failure on
  // a newer release must never regress the download to an older one.
  const floor =
    stored && stored.protocol === official.protocol ? stored.version : null;
  let lookups = 0;
  for (const release of releases) {
    const candidate = releaseCandidate(release);
    if (!candidate) continue;
    if (floor !== null && compareVersions(candidate.version, floor) < 0) break;
    if (lookups >= MAX_PROTOCOL_LOOKUPS) break;
    lookups += 1;
    try {
      const source = await tagProtocol(candidate.tag, env, deps);
      if (source.protocol !== official.protocol) continue;
      if (!(await verifyChecksums(candidate, deps))) continue;
      const record = buildRecord(
        candidate,
        source,
        { version: official.version },
        true,
        deps.now(),
      );
      if (!isDownloadRecord(record)) continue;
      return store(env, stored, record);
    } catch {
      continue;
    }
  }
  if (!stored)
    return refreshFallback(env, deps, releases, {
      version: official.version,
    });
  // Keep the stored release, but state honestly whether it still matches.
  const restated = {
    ...stored,
    serverMatch: stored.protocol === official.protocol,
    server: { version: official.version },
  };
  if (!isDownloadRecord(restated)) return keep("no-matching-release");
  const result = await store(env, stored, restated);
  return result.outcome === "updated"
    ? result
    : { ...result, reason: "no-newer-matching-release" };
}

/**
 * @param {Env & { DOWNLOADS: KvNamespace }} env
 * @param {Deps} deps
 * @param {unknown[]} releases
 * @param {{ version: string } | null} server
 * @returns {Promise<RefreshResult>}
 */
async function refreshFallback(env, deps, releases, server) {
  let lookups = 0;
  for (const release of releases) {
    const candidate = releaseCandidate(release);
    if (!candidate || lookups >= MAX_PROTOCOL_LOOKUPS) continue;
    lookups += 1;
    try {
      const source = await tagProtocol(candidate.tag, env, deps);
      if (!(await verifyChecksums(candidate, deps))) continue;
      const record = buildRecord(candidate, source, server, false, deps.now());
      if (!isDownloadRecord(record)) continue;
      return store(env, null, record);
    } catch {
      continue;
    }
  }
  return { outcome: "unavailable", record: null, reason: "no-release" };
}

/**
 * Takes a best-effort gate that expires after `ttlSeconds`. KV is eventually
 * consistent, so this limits rather than eliminates concurrent refreshes.
 * @param {KvNamespace} kv
 * @param {string} key
 * @param {number} ttlSeconds
 */
export async function acquireGate(kv, key, ttlSeconds) {
  if ((await kvGet(kv, key)) !== null) return false;
  try {
    await kv.put(key, "1", { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}
