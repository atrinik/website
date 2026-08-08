import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  digest,
  filesBelow,
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
if (
  new Set(downloads.entries.map((record) => record.url)).size !==
  downloads.entries.length
)
  throw new Error("duplicate download coordinate");
if (
  new Set(media.entries.map((record) => record.id)).size !==
  media.entries.length
)
  throw new Error("duplicate media id");
if (
  new Set(media.entries.map((record) => record.publicPath)).size !==
  media.entries.length
)
  throw new Error("duplicate media public path");
validateDownload(
  await readJson(resolve(root, "tools/fixtures/download-valid.json")),
);

const mediaRoot = resolve(root, "public/media");
let mediaFiles = [];
try {
  mediaFiles = await filesBelow(mediaRoot);
} catch (error) {
  if (error.code !== "ENOENT" || media.entries.length !== 0) throw error;
}
const actualMediaPaths = mediaFiles.map(
  (path) => `/media/${relative(mediaRoot, path).replaceAll(sep, "/")}`,
);
if (
  actualMediaPaths.sort().join("\n") !==
  media.entries
    .map((record) => record.publicPath)
    .sort()
    .join("\n")
)
  throw new Error("published media files and catalog rows differ");
for (const record of media.entries) {
  if (
    (await digest(resolve(root, `public${record.publicPath}`))) !==
    record.publishedSha256
  )
    throw new Error(`published media digest mismatch: ${record.id}`);
}

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
  "Strict-Transport-Security:",
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

const fixture = await readJson(
  resolve(root, "tools/fixtures/download-valid.json"),
);
const downloadSchema = await readJson(
  resolve(root, "contracts/download.schema.json"),
);
const mediaSchema = await readJson(
  resolve(root, "contracts/media.schema.json"),
);
const mediaFields = [
  "id",
  "publicPath",
  "sourceRepository",
  "sourcePath",
  "sourceRevision",
  "sourceSha256",
  "publishedSha256",
  "author",
  "license",
  "transformations",
  "alt",
  "notice",
];
if (
  downloadSchema.additionalProperties !== false ||
  downloadSchema.required.sort().join("\n") !==
    Object.keys(fixture).sort().join("\n") ||
  mediaSchema.additionalProperties !== false ||
  mediaSchema.required.sort().join("\n") !== mediaFields.sort().join("\n")
)
  throw new Error("declarative and executable catalog schemas drifted");

const packageManifest = await readJson(resolve(root, "package.json"));
const dependencyPolicy = await readJson(
  resolve(root, "policy/dependencies.json"),
);
const policyPins = Object.fromEntries(
  dependencyPolicy.developmentDependencies.map(({ name, version }) => [
    name,
    version,
  ]),
);
if (
  JSON.stringify(policyPins) !== JSON.stringify(packageManifest.devDependencies)
)
  throw new Error("direct dependency policy and package pins differ");
if (
  packageManifest.allowScripts["esbuild@0.28.1"] !== true ||
  packageManifest.allowScripts.fsevents !== false
)
  throw new Error("install-script allow/deny policy drifted");

if (mode === "dist")
  console.log(
    JSON.stringify(
      await validateDist(resolve(root, "dist"), {
        allowedReleaseUrls: new Set(
          downloads.entries.map((record) => record.url),
        ),
      }),
    ),
  );
else
  console.log(
    `source contracts valid: ${downloads.entries.length} downloads, ${media.entries.length} media`,
  );
