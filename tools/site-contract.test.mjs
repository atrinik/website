import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import downloadSchema from "../contracts/download.schema.json" with { type: "json" };
import adversarialDownloadCatalog from "./fixtures/download-adversarial-catalog.json" with { type: "json" };
import emptyDownloadCatalog from "./fixtures/download-empty-catalog.json" with { type: "json" };
import validDownload from "./fixtures/download-valid.json" with { type: "json" };
import {
  downloadReleaseUrls,
  limits,
  digest,
  gitBlobObjectId,
  readWebpDimensions,
  validateDist,
  validateDownload,
  validateDownloadCatalog,
  validateDownloadSchemaDefinition,
  validateDownloadsPresentation,
  validateIcon,
  validateLocalMediaSource,
  validateMedia,
  validatePageMetadata,
  validatePresentationCss,
  validateRedirects,
} from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");

const accessibleShell =
  '<!doctype html><html lang="en"><head><title>Title</title><meta name="description" content="Description"><link rel="canonical" href="https://atrinik.org/"><meta property="og:title" content="Title"><meta property="og:description" content="Description"><meta property="og:image" content="https://atrinik.org/media/social.00000000.webp"><meta name="twitter:card" content="summary_large_image"></head><body><a href="#content">Skip</a><nav aria-label="Primary navigation"></nav><main id="content"><h1>Title</h1></main></body></html>';

const completeMetadataShell =
  '<!doctype html><html lang="en"><head><title>About Atrinik</title><meta name="description" content="A useful description"><meta name="robots" content="index, follow"><link rel="canonical" href="https://atrinik.org/about/"><meta property="og:type" content="website"><meta property="og:title" content="About Atrinik"><meta property="og:description" content="A useful description"><meta property="og:url" content="https://atrinik.org/about/"><meta property="og:image" content="https://atrinik.org/media/social.00000000.webp"><meta property="og:image:alt" content="A useful social image alternative"><meta property="og:image:width" content="1120"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="About Atrinik"><meta name="twitter:description" content="A useful description"><meta name="twitter:image" content="https://atrinik.org/media/social.00000000.webp"><meta name="twitter:image:alt" content="A useful social image alternative"></head><body></body></html>';

const validMedia = {
  id: "licensed-image",
  publicPath: "/media/licensed.44444444.webp",
  sourceRepository: "atrinik/website",
  sourcePath: "paintings/licensed.png",
  sourceRevision: "2".repeat(40),
  sourceSha256: "3".repeat(64),
  publishedSha256: "4".repeat(64),
  width: 640,
  height: 480,
  author: "Example Author",
  license: "CC-BY-4.0",
  transformations: ["lossless metadata removal"],
  alt: "A described fixture",
  notice: "Copyright Example Author",
};

const validIcon = {
  id: "atrinik-favicon",
  publicPath: "/favicon.svg",
  sourceRepository: "atrinik/website",
  sourcePath: "public/favicon.svg",
  sourceRevision: "2".repeat(40),
  sourceSha256: "3".repeat(64),
  publishedSha256: "3".repeat(64),
  width: 64,
  height: 64,
  author: "Example Author",
  license: "MIT",
  transformations: ["Authored as SVG."],
  purpose: "Browser favicon.",
  notice: "Example notice.",
};

function riffWebp(chunk, payload, totalBytes) {
  const minimumBytes = 20 + payload.length + (payload.length % 2);
  const length = totalBytes ?? minimumBytes;
  if (length < minimumBytes) throw new Error("WebP fixture is too small");
  const content = Buffer.alloc(length);
  content.write("RIFF", 0, "ascii");
  content.writeUInt32LE(length - 8, 4);
  content.write("WEBP", 8, "ascii");
  content.write(chunk, 12, "ascii");
  content.writeUInt32LE(payload.length, 16);
  payload.copy(content, 20);
  return content;
}

function vp8xFixture(width, height, totalBytes) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riffWebp("VP8X", payload, totalBytes);
}

function vp8lFixture(width, height) {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return riffWebp("VP8L", payload);
}

function vp8Fixture(width, height) {
  const payload = Buffer.alloc(10);
  payload.set([0x9d, 0x01, 0x2a], 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return riffWebp("VP8 ", payload);
}

test("download coordinates are closed and immutable", () => {
  assert.doesNotThrow(() =>
    validateDownloadSchemaDefinition(downloadSchema, validDownload),
  );
  assert.doesNotThrow(() => validateDownload(validDownload));
  assert.throws(
    () =>
      validateDownload({ ...validDownload, url: "https://example.com/latest" }),
    /mutable/u,
  );
  assert.throws(
    () => validateDownload({ ...validDownload, extra: true }),
    /closed/u,
  );
  const { sha256: _missingDigest, ...incompleteDownload } = validDownload;
  assert.throws(() => validateDownload(incompleteDownload), /closed/u);
  for (const ineligible of [
    { draft: true },
    { prerelease: true },
    { immutable: false },
    { attested: false },
    { releaseAssets: 0 },
  ])
    assert.throws(
      () => validateDownload({ ...validDownload, ...ineligible }),
      /published and eligible/u,
    );
  assert.throws(
    () =>
      validateDownload({
        ...validDownload,
        softwareLicense: "see bundled files",
      }),
    /softwareLicense/u,
  );
  assert.throws(
    () =>
      validateDownload({
        ...validDownload,
        releaseRepository: "atrinik/client",
      }),
    /immutable/u,
  );
  assert.deepEqual(downloadReleaseUrls(validDownload), [
    validDownload.url,
    validDownload.releaseNotesUrl,
    validDownload.manifestUrl,
    validDownload.checksumsUrl,
    validDownload.sbomUrl,
  ]);
  for (const sbomUrl of [
    `${validDownload.sbomUrl}?claimed=.spdx.json`,
    `${validDownload.sbomUrl}#claimed.spdx.json`,
    validDownload.sbomUrl.replace(
      "atrinik-classic-1.2.3.spdx.json",
      "nested/false.spdx.json",
    ),
    validDownload.sbomUrl.replace(".spdx.json", ".json"),
  ])
    assert.throws(
      () => validateDownload({ ...validDownload, sbomUrl }),
      /SBOM/u,
    );
});

test("download schema and executable constraints reject the same edge forms", () => {
  const rejected = [
    ["version", "01.2.3"],
    ["tag", "v01.2.3"],
    ["publishedAt", "2026-99-99T99:99:99Z"],
    ["publishedAt", "2026-02-31T00:00:00Z"],
    ["compatibility", ` ${validDownload.compatibility}`],
    ["installation", `${validDownload.installation} `],
  ];
  for (const [field, value] of rejected) {
    assert.throws(() => validateDownload({ ...validDownload, [field]: value }));
    const property = downloadSchema.properties[field];
    if (property.pattern)
      assert.equal(new RegExp(property.pattern, "u").test(value), false);
  }
  const timestampPattern = new RegExp(
    downloadSchema.properties.publishedAt.pattern,
    "u",
  );
  assert.equal(timestampPattern.test("2024-02-29T23:59:59Z"), true);
  assert.equal(timestampPattern.test("2025-02-29T00:00:00Z"), false);
  assert.equal(timestampPattern.test("1900-02-29T00:00:00Z"), false);
  assert.equal(timestampPattern.test("2000-02-29T00:00:00Z"), true);
  assert.equal(timestampPattern.test("2100-02-29T00:00:00Z"), false);
  assert.equal(timestampPattern.test("2400-02-29T00:00:00Z"), true);
  assert.doesNotThrow(() =>
    validateDownload({
      ...validDownload,
      publishedAt: "2024-02-29T23:59:59Z",
      verifiedAt: "2024-03-01T00:00:00Z",
    }),
  );
  assert.throws(() =>
    validateDownload({
      ...validDownload,
      verifiedAt: "2025-12-31T23:59:59Z",
    }),
  );
  assert.throws(() =>
    validateDownload({
      ...validDownload,
      artifact: "atrinik-classic-client-1.2.3-windows-x86_64.tar.gz",
    }),
  );
  assert.throws(() =>
    validateDownload({ ...validDownload, compatibility: "😀".repeat(10) }),
  );
  assert.doesNotThrow(() =>
    validateDownload({ ...validDownload, compatibility: "😀".repeat(20) }),
  );
  assert.doesNotThrow(() =>
    validateDownload({ ...validDownload, compatibility: "😀".repeat(151) }),
  );
  assert.throws(() =>
    validateDownload({ ...validDownload, compatibility: "😀".repeat(301) }),
  );
});

test("download catalogs stay empty safely and reject ineligible releases", () => {
  assert.doesNotThrow(() => validateDownloadCatalog(emptyDownloadCatalog));
  assert.doesNotThrow(() =>
    validateDownloadsPresentation(
      'No site-verified immutable catalog yet <a href="https://github.com/atrinik/classic/releases">Releases</a>',
      emptyDownloadCatalog,
    ),
  );
  assert.throws(
    () =>
      validateDownloadsPresentation(
        "No site-verified immutable catalog yet https://github.com/atrinik/classic/releases/download/v9.9.9/guessed.zip",
        emptyDownloadCatalog,
      ),
    /safe fallback/u,
  );
  assert.throws(
    () => validateDownloadCatalog(adversarialDownloadCatalog),
    /published and eligible/u,
  );
  assert.throws(
    () =>
      validateDownloadCatalog({
        schemaVersion: 2,
        entries: [validDownload, { ...validDownload }],
      }),
    /duplicate|multiple primary/u,
  );
  assert.throws(
    () =>
      validateDownloadCatalog({
        schemaVersion: 2,
        entries: [{ ...validDownload, artifactRole: "server" }],
      }),
    /unsupported primary/u,
  );
  const serverArtifact = "atrinik-classic-server-1.2.3-windows-x86_64.zip";
  assert.throws(
    () =>
      validateDownloadCatalog({
        schemaVersion: 2,
        entries: [
          {
            ...validDownload,
            artifact: serverArtifact,
            url: `https://github.com/atrinik/classic/releases/download/v1.2.3/${serverArtifact}`,
          },
        ],
      }),
    /unsupported primary/u,
  );
  assert.throws(
    () =>
      validateDownloadCatalog({
        schemaVersion: 2,
        entries: [{ ...validDownload, softwareLicense: "MIT" }],
      }),
    /unsupported primary/u,
  );
});

test("download presentation structurally preserves all catalog evidence", () => {
  const evidence = [
    validDownload.version,
    validDownload.revision,
    validDownload.sha256,
    validDownload.artifact,
    validDownload.releaseRepository,
    validDownload.architecture,
    validDownload.archiveFormat.toUpperCase(),
    validDownload.softwareLicense,
    validDownload.bundledAssetsLicense,
    validDownload.compatibility,
    validDownload.installation,
    "Windows",
    `${(validDownload.bytes / 1024 ** 2).toFixed(2)} MiB`,
    validDownload.bytes.toLocaleString("en-US"),
    "Get-FileHash",
    "gh attestation verify",
    `Download Classic ${validDownload.version} for Windows (x86_64 ZIP)`,
  ];
  const links = downloadReleaseUrls(validDownload)
    .map((url, index) =>
      index === 0
        ? `<a class="button button--primary" href="${url}">Download</a>`
        : `<a href="${url}">Evidence</a>`,
    )
    .join(" ");
  const structures = [
    `<dt>Platform</dt><dd>Windows ${validDownload.architecture}</dd>`,
    `<dt>Archive</dt><dd>${validDownload.archiveFormat.toUpperCase()}</dd>`,
    `<h3 id="install-heading">Install and compatibility</h3><p>${validDownload.installation}</p><p>${validDownload.compatibility}</p>`,
    `<h3 id="license-heading">License boundary</h3><p>Classic software is licensed under <strong>${validDownload.softwareLicense}</strong>. ${validDownload.bundledAssetsLicense}</p>`,
  ];
  const html = `${evidence.join(" ")} ${structures.join(" ")} ${links}`;
  const catalog = { schemaVersion: 2, entries: [validDownload] };
  assert.doesNotThrow(() => validateDownloadsPresentation(html, catalog));
  assert.throws(
    () =>
      validateDownloadsPresentation(
        html.replaceAll(validDownload.compatibility, ""),
        catalog,
      ),
    /omits catalog evidence/u,
  );
  assert.throws(
    () =>
      validateDownloadsPresentation(
        html.replace(
          `<a class="button button--primary" href="${validDownload.url}">`,
          `<span data-url="${validDownload.url}">`,
        ),
        catalog,
      ),
    /catalog link/u,
  );
  assert.throws(
    () =>
      validateDownloadsPresentation(
        html.replace(structures[0], "Windows x86_64"),
        catalog,
      ),
    /misplaces catalog evidence/u,
  );
});

test("the actual Astro components build the empty-catalog fallback", async () => {
  const output = await mkdtemp(join(tmpdir(), "atrinik-empty-download-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/astro/bin/astro.mjs"),
        "--root",
        resolve(root, "tools/fixtures/download-empty-site"),
        "build",
        "--outDir",
        output,
        "--silent",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ASTRO_TELEMETRY_DISABLED: "1",
          ASTRO_TEST_CACHE_DIR: resolve(output, "cache"),
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const html = await readFile(resolve(output, "index.html"), "utf8");
    assert.doesNotThrow(() =>
      validateDownloadsPresentation(html, emptyDownloadCatalog),
    );
  } finally {
    await rm(resolve(root, "tools/fixtures/download-empty-site/.astro"), {
      recursive: true,
      force: true,
    });
    await rm(output, { recursive: true, force: true });
  }
});

test("media records require complete provenance and safe paths", () => {
  assert.doesNotThrow(() => validateMedia(validMedia));
  assert.throws(
    () => validateMedia({ ...validMedia, sourcePath: "../escape.png" }),
    /unsafe media source/u,
  );
  assert.throws(
    () =>
      validateMedia({
        ...validMedia,
        sourceRepository: "atrinik/resources",
      }),
    /unsafe media source/u,
  );
  assert.throws(
    () =>
      validateMedia({
        ...validMedia,
        publicPath: "/media/licensed.00000000.webp",
      }),
    /published digest/u,
  );
  assert.throws(
    () => validateMedia({ ...validMedia, alt: "   " }),
    /media alt/u,
  );
  assert.throws(
    () => validateMedia({ ...validMedia, license: "Made-up-license" }),
    /media license/u,
  );
  assert.throws(
    () => validateMedia({ ...validMedia, transformations: [] }),
    /transformations/u,
  );
});

test("icon records require closed local SVG provenance", () => {
  assert.doesNotThrow(() => validateIcon(validIcon));
  assert.throws(
    () => validateIcon({ ...validIcon, publicPath: "/remote.svg" }),
    /icon identity/u,
  );
  assert.throws(
    () => validateIcon({ ...validIcon, publishedSha256: "4".repeat(64) }),
    /icon digest/u,
  );
  assert.throws(
    () => validateIcon({ ...validIcon, width: 32 }),
    /icon dimensions/u,
  );
});

test("page metadata stays complete, consistent, and safely inert", () => {
  assert.deepEqual(
    validatePageMetadata(completeMetadataShell, {
      canonicalUrl: "https://atrinik.org/about/",
    }),
    {
      title: "About Atrinik",
      description: "A useful description",
      canonicalUrl: "https://atrinik.org/about/",
    },
  );
  assert.throws(
    () =>
      validatePageMetadata(
        completeMetadataShell.replace(
          '<meta name="twitter:title" content="About Atrinik">',
          '<meta name="twitter:title" content="Different">',
        ),
        { canonicalUrl: "https://atrinik.org/about/" },
      ),
    /inconsistent/u,
  );
  assert.throws(
    () =>
      validatePageMetadata(
        completeMetadataShell.replace(
          "</head>",
          '<script src="/app.js"></script></head>',
        ),
        { canonicalUrl: "https://atrinik.org/about/" },
      ),
    /script block/u,
  );
  const noindex =
    '<html><head><title>Not found</title><meta name="description" content="Missing"><meta name="robots" content="noindex, nofollow"></head></html>';
  assert.doesNotThrow(() => validatePageMetadata(noindex));
  assert.throws(
    () => validatePageMetadata(`${noindex}<script>alert(1)</script>`),
    /script block/u,
  );
});

test("same-repository media binds source bytes and Git blob object", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-source-test-"));
  context.after(async () => rm(root, { recursive: true }));
  const sourcePath = join(root, "artwork/originals/licensed.png");
  await mkdir(join(root, "artwork/originals"), { recursive: true });
  const content = Buffer.from("licensed source fixture");
  await writeFile(sourcePath, content);
  const record = {
    ...validMedia,
    sourcePath: "artwork/originals/licensed.png",
    sourceRevision: gitBlobObjectId(content),
    sourceSha256: await digest(sourcePath),
  };
  await assert.doesNotReject(validateLocalMediaSource(root, record));
  await assert.rejects(
    validateLocalMediaSource(root, {
      ...record,
      sourceSha256: "0".repeat(64),
    }),
    /source digest/u,
  );
  await assert.rejects(
    validateLocalMediaSource(root, {
      ...record,
      sourceRevision: "0".repeat(40),
    }),
    /source object/u,
  );
  await assert.rejects(
    validateLocalMediaSource(root, {
      ...record,
      sourcePath: "../licensed.png",
    }),
    /unsafe media source/u,
  );
});

test("source validation rejects an intermediate symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-link-test-"));
  const outside = await mkdtemp(
    join(tmpdir(), "atrinik-website-outside-test-"),
  );
  context.after(async () => {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  });
  const content = Buffer.from("outside source fixture");
  await writeFile(join(outside, "licensed.png"), content);
  try {
    await symlink(
      outside,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (new Set(["EACCES", "ENOSYS", "EPERM"]).has(error.code)) {
      context.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    validateLocalMediaSource(root, {
      ...validMedia,
      sourcePath: "linked/licensed.png",
      sourceRevision: gitBlobObjectId(content),
      sourceSha256: createHash("sha256").update(content).digest("hex"),
    }),
    /symbolic link|escaped repository/u,
  );
});

test("source validation rejects a final file symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-file-link-test-"));
  const outside = await mkdtemp(
    join(tmpdir(), "atrinik-website-file-target-test-"),
  );
  context.after(async () => {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  });
  const content = Buffer.from("outside file fixture");
  const outsideFile = join(outside, "licensed.png");
  await writeFile(outsideFile, content);
  try {
    await symlink(outsideFile, join(root, "linked.png"), "file");
  } catch (error) {
    if (new Set(["EACCES", "ENOSYS", "EPERM"]).has(error.code)) {
      context.skip(`file symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    validateLocalMediaSource(root, {
      ...validMedia,
      sourcePath: "linked.png",
      sourceRevision: gitBlobObjectId(content),
      sourceSha256: createHash("sha256").update(content).digest("hex"),
    }),
    /symbolic link/u,
  );
});

test("WebP dimensions are read from each supported bitstream header", () => {
  for (const content of [
    vp8Fixture(640, 480),
    vp8lFixture(640, 480),
    vp8xFixture(640, 480),
  ])
    assert.deepEqual(readWebpDimensions(content), {
      width: 640,
      height: 480,
    });
  assert.throws(() => readWebpDimensions(Buffer.alloc(30)), /WebP/u);
});

test("presentation CSS preserves image geometry and avoids costly paint effects", () => {
  assert.doesNotThrow(() =>
    validatePresentationCss("img{display:block;height:auto;max-width:100%}"),
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{max-width:100%}.chronicle-card img{width:100%;object-fit:cover}",
      ),
    /height: auto/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}.chronicle-card img{object-fit:cover}",
      ),
    /cropping/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}.site-header{backdrop-filter:blur(1rem)}",
      ),
    /paint effect/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}.hero-art:before{filter:blur(5rem)}",
      ),
    /paint effect/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}body::before{position:fixed;inset:0;background:red}",
      ),
    /fixed viewport/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}body::before{position:fixed;inset:0px}",
      ),
    /fixed viewport/u,
  );
  assert.throws(
    () =>
      validatePresentationCss(
        "img{height:auto}body:before{top:0;position:fixed;left:0}",
      ),
    /fixed viewport/u,
  );
});

test("established redirects are explicit and complete", () => {
  const valid = [
    "/page/installing_atrinik_client* /downloads/ 301",
    "/page/how_to_play* /downloads/ 301",
    "/page/starter_guide* /downloads/ 301",
    "/page/player_guide* /downloads/ 301",
    "/page/servers_list* /downloads/ 301",
    "/page/development_join* /about/ 301",
    "/page/development* /about/ 301",
    "/page/team* /about/ 301",
  ].join("\n");
  assert.doesNotThrow(() => validateRedirects(valid));
  assert.throws(
    () => validateRedirects(valid.replace("/page/team*", "/*")),
    /established redirect/u,
  );
  assert.throws(
    () => validateRedirects(valid.split("\n").slice(1).join("\n")),
    /incomplete/u,
  );
});

test("static output requires intrinsic image dimensions", async (context) => {
  const root = await mkdtemp(
    join(tmpdir(), "atrinik-website-image-layout-test-"),
  );
  context.after(async () => rm(root, { recursive: true }));
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '<img src="/poster.webp" width="1120" height="630" alt="Poster"></main>',
    ),
  );
  await writeFile(join(root, "style.css"), "img{height:auto;max-width:100%}");
  const poster = vp8xFixture(1120, 630);
  await writeFile(join(root, "poster.webp"), poster);
  const options = {
    allowedMedia: new Map([
      ["/poster.webp", { alt: "Poster", width: 1120, height: 630 }],
    ]),
  };
  assert.equal((await validateDist(root, options)).images, poster.length);

  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '<img src="/poster.webp" width="1120" alt="Poster"></main>',
    ),
  );
  await assert.rejects(validateDist(root, options), /intrinsic dimensions/u);

  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '<img src="/poster.webp" width="1120" height="630" alt="Wrong"></main>',
    ),
  );
  await assert.rejects(validateDist(root, options), /media record/u);

  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '<img src="/poster.webp" width="1120" height="630" alt="Poster"></main>',
    ),
  );
  await writeFile(join(root, "poster.webp"), vp8xFixture(1119, 630));
  await assert.rejects(
    validateDist(root, options),
    /published media dimensions/u,
  );
  await writeFile(join(root, "poster.webp"), poster);
  await assert.rejects(
    validateDist(root, {
      allowedMedia: new Map([
        ...options.allowedMedia,
        ["/missing.webp", { alt: "Missing", width: 1, height: 1 }],
      ]),
    }),
    /proven media records/u,
  );
});

test("static output rejects scripts, broken links, and excessive files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-test-"));
  context.after(async () => rm(root, { recursive: true }));
  await mkdir(join(root, "about"));
  await writeFile(join(root, "index.html"), accessibleShell);
  await writeFile(join(root, "about/index.html"), accessibleShell);
  assert.equal((await validateDist(root)).javascript, 0);
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '<a href="https://tracker.example/">bad</a></main>',
    ),
  );
  await assert.rejects(validateDist(root), /external link origin/u);
  const releaseNotes = "https://github.com/atrinik/classic/releases/tag/v1.2.3";
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      `<a href="${releaseNotes}">unrecorded release</a></main>`,
    ),
  );
  await assert.rejects(validateDist(root), /unrecorded release link/u);
  await assert.doesNotReject(
    validateDist(root, { allowedReleaseUrls: new Set([releaseNotes]) }),
  );
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace("</main>", "<h1>Duplicate</h1></main>"),
  );
  await assert.rejects(validateDist(root), /exactly one h1/u);
  await writeFile(join(root, "index.html"), accessibleShell);
  await writeFile(join(root, "bad.js"), "alert(1)");
  await assert.rejects(validateDist(root), /performance budget/u);
});

test("static output counts and bounds raster image bytes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "atrinik-website-images-test-"));
  context.after(async () => rm(root, { recursive: true }));
  await writeFile(join(root, "index.html"), accessibleShell);

  for (const extension of ["webp", "avif", "png", "jpg", "jpeg"]) {
    const path = join(root, `unproven.${extension}`);
    await writeFile(path, Buffer.alloc(limits.imageBytes));
    await assert.rejects(validateDist(root), /proven media records/u);
    await writeFile(path, Buffer.alloc(limits.imageBytes + 1));
    await assert.rejects(validateDist(root), /performance budget/u);
    await rm(path);
  }

  const path = join(root, "image.webp");
  await writeFile(path, vp8xFixture(1, 1, limits.imageBytes));
  const options = {
    allowedMedia: new Map([
      ["/image.webp", { alt: "Budget fixture", width: 1, height: 1 }],
    ]),
  };
  const result = await validateDist(root, options);
  assert.equal(result.images, limits.imageBytes);

  await writeFile(path, vp8xFixture(1, 1, limits.imageBytes + 1));
  await assert.rejects(validateDist(root, options), /performance budget/u);
});
