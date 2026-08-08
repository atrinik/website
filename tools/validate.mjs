import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readJson,
  validateDist,
  validateDownload,
  validateMedia,
} from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2];
if (!new Set(["source", "dist"]).has(mode))
  throw new Error("usage: validate.mjs source|dist");

const downloads = await readJson(resolve(root, "src/data/downloads.json"));
const media = await readJson(resolve(root, "src/data/media.json"));
if (
  downloads.schemaVersion !== 1 ||
  !Array.isArray(downloads.entries) ||
  downloads.entries.length > 200
)
  throw new Error("invalid download catalog envelope");
if (
  media.schemaVersion !== 1 ||
  !Array.isArray(media.entries) ||
  media.entries.length > 200
)
  throw new Error("invalid media catalog envelope");
downloads.entries.forEach(validateDownload);
media.entries.forEach(validateMedia);
validateDownload(
  await readJson(resolve(root, "tools/fixtures/download-valid.json")),
);

const site = await readJson(resolve(root, "src/data/site.json"));
if (
  site.canonicalOrigin !== "https://atrinik.org" ||
  site.analytics !== false ||
  site.cookies !== false
)
  throw new Error("privacy/canonical contract drift");
for (const link of site.externalLinks) {
  const url = new URL(link.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith("/atrinik/")
  )
    throw new Error("external link not allowlisted");
}
const headers = await readFile(resolve(root, "public/_headers"), "utf8");
for (const directive of [
  "default-src 'none'",
  "script-src 'none'",
  "frame-ancestors 'none'",
  "X-Content-Type-Options: nosniff",
  "Permissions-Policy:",
])
  if (!headers.includes(directive))
    throw new Error(`missing security header ${directive}`);
for (const path of [
  "contracts/download.schema.json",
  "contracts/media.schema.json",
  "LICENSE",
  "PROVENANCE.md",
  "THIRD_PARTY_NOTICES.md",
])
  await access(resolve(root, path));

if (mode === "dist")
  console.log(JSON.stringify(await validateDist(resolve(root, "dist"))));
else
  console.log(
    `source contracts valid: ${downloads.entries.length} downloads, ${media.entries.length} media`,
  );
