import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  digest,
  downloadReleaseUrls,
  filesBelow,
  readJson,
  validateDist,
  validateDownload,
  validateDownloadCatalog,
  validateDownloadSchemaDefinition,
  validateDownloadsPresentation,
  validateIcon,
  validateLocalMediaSource,
  validateMedia,
  validatePageMetadata,
  validateRedirects,
} from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2];
if (!new Set(["source", "dist"]).has(mode))
  throw new Error("usage: validate.mjs source|dist");

const downloads = await readJson(resolve(root, "src/data/downloads.json"));
const media = await readJson(resolve(root, "src/data/media.json"));
const icons = await readJson(resolve(root, "src/data/icons.json"));
validateDownloadCatalog(downloads);
if (
  media.schemaVersion !== 1 ||
  !Array.isArray(media.entries) ||
  media.entries.length > 200
)
  throw new Error("invalid media catalog envelope");
media.entries.forEach(validateMedia);
if (
  icons.schemaVersion !== 1 ||
  !Array.isArray(icons.entries) ||
  icons.entries.length !== 2
)
  throw new Error("invalid icon catalog envelope");
icons.entries.forEach(validateIcon);
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
  await validateLocalMediaSource(root, record);
  if (
    (await digest(resolve(root, `public${record.publicPath}`))) !==
    record.publishedSha256
  )
    throw new Error(`published media digest mismatch: ${record.id}`);
}
for (const record of icons.entries) {
  await validateLocalMediaSource(root, record);
  if (
    (await digest(resolve(root, `public${record.publicPath}`))) !==
    record.publishedSha256
  )
    throw new Error(`published icon digest mismatch: ${record.id}`);
  const source = await readFile(
    resolve(root, `public${record.publicPath}`),
    "utf8",
  );
  if (
    !source.startsWith("<svg ") ||
    !source.includes('viewBox="0 0 64 64"') ||
    /<script|\son[a-z]+=|(?:href|src)\s*=/iu.test(source)
  )
    throw new Error(`unsafe icon source: ${record.id}`);
}

const site = await readJson(resolve(root, "src/data/site.json"));
if (site.canonicalOrigin !== "https://atrinik.org")
  throw new Error("privacy/canonical contract drift");
const privacyFields = [
  "applicationAnalytics",
  "applicationCookies",
  "applicationTracking",
  "providerEdgeDisclosure",
];
if (
  site.privacy === null ||
  typeof site.privacy !== "object" ||
  Object.keys(site.privacy).sort().join("\n") !==
    privacyFields.sort().join("\n") ||
  site.privacy.applicationAnalytics !== false ||
  site.privacy.applicationCookies !== false ||
  site.privacy.applicationTracking !== false ||
  typeof site.privacy.providerEdgeDisclosure !== "string" ||
  site.privacy.providerEdgeDisclosure.length < 60 ||
  site.privacy.providerEdgeDisclosure.length > 250
)
  throw new Error("privacy/canonical contract drift");
const identityFields = [
  "heading",
  "gameContent",
  "software",
  "websiteMediaException",
];
if (
  site.identity === null ||
  typeof site.identity !== "object" ||
  Object.keys(site.identity).sort().join("\n") !==
    identityFields.sort().join("\n") ||
  identityFields.some(
    (field) =>
      typeof site.identity[field] !== "string" ||
      site.identity[field].trim() !== site.identity[field] ||
      site.identity[field].length < 30 ||
      site.identity[field].length > 500,
  )
)
  throw new Error("site identity contract drift");
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
  "contracts/icon.schema.json",
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
validateDownloadSchemaDefinition(downloadSchema, fixture);
const mediaSchema = await readJson(
  resolve(root, "contracts/media.schema.json"),
);
const iconSchema = await readJson(resolve(root, "contracts/icon.schema.json"));
const mediaFields = [
  "id",
  "publicPath",
  "sourceRepository",
  "sourcePath",
  "sourceRevision",
  "sourceSha256",
  "publishedSha256",
  "width",
  "height",
  "author",
  "license",
  "transformations",
  "alt",
  "notice",
];
if (
  mediaSchema.additionalProperties !== false ||
  mediaSchema.required.sort().join("\n") !== mediaFields.sort().join("\n")
)
  throw new Error("declarative and executable catalog schemas drifted");
const iconFields = [
  "id",
  "publicPath",
  "sourceRepository",
  "sourcePath",
  "sourceRevision",
  "sourceSha256",
  "publishedSha256",
  "width",
  "height",
  "author",
  "license",
  "transformations",
  "purpose",
  "notice",
];
if (
  iconSchema.additionalProperties !== false ||
  iconSchema.required.sort().join("\n") !== iconFields.sort().join("\n")
)
  throw new Error("declarative and executable icon schemas drifted");

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
const policyOverrides = Object.fromEntries(
  dependencyPolicy.dependencyOverrides.map(({ parent, name, version }) => [
    parent,
    { [name]: version },
  ]),
);
if (
  JSON.stringify(policyOverrides) !== JSON.stringify(packageManifest.overrides)
)
  throw new Error("dependency override policy and package manifest differ");
if (
  packageManifest.allowScripts["esbuild@0.28.1"] !== true ||
  packageManifest.allowScripts.fsevents !== false
)
  throw new Error("install-script allow/deny policy drifted");

validateRedirects(await readFile(resolve(root, "public/_redirects"), "utf8"));
const robots = await readFile(resolve(root, "public/robots.txt"), "utf8");
if (!robots.includes("Sitemap: https://atrinik.org/sitemap.xml"))
  throw new Error("robots.txt does not advertise the canonical sitemap");
const sitemap = await readFile(resolve(root, "public/sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
  (match) => match[1],
);
const expectedSitemapUrls = [
  "https://atrinik.org/",
  "https://atrinik.org/about/",
  "https://atrinik.org/downloads/",
  "https://atrinik.org/licenses/",
];
if (sitemapUrls.join("\n") !== expectedSitemapUrls.join("\n"))
  throw new Error("canonical sitemap routes differ from the public contract");

if (mode === "dist") {
  const home = await readFile(resolve(root, "dist/index.html"), "utf8");
  const decodedHome = home
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
  for (const field of identityFields)
    if (!decodedHome.includes(site.identity[field]))
      throw new Error(`home omits site identity ${field}`);
  if (!decodedHome.includes(site.privacy.providerEdgeDisclosure))
    throw new Error("home omits provider edge disclosure");
  if (!home.includes("Temporary OpenAI-generated website concept artwork:"))
    throw new Error(
      "social metadata omits the generated website-media exception",
    );
  const pageContracts = [
    ["index.html", "https://atrinik.org/", true],
    ["about/index.html", "https://atrinik.org/about/", false],
    ["downloads/index.html", "https://atrinik.org/downloads/", false],
    ["licenses/index.html", "https://atrinik.org/licenses/", false],
    ["404.html", null, false],
  ];
  const identities = [];
  for (const [path, canonicalUrl, websiteIdentity] of pageContracts) {
    const html = await readFile(resolve(root, `dist/${path}`), "utf8");
    for (const icon of icons.entries)
      if (!html.includes(`href="${icon.publicPath}"`))
        throw new Error(`${path} omits icon ${icon.id}`);
    identities.push(
      validatePageMetadata(html, { canonicalUrl, websiteIdentity }),
    );
  }
  for (const field of ["title", "description", "canonicalUrl"]) {
    const values = identities
      .map((identity) => identity[field])
      .filter((value) => value !== null);
    if (new Set(values).size !== values.length)
      throw new Error(`indexable page ${field} values are not unique`);
  }
  validateDownloadsPresentation(
    await readFile(resolve(root, "dist/downloads/index.html"), "utf8"),
    downloads,
  );
  console.log(
    JSON.stringify(
      await validateDist(resolve(root, "dist"), {
        allowedMedia: new Map(
          media.entries.map((record) => [record.publicPath, record]),
        ),
        allowedReleaseUrls: new Set(
          downloads.entries.flatMap(downloadReleaseUrls),
        ),
      }),
    ),
  );
} else
  console.log(
    `source contracts valid: ${downloads.entries.length} downloads, ${media.entries.length} media`,
  );
