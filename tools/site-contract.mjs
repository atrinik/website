import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const limits = Object.freeze({
  totalBytes: 900_000,
  htmlBytes: 140_000,
  cssBytes: 40_000,
  imageBytes: 700_000,
  javascriptBytes: 0,
  requests: 16,
});

const rasterImageExtensions = new Set([
  ".webp",
  ".avif",
  ".png",
  ".jpg",
  ".jpeg",
]);
const sha256Pattern = /^[0-9a-f]{64}$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const artifactPattern = /^[A-Za-z0-9][A-Za-z0-9._-]+$/u;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const mediaPathPattern = /^\/media\/[a-z0-9][a-z0-9-]*\.([0-9a-f]{8})\.webp$/u;
const mediaLicenses = new Set([
  "MIT",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
]);
const establishedRedirects = new Map([
  ["/page/installing_atrinik_client*", "/downloads/"],
  ["/page/how_to_play*", "/downloads/"],
  ["/page/starter_guide*", "/downloads/"],
  ["/page/player_guide*", "/downloads/"],
  ["/page/servers_list*", "/downloads/"],
  ["/page/development_join*", "/about/"],
  ["/page/development*", "/about/"],
  ["/page/team*", "/about/"],
]);

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || !utcTimestampPattern.test(value))
    return false;
  const milliseconds = Date.parse(value);
  return (
    !Number.isNaN(milliseconds) &&
    new Date(milliseconds).toISOString() === value.replace("Z", ".000Z")
  );
}

function isSafeRelativePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\")
  )
    return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function validateDownload(record) {
  const required = [
    "releaseRepository",
    "artifactRole",
    "primary",
    "version",
    "tag",
    "revision",
    "publishedAt",
    "verifiedAt",
    "draft",
    "prerelease",
    "immutable",
    "attested",
    "releaseAssets",
    "platform",
    "architecture",
    "archiveFormat",
    "artifact",
    "bytes",
    "sha256",
    "url",
    "releaseNotesUrl",
    "manifestUrl",
    "checksumsUrl",
    "sbomUrl",
    "softwareLicense",
    "bundledAssetsLicense",
    "compatibility",
    "installation",
  ];
  if (Object.keys(record).sort().join("\n") !== required.sort().join("\n"))
    throw new Error("download fields differ from the closed contract");
  if (
    !/^atrinik\/[a-z][a-z0-9-]*$/u.test(record.releaseRepository) ||
    !/^[a-z][a-z0-9-]*$/u.test(record.artifactRole) ||
    typeof record.primary !== "boolean"
  )
    throw new Error("invalid download repository/role");
  if (
    !versionPattern.test(record.version) ||
    record.tag !== `v${record.version}`
  )
    throw new Error("download version/tag mismatch");
  if (
    !revisionPattern.test(record.revision) ||
    !sha256Pattern.test(record.sha256)
  )
    throw new Error("invalid immutable download digest");
  if (
    !isCanonicalUtcTimestamp(record.publishedAt) ||
    !isCanonicalUtcTimestamp(record.verifiedAt) ||
    Date.parse(record.verifiedAt) < Date.parse(record.publishedAt) ||
    record.draft !== false ||
    record.prerelease !== false ||
    record.immutable !== true ||
    record.attested !== true ||
    !Number.isSafeInteger(record.releaseAssets) ||
    record.releaseAssets < 1 ||
    record.releaseAssets > 200
  )
    throw new Error("download release is not published and eligible");
  if (
    !artifactPattern.test(record.artifact) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    record.bytes > 2_147_483_648
  )
    throw new Error("invalid download artifact bounds");
  if (
    !new Set(["linux", "macos", "windows"]).has(record.platform) ||
    record.architecture !== "x86_64" ||
    !new Set(["tar.gz", "zip"]).has(record.archiveFormat) ||
    !record.artifact.endsWith(`.${record.archiveFormat}`)
  )
    throw new Error("unsupported download target");
  const releaseRoot = `https://github.com/${record.releaseRepository}/releases`;
  const downloadRoot = `${releaseRoot}/download/${record.tag}`;
  const expected = `${downloadRoot}/${record.artifact}`;
  if (record.url !== expected)
    throw new Error(
      "download URL is mutable or does not match its immutable identity",
    );
  const expectedLinks = {
    releaseNotesUrl: `${releaseRoot}/tag/${record.tag}`,
    manifestUrl: `${downloadRoot}/release-manifest.json`,
    checksumsUrl: `${downloadRoot}/SHA256SUMS`,
  };
  for (const [field, value] of Object.entries(expectedLinks))
    if (record[field] !== value)
      throw new Error(`download ${field} does not match its immutable release`);
  if (
    typeof record.sbomUrl !== "string" ||
    !record.sbomUrl.startsWith(`${downloadRoot}/`) ||
    !record.sbomUrl.endsWith(".spdx.json")
  )
    throw new Error("download SBOM does not match its immutable release");
  const stringBounds = {
    bundledAssetsLicense: 300,
    compatibility: 300,
    installation: 500,
  };
  if (!new Set(["GPL-2.0-or-later", "MIT"]).has(record.softwareLicense))
    throw new Error("invalid download softwareLicense");
  for (const [field, maximum] of Object.entries(stringBounds))
    if (
      typeof record[field] !== "string" ||
      record[field].trim() !== record[field] ||
      record[field].length < 20 ||
      record[field].length > maximum
    )
      throw new Error(`invalid download ${field}`);
}

export function validateDownloadCatalog(catalog) {
  if (
    catalog === null ||
    typeof catalog !== "object" ||
    Object.keys(catalog).sort().join("\n") !== "entries\nschemaVersion" ||
    catalog.schemaVersion !== 2 ||
    !Array.isArray(catalog.entries) ||
    catalog.entries.length > 200
  )
    throw new Error("invalid download catalog envelope");
  catalog.entries.forEach(validateDownload);
  if (
    new Set(catalog.entries.map((record) => record.url)).size !==
    catalog.entries.length
  )
    throw new Error("duplicate download coordinate");
  const primary = catalog.entries.filter((record) => record.primary);
  if (primary.length > 1)
    throw new Error("download catalog has multiple primary artifacts");
  if (
    primary.some(
      (record) =>
        record.releaseRepository !== "atrinik/classic" ||
        record.artifactRole !== "client" ||
        record.platform !== "windows" ||
        record.architecture !== "x86_64" ||
        record.releaseAssets !== 12,
    )
  )
    throw new Error("unsupported primary download artifact");
}

export function downloadReleaseUrls(record) {
  return [
    record.url,
    record.releaseNotesUrl,
    record.manifestUrl,
    record.checksumsUrl,
    record.sbomUrl,
  ];
}

export function validateDownloadsPresentation(html, catalog) {
  validateDownloadCatalog(catalog);
  const primary = catalog.entries.find((record) => record.primary);
  if (!primary) {
    if (
      !html.includes("No site-verified immutable catalog yet") ||
      html.includes("/releases/download/")
    )
      throw new Error(
        "empty download catalog did not render its safe fallback",
      );
    return;
  }
  const requiredEvidence = [
    primary.version,
    primary.revision,
    primary.sha256,
    primary.artifact,
    primary.releaseRepository,
    `${(primary.bytes / 1024 ** 2).toFixed(2)} MiB`,
    primary.bytes.toLocaleString("en-US"),
    ...downloadReleaseUrls(primary),
  ];
  if (requiredEvidence.some((value) => !html.includes(value)))
    throw new Error("primary download presentation omits catalog evidence");
  if (!html.includes("gh attestation verify"))
    throw new Error("primary download presentation omits attestation guidance");
}

export function validateMedia(record) {
  const required = [
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
  if (Object.keys(record).sort().join("\n") !== required.sort().join("\n"))
    throw new Error("media fields differ from the closed contract");
  const mediaPath = mediaPathPattern.exec(record.publicPath);
  if (!/^[a-z][a-z0-9-]*$/u.test(record.id) || !mediaPath)
    throw new Error("invalid media identity/path");
  if (
    !isSafeRelativePath(record.sourcePath) ||
    record.sourceRepository !== "atrinik/website"
  )
    throw new Error("unsafe media source");
  if (
    !revisionPattern.test(record.sourceRevision) ||
    !sha256Pattern.test(record.sourceSha256) ||
    !sha256Pattern.test(record.publishedSha256)
  )
    throw new Error("invalid media digest");
  if (!record.publishedSha256.startsWith(mediaPath[1]))
    throw new Error("media path does not match its published digest");
  if (
    !Number.isSafeInteger(record.width) ||
    record.width < 1 ||
    record.width > 16_384 ||
    !Number.isSafeInteger(record.height) ||
    record.height < 1 ||
    record.height > 16_384
  )
    throw new Error("invalid media dimensions");
  const stringBounds = {
    sourcePath: 500,
    author: 200,
    alt: 500,
    notice: 500,
  };
  for (const [field, maximum] of Object.entries(stringBounds))
    if (
      typeof record[field] !== "string" ||
      record[field].trim() !== record[field] ||
      record[field].length === 0 ||
      record[field].length > maximum
    )
      throw new Error(`invalid media ${field}`);
  if (!mediaLicenses.has(record.license))
    throw new Error("unsupported media license");
  if (
    !Array.isArray(record.transformations) ||
    record.transformations.length < 1 ||
    record.transformations.length > 20 ||
    record.transformations.some(
      (item) =>
        typeof item !== "string" ||
        item.trim() !== item ||
        item.length === 0 ||
        item.length > 300,
    )
  )
    throw new Error("invalid media transformations");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function filesBelow(root) {
  const absoluteRoot = resolve(root);
  const pending = [absoluteRoot];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const resolved = resolve(path);
      if (!resolved.startsWith(`${absoluteRoot}${sep}`))
        throw new Error("path escaped validation root");
      if (entry.isSymbolicLink())
        throw new Error(
          `generated output contains symlink: ${relative(absoluteRoot, path)}`,
        );
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else
        throw new Error(
          `generated output contains special file: ${relative(absoluteRoot, path)}`,
        );
    }
  }
  return files.sort();
}

export async function digest(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export function gitBlobObjectId(content) {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

export async function validateLocalMediaSource(root, record) {
  if (
    !isSafeRelativePath(record.sourcePath) ||
    record.sourceRepository !== "atrinik/website"
  )
    throw new Error(`unsafe media source: ${record.id}`);
  const absoluteRoot = await realpath(resolve(root));
  let path = absoluteRoot;
  const segments = record.sourcePath.split("/");
  for (const [index, segment] of segments.entries()) {
    const candidate = join(path, segment);
    const information = await lstat(candidate);
    if (information.isSymbolicLink())
      throw new Error(`media source contains a symbolic link: ${record.id}`);
    path = await realpath(candidate);
    if (!path.startsWith(`${absoluteRoot}${sep}`))
      throw new Error(`media source escaped repository: ${record.id}`);
    if (index < segments.length - 1 && !information.isDirectory())
      throw new Error(`media source parent is not a directory: ${record.id}`);
    if (index === segments.length - 1 && !information.isFile())
      throw new Error(`media source is not a regular file: ${record.id}`);
  }
  const content = await readFile(path);
  if (
    createHash("sha256").update(content).digest("hex") !== record.sourceSha256
  )
    throw new Error(`media source digest mismatch: ${record.id}`);
  if (gitBlobObjectId(content) !== record.sourceRevision)
    throw new Error(`media source object mismatch: ${record.id}`);
}

export function readWebpDimensions(content) {
  if (
    !Buffer.isBuffer(content) ||
    content.length < 20 ||
    content.toString("ascii", 0, 4) !== "RIFF" ||
    content.toString("ascii", 8, 12) !== "WEBP" ||
    content.readUInt32LE(4) + 8 > content.length
  )
    throw new Error("invalid WebP container");

  const containerEnd = content.readUInt32LE(4) + 8;
  let offset = 12;
  while (offset + 8 <= containerEnd) {
    const chunk = content.toString("ascii", offset, offset + 4);
    const chunkSize = content.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkSize;
    if (chunkEnd > containerEnd) throw new Error("invalid WebP chunk bounds");

    if (chunk === "VP8X") {
      if (chunkSize < 10) throw new Error("invalid VP8X dimensions");
      return {
        width: content.readUIntLE(dataOffset + 4, 3) + 1,
        height: content.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }
    if (chunk === "VP8L") {
      if (chunkSize < 5 || content[dataOffset] !== 0x2f)
        throw new Error("invalid VP8L dimensions");
      const packed = content.readUInt32LE(dataOffset + 1);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8 ") {
      if (
        chunkSize < 10 ||
        content[dataOffset + 3] !== 0x9d ||
        content[dataOffset + 4] !== 0x01 ||
        content[dataOffset + 5] !== 0x2a
      )
        throw new Error("invalid VP8 dimensions");
      const width = content.readUInt16LE(dataOffset + 6) & 0x3fff;
      const height = content.readUInt16LE(dataOffset + 8) & 0x3fff;
      if (width === 0 || height === 0)
        throw new Error("invalid VP8 dimensions");
      return { width, height };
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  throw new Error("WebP dimensions are unavailable");
}

export function validatePresentationCss(css) {
  const imageRule = css.match(/(?:^|\})\s*img\s*\{([^}]*)\}/u);
  if (
    !imageRule ||
    !/(?:^|;)\s*height\s*:\s*auto\s*(?:;|$)/u.test(imageRule[1])
  )
    throw new Error("responsive image baseline must set img height: auto");
  if (/object-fit\s*:\s*cover/iu.test(css))
    throw new Error("artwork cropping effect is forbidden");
  if (/backdrop-filter\s*:/iu.test(css) || /filter\s*:\s*blur\s*\(/iu.test(css))
    throw new Error("costly scrolling paint effect is forbidden");
  if (/body::?before[^\{]*\{[^}]*position\s*:\s*fixed/isu.test(css))
    throw new Error("fixed viewport decoration is forbidden");
}

export function validateRedirects(source) {
  const redirects = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split(/\s+/u);
    if (
      fields.length !== 3 ||
      !fields[0].startsWith("/page/") ||
      !fields[0].endsWith("*") ||
      !new Set(["/about/", "/downloads/"]).has(fields[1]) ||
      fields[2] !== "301" ||
      redirects.has(fields[0])
    )
      throw new Error(`invalid established redirect: ${line}`);
    redirects.set(fields[0], fields[1]);
  }
  if (
    redirects.size !== establishedRedirects.size ||
    [...establishedRedirects].some(([from, to]) => redirects.get(from) !== to)
  )
    throw new Error("established redirect set is incomplete or changed");
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export async function validateDist(
  root,
  { allowedMedia = new Map(), allowedReleaseUrls = new Set() } = {},
) {
  const files = await filesBelow(root);
  if (files.length === 0 || files.length > limits.requests)
    throw new Error(`static request budget exceeded: ${files.length}`);
  const totals = { total: 0, html: 0, css: 0, images: 0, javascript: 0 };
  const publicPaths = new Set(
    files.map((path) => `/${relative(root, path).replaceAll(sep, "/")}`),
  );
  const styles = [];
  const rasterFiles = [];
  let containsImages = false;
  for (const path of files) {
    const size = (await stat(path)).size;
    const extension = extname(path).toLowerCase();
    totals.total += size;
    if (extension === ".html") {
      totals.html += size;
      const html = await readFile(path, "utf8");
      for (const pattern of [
        /<html lang="en">/u,
        /<main[ >]/u,
        /href="#content"/u,
        /aria-label="Primary navigation"/u,
        /<title>[^<]+<\/title>/u,
        /<meta name="description" content="[^"]+"\s*\/?>/u,
        /<link rel="canonical" href="https:\/\/atrinik\.org\/[^"]*"\s*\/?>/u,
        /<meta property="og:title" content="[^"]+"\s*\/?>/u,
        /<meta property="og:description" content="[^"]+"\s*\/?>/u,
        /<meta property="og:image" content="https:\/\/atrinik\.org\/media\/[^"]+"\s*\/?>/u,
        /<meta name="twitter:card" content="summary_large_image"\s*\/?>/u,
      ])
        if (!pattern.test(html))
          throw new Error(`accessibility shell missing in ${path}`);
      if ([...html.matchAll(/<h1[ >]/gu)].length !== 1)
        throw new Error(`page must have exactly one h1 in ${path}`);
      if (
        relative(root, path).replaceAll(sep, "/") === "404.html" &&
        !/<meta name="robots" content="noindex, nofollow"\s*\/?>/u.test(html)
      )
        throw new Error("404 page must be excluded from indexing");
      if (/<script[ >]/iu.test(html) || /\son[a-z]+=/iu.test(html))
        throw new Error(`client script/event handler forbidden in ${path}`);
      for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
        containsImages = true;
        const source = /\ssrc="([^"]+)"/iu.exec(match[0]);
        const alt = /\salt="([^"]+)"/iu.exec(match[0]);
        const width = /\swidth="([1-9][0-9]*)"/iu.exec(match[0]);
        const height = /\sheight="([1-9][0-9]*)"/iu.exec(match[0]);
        if (!alt) throw new Error(`image lacks useful alt text in ${path}`);
        if (!source || !width || !height)
          throw new Error(`image lacks intrinsic dimensions in ${path}`);
        const url = new URL(source[1], "https://atrinik.org/");
        const expected = allowedMedia.get(url.pathname);
        if (
          url.origin !== "https://atrinik.org" ||
          url.search !== "" ||
          url.hash !== "" ||
          !publicPaths.has(url.pathname) ||
          !expected ||
          decodeHtmlAttribute(alt[1]) !== expected.alt ||
          Number(width[1]) !== expected.width ||
          Number(height[1]) !== expected.height
        )
          throw new Error(`image is not bound to its media record in ${path}`);
      }
      for (const match of html.matchAll(/href="([^"]+)"/gu)) {
        const raw = match[1];
        if (raw.startsWith("#")) continue;
        const url = new URL(raw, "https://atrinik.org/");
        if (url.protocol !== "https:")
          throw new Error(`unsafe link protocol ${raw} in ${path}`);
        if (url.hostname === "atrinik.org") {
          const target = url.pathname;
          if (target === "/" || target.endsWith("/")) {
            const index =
              target === "/" ? "/index.html" : `${target}index.html`;
            if (!publicPaths.has(index))
              throw new Error(`broken internal link ${target} in ${path}`);
          } else if (!publicPaths.has(target))
            throw new Error(`broken internal link ${target} in ${path}`);
        } else if (
          url.hostname === "github.com" &&
          url.pathname.startsWith("/atrinik/")
        ) {
          if (
            (url.pathname.includes("/releases/download/") ||
              url.pathname.includes("/releases/tag/")) &&
            !allowedReleaseUrls.has(url.href)
          )
            throw new Error(`unrecorded release link ${raw} in ${path}`);
        } else {
          throw new Error(`external link origin is not allowlisted: ${raw}`);
        }
      }
    } else if (extension === ".css") {
      totals.css += size;
      styles.push(await readFile(path, "utf8"));
    } else if (path.endsWith(`${sep}_redirects`)) {
      validateRedirects(await readFile(path, "utf8"));
    } else if (rasterImageExtensions.has(extension)) {
      totals.images += size;
      rasterFiles.push({
        path,
        publicPath: `/${relative(root, path).replaceAll(sep, "/")}`,
      });
    } else if (new Set([".js", ".mjs", ".cjs"]).has(extension))
      totals.javascript += size;
  }
  if (
    totals.total > limits.totalBytes ||
    totals.html > limits.htmlBytes ||
    totals.css > limits.cssBytes ||
    totals.images > limits.imageBytes ||
    totals.javascript > limits.javascriptBytes
  )
    throw new Error(`performance budget exceeded: ${JSON.stringify(totals)}`);
  const rasterPaths = new Set(rasterFiles.map(({ publicPath }) => publicPath));
  if (
    rasterPaths.size !== allowedMedia.size ||
    [...rasterPaths].some((path) => !allowedMedia.has(path)) ||
    [...allowedMedia.keys()].some((path) => !rasterPaths.has(path))
  )
    throw new Error("built raster files and proven media records differ");
  for (const { path, publicPath } of rasterFiles) {
    if (extname(path).toLowerCase() !== ".webp")
      throw new Error(`catalogued media is not WebP: ${publicPath}`);
    const dimensions = readWebpDimensions(await readFile(path));
    const expected = allowedMedia.get(publicPath);
    if (
      dimensions.width !== expected.width ||
      dimensions.height !== expected.height
    )
      throw new Error(`published media dimensions mismatch: ${publicPath}`);
  }
  if (containsImages) validatePresentationCss(styles.join("\n"));
  return { files: files.length, ...totals };
}
