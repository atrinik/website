// @ts-check
// Closed shapes shared by the /api runtime and the browser module. This file
// must stay free of runtime-specific APIs so both bundles can import it.

export const RELEASE_REPOSITORY = "atrinik/classic";
export const RELEASE_ROOT = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const MAX_FILES = 50;
export const MAX_NOTES = 8;
export const MAX_NOTE_LENGTH = 200;

const versionPattern =
  /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const assetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/u;
const scopePattern = /^[a-z0-9][a-z0-9._/-]{0,39}$/u;
const timestampPattern =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/u;
const serverNamePattern = /^[^\p{Cc}\p{Cf}]{1,80}$/u;
const noteKinds = new Set(["feature", "fix", "performance"]);
const maxAssetBytes = 4 * 1024 ** 3;

/** @param {unknown} value */
export function isVersion(value) {
  return typeof value === "string" && versionPattern.test(value);
}

/** @param {unknown} value */
export function isTimestamp(value) {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** @param {unknown} value */
export function isAssetName(value) {
  return typeof value === "string" && assetNamePattern.test(value);
}

/**
 * @param {string} version
 * @returns {{ windows: string, linux: string }}
 */
export function clientAssetNames(version) {
  return {
    windows: `atrinik-classic-client-${version}-windows-x86_64.zip`,
    linux: `atrinik-classic-client-${version}-linux-x86_64.AppImage`,
  };
}

/**
 * @param {string} tag
 * @param {string} name
 */
export function releaseAssetUrl(tag, name) {
  return `${RELEASE_ROOT}/download/${tag}/${name}`;
}

/** @param {string} tag */
export function releasePageUrl(tag) {
  return `${RELEASE_ROOT}/tag/${tag}`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} required
 * @param {string[]} [optional]
 */
function hasKeys(value, required, optional = []) {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

/** @param {unknown} value */
function isSize(value) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maxAssetBytes
  );
}

/**
 * @param {unknown} value
 * @param {string} tag
 * @param {boolean} digestRequired
 */
function isFile(value, tag, digestRequired) {
  return (
    isObject(value) &&
    hasKeys(value, ["name", "url", "size"], ["sha256"]) &&
    isAssetName(value["name"]) &&
    value["url"] === releaseAssetUrl(tag, String(value["name"])) &&
    isSize(value["size"]) &&
    (value["sha256"] === undefined
      ? !digestRequired
      : typeof value["sha256"] === "string" &&
        sha256Pattern.test(value["sha256"]))
  );
}

/** @param {unknown} value */
export function isPlainNoteText(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    [...value].length >= 1 &&
    [...value].length <= MAX_NOTE_LENGTH &&
    !/[\p{Cc}\p{Cf}<>]/u.test(value)
  );
}

/** @param {unknown} value */
function isNote(value) {
  return (
    isObject(value) &&
    hasKeys(value, ["kind", "text"], ["scope"]) &&
    typeof value["kind"] === "string" &&
    noteKinds.has(value["kind"]) &&
    (value["scope"] === undefined ||
      (typeof value["scope"] === "string" &&
        scopePattern.test(value["scope"]))) &&
    isPlainNoteText(value["text"])
  );
}

/** @param {unknown} value */
export function isNoteScope(value) {
  return typeof value === "string" && scopePattern.test(value);
}

/**
 * @typedef {{ name: string, url: string, size: number, sha256: string }} PlatformFile
 * @typedef {{ name: string, url: string, size: number, sha256?: string }} ReleaseFile
 * @typedef {{ kind: "feature" | "fix" | "performance", scope?: string, text: string }} ReleaseNote
 * @typedef {{
 *   schemaVersion: 1,
 *   version: string,
 *   tag: string,
 *   commit: string,
 *   publishedAt: string,
 *   releaseUrl: string,
 *   protocol: number,
 *   serverMatch: boolean,
 *   server: { version: string } | null,
 *   platforms: { windows: PlatformFile, linux: PlatformFile },
 *   files: ReleaseFile[],
 *   notes: ReleaseNote[],
 *   checkedAt: string,
 * }} DownloadRecord
 */

/**
 * Validates the stored and served Classic download record.
 * @param {unknown} value
 * @returns {value is DownloadRecord}
 */
export function isDownloadRecord(value) {
  if (
    !isObject(value) ||
    !hasKeys(value, [
      "schemaVersion",
      "version",
      "tag",
      "commit",
      "publishedAt",
      "releaseUrl",
      "protocol",
      "serverMatch",
      "server",
      "platforms",
      "files",
      "notes",
      "checkedAt",
    ]) ||
    value["schemaVersion"] !== 1 ||
    !isVersion(value["version"]) ||
    value["tag"] !== `v${value["version"]}` ||
    typeof value["commit"] !== "string" ||
    !commitPattern.test(value["commit"]) ||
    !isTimestamp(value["publishedAt"]) ||
    !isTimestamp(value["checkedAt"]) ||
    value["releaseUrl"] !== releasePageUrl(value["tag"]) ||
    typeof value["protocol"] !== "number" ||
    !Number.isSafeInteger(value["protocol"]) ||
    value["protocol"] < 1 ||
    value["protocol"] > 2_147_483_647 ||
    typeof value["serverMatch"] !== "boolean"
  )
    return false;
  const tag = String(value["tag"]);
  const server = value["server"];
  if (value["serverMatch"]) {
    if (
      !isObject(server) ||
      !hasKeys(server, ["version"]) ||
      !isVersion(server["version"])
    )
      return false;
  } else if (server !== null) return false;

  const files = value["files"];
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > MAX_FILES ||
    !files.every((file) => isFile(file, tag, false)) ||
    new Set(files.map((file) => file.name)).size !== files.length
  )
    return false;

  const platforms = value["platforms"];
  if (!isObject(platforms) || !hasKeys(platforms, ["windows", "linux"]))
    return false;
  const names = clientAssetNames(String(value["version"]));
  for (const platform of /** @type {const} */ (["windows", "linux"])) {
    const file = platforms[platform];
    if (
      !isFile(file, tag, true) ||
      !isObject(file) ||
      file["name"] !== names[platform] ||
      !files.some(
        (listed) =>
          listed.name === file["name"] &&
          listed.size === file["size"] &&
          listed.sha256 === file["sha256"],
      )
    )
      return false;
  }

  const notes = value["notes"];
  return (
    Array.isArray(notes) && notes.length <= MAX_NOTES && notes.every(isNote)
  );
}

/**
 * @typedef {{ online: true, name: string, version: string, playersCount: number }} OnlineServer
 * @typedef {{ online: false }} OfflineServer
 * @typedef {{ available: true, generatedAt: string, server: OnlineServer | OfflineServer } | { available: false }} StatusResponse
 */

/** @param {unknown} value */
export function isServerName(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    serverNamePattern.test(value)
  );
}

/** @param {unknown} value */
export function isPlayersCount(value) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000
  );
}

/**
 * @param {unknown} value
 * @returns {value is StatusResponse}
 */
export function isStatusResponse(value) {
  if (!isObject(value) || typeof value["available"] !== "boolean") return false;
  if (!value["available"]) return hasKeys(value, ["available"]);
  const server = value["server"];
  if (
    !hasKeys(value, ["available", "generatedAt", "server"]) ||
    !isTimestamp(value["generatedAt"]) ||
    !isObject(server) ||
    typeof server["online"] !== "boolean"
  )
    return false;
  if (!server["online"]) return hasKeys(server, ["online"]);
  return (
    hasKeys(server, ["online", "name", "version", "playersCount"]) &&
    isServerName(server["name"]) &&
    isVersion(server["version"]) &&
    isPlayersCount(server["playersCount"])
  );
}
