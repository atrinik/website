// @ts-check
// Official Classic server status from the public server directory. Only a
// whitelisted subset of the official entry ever leaves this module.

import { fetchJson } from "./http.js";
import { isPlayersCount, isServerName, isVersion } from "./record.js";

export const DIRECTORY_URL = "https://classic.meta.atrinik.org/index.json";
export const DEFAULT_OFFICIAL_SERVER_HOST = "game.atrinik.com";
const DIRECTORY_LIMIT = 256 * 1024;
const directoryHosts = new Set(["classic.meta.atrinik.org"]);
const hostnamePattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/**
 * @typedef {import("./http.js").FetchLike} FetchLike
 * @typedef {import("./record.js").StatusResponse} StatusResponse
 * @typedef {{ OFFICIAL_SERVER_HOST?: string }} StatusEnv
 * @typedef {{ fetch: FetchLike, now: () => number }} StatusDeps
 * @typedef {{
 *   generatedAt: string,
 *   official: { name: string, version: string, playersCount: number } | null,
 * }} Directory
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {StatusEnv} env */
export function officialHost(env) {
  const configured = env.OFFICIAL_SERVER_HOST?.trim().toLowerCase();
  return configured && hostnamePattern.test(configured)
    ? configured
    : DEFAULT_OFFICIAL_SERVER_HOST;
}

/**
 * @param {unknown} value
 * @param {string} host
 * @param {number} now
 * @returns {Directory | null} null when the directory is malformed or expired
 */
export function parseDirectory(value, host, now) {
  if (
    !isObject(value) ||
    typeof value["schema"] !== "string" ||
    !/^atrinik-classic-directory-v[1-9][0-9]{0,3}$/u.test(value["schema"]) ||
    typeof value["generatedAt"] !== "number" ||
    typeof value["expiresAt"] !== "number" ||
    !Number.isSafeInteger(value["generatedAt"]) ||
    !Number.isSafeInteger(value["expiresAt"]) ||
    !Array.isArray(value["servers"]) ||
    value["servers"].length > 1_000
  )
    return null;
  const generatedAtMs = value["generatedAt"] * 1000;
  // An expired or future-dated directory is stale, not evidence of status.
  if (
    value["expiresAt"] * 1000 <= now ||
    generatedAtMs > now + 5 * 60 * 1000 ||
    generatedAtMs < 0
  )
    return null;
  const matches = value["servers"].filter(
    (server) =>
      isObject(server) &&
      isObject(server["endpoint"]) &&
      typeof server["endpoint"]["hostname"] === "string" &&
      server["endpoint"]["hostname"].toLowerCase() === host,
  );
  const generatedAt = new Date(generatedAtMs).toISOString();
  if (matches.length === 0) return { generatedAt, official: null };
  const entry = matches[0];
  if (
    matches.length !== 1 ||
    !isObject(entry) ||
    !isServerName(entry["name"]) ||
    !isVersion(entry["version"]) ||
    !isPlayersCount(entry["playersCount"])
  )
    return null;
  return {
    generatedAt,
    official: {
      name: /** @type {string} */ (entry["name"]),
      version: /** @type {string} */ (entry["version"]),
      playersCount: /** @type {number} */ (entry["playersCount"]),
    },
  };
}

/**
 * @param {StatusEnv} env
 * @param {StatusDeps} deps
 * @returns {Promise<Directory | null>}
 */
export async function fetchDirectory(env, deps) {
  const value = await fetchJson(deps.fetch, DIRECTORY_URL, {
    hosts: directoryHosts,
    limit: DIRECTORY_LIMIT,
    headers: { Accept: "application/json" },
  });
  return parseDirectory(value, officialHost(env), deps.now());
}

/**
 * @param {StatusEnv} env
 * @param {StatusDeps} deps
 */
export async function fetchOfficialServer(env, deps) {
  return (await fetchDirectory(env, deps))?.official ?? null;
}

/**
 * @param {Directory | null} directory
 * @returns {StatusResponse}
 */
export function statusFromDirectory(directory) {
  if (directory === null) return { available: false };
  return {
    available: true,
    generatedAt: directory.generatedAt,
    server:
      directory.official === null
        ? { online: false }
        : { online: true, ...directory.official },
  };
}
