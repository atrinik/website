import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const limits = Object.freeze({
  totalBytes: 100_000,
  htmlBytes: 40_000,
  cssBytes: 24_000,
  javascriptBytes: 0,
  requests: 10,
});

const sha256Pattern = /^[0-9a-f]{64}$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const artifactPattern = /^[A-Za-z0-9][A-Za-z0-9._-]+$/u;

export function validateDownload(record) {
  const required = [
    "component",
    "version",
    "tag",
    "revision",
    "platform",
    "architecture",
    "artifact",
    "bytes",
    "sha256",
    "url",
    "license",
    "compatibility",
  ];
  if (Object.keys(record).sort().join("\n") !== required.sort().join("\n"))
    throw new Error("download fields differ from the closed contract");
  if (!/^[a-z][a-z0-9-]*$/u.test(record.component))
    throw new Error("invalid download component");
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
    !artifactPattern.test(record.artifact) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    record.bytes > 2_147_483_648
  )
    throw new Error("invalid download artifact bounds");
  if (
    !new Set(["linux", "windows"]).has(record.platform) ||
    record.architecture !== "x86_64"
  )
    throw new Error("unsupported download target");
  const expected = `https://github.com/atrinik/${record.component}/releases/download/${record.tag}/${record.artifact}`;
  if (record.url !== expected)
    throw new Error(
      "download URL is mutable or does not match its immutable identity",
    );
  if (
    typeof record.license !== "string" ||
    record.license.length === 0 ||
    record.license.length > 80
  )
    throw new Error("invalid download license");
  if (
    typeof record.compatibility !== "string" ||
    record.compatibility.length === 0 ||
    record.compatibility.length > 300
  )
    throw new Error("invalid download compatibility");
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
    "author",
    "license",
    "transformations",
    "alt",
    "notice",
  ];
  if (Object.keys(record).sort().join("\n") !== required.sort().join("\n"))
    throw new Error("media fields differ from the closed contract");
  if (
    !/^[a-z][a-z0-9-]*$/u.test(record.id) ||
    !/^\/media\/[A-Za-z0-9._/-]+$/u.test(record.publicPath)
  )
    throw new Error("invalid media identity/path");
  if (
    record.publicPath.includes("..") ||
    !/^atrinik\/[a-z0-9-]+$/u.test(record.sourceRepository)
  )
    throw new Error("unsafe media source");
  if (
    !revisionPattern.test(record.sourceRevision) ||
    !sha256Pattern.test(record.sourceSha256) ||
    !sha256Pattern.test(record.publishedSha256)
  )
    throw new Error("invalid media digest");
  for (const field of ["sourcePath", "author", "license", "alt", "notice"])
    if (
      typeof record[field] !== "string" ||
      record[field].length === 0 ||
      record[field].length > 500
    )
      throw new Error(`invalid media ${field}`);
  if (
    !Array.isArray(record.transformations) ||
    record.transformations.length > 20 ||
    record.transformations.some(
      (item) => typeof item !== "string" || item.length > 300,
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

export async function validateDist(
  root,
  { allowedReleaseUrls = new Set() } = {},
) {
  const files = await filesBelow(root);
  if (files.length === 0 || files.length > limits.requests)
    throw new Error(`static request budget exceeded: ${files.length}`);
  const totals = { total: 0, html: 0, css: 0, javascript: 0 };
  const publicPaths = new Set(
    files.map((path) => `/${relative(root, path).replaceAll(sep, "/")}`),
  );
  for (const path of files) {
    const size = (await stat(path)).size;
    totals.total += size;
    if (extname(path) === ".html") {
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
      ])
        if (!pattern.test(html))
          throw new Error(`accessibility shell missing in ${path}`);
      if ([...html.matchAll(/<h1[ >]/gu)].length !== 1)
        throw new Error(`page must have exactly one h1 in ${path}`);
      if (/<script[ >]/iu.test(html) || /\son[a-z]+=/iu.test(html))
        throw new Error(`client script/event handler forbidden in ${path}`);
      for (const match of html.matchAll(/<img\b[^>]*>/giu))
        if (!/\balt="[^"]+"/iu.test(match[0]))
          throw new Error(`image lacks useful alt text in ${path}`);
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
            url.pathname.includes("/releases/download/") &&
            !allowedReleaseUrls.has(url.href)
          )
            throw new Error(`unrecorded release link ${raw} in ${path}`);
        } else {
          throw new Error(`external link origin is not allowlisted: ${raw}`);
        }
      }
    } else if (extname(path) === ".css") totals.css += size;
    else if (new Set([".js", ".mjs", ".cjs"]).has(extname(path)))
      totals.javascript += size;
  }
  if (
    totals.total > limits.totalBytes ||
    totals.html > limits.htmlBytes ||
    totals.css > limits.cssBytes ||
    totals.javascript > limits.javascriptBytes
  )
    throw new Error(`performance budget exceeded: ${JSON.stringify(totals)}`);
  return { files: files.length, ...totals };
}
