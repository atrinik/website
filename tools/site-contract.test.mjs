import assert from "node:assert/strict";
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
import {
  functionRoutes,
  limits,
  digest,
  gitBlobObjectId,
  parseInertJsonLd,
  readWebpDimensions,
  validateDependencyPolicy,
  validateClientScript,
  validateDist,
  validateDownloadsPresentation,
  validateFunctionsTree,
  validateIcon,
  validateIconCatalog,
  validateHomepagePhraseSet,
  validateHomepagePresentation,
  validateLocalMediaSource,
  validateMedia,
  validatePageMetadata,
  validatePresentationCss,
  validatePublicCopy,
  validateRedirects,
  validateRoutes,
  validateSvgIconSource,
} from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");

const accessibleShell =
  '<!doctype html><html lang="en"><head><title>Title</title><meta name="description" content="Description"><link rel="canonical" href="https://atrinik.org/"><meta property="og:title" content="Title"><meta property="og:description" content="Description"><meta property="og:image" content="https://atrinik.org/media/social.00000000.webp"><meta name="twitter:card" content="summary_large_image"></head><body><a href="#content">Skip</a><nav aria-label="Primary navigation"></nav><main id="content"><h1>Title</h1></main></body></html>';

const completeMetadataShell =
  '<!doctype html><html lang="en"><head><title>About Atrinik</title><meta name="description" content="A useful description"><meta name="robots" content="index, follow"><link rel="canonical" href="https://atrinik.org/about/"><meta property="og:type" content="website"><meta property="og:title" content="About Atrinik"><meta property="og:description" content="A useful description"><meta property="og:url" content="https://atrinik.org/about/"><meta property="og:image" content="https://atrinik.org/media/social.00000000.webp"><meta property="og:image:alt" content="A useful social image alternative"><meta property="og:image:width" content="1120"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="About Atrinik"><meta name="twitter:description" content="A useful description"><meta name="twitter:image" content="https://atrinik.org/media/social.00000000.webp"><meta name="twitter:image:alt" content="A useful social image alternative"></head><body></body></html>';

const allowedSocialMedia = new Map([
  [
    "/media/social.00000000.webp",
    {
      width: 1120,
      height: 630,
      alt: "A useful social image alternative",
      author: "Example Human",
    },
  ],
]);

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

const homepage = {
  description:
    "Atrinik is a free, open-source online role-playing game. Download Atrinik Classic for Windows; the replacement remains in development.",
  eyebrow: "Free, open-source online role-playing game",
  heading: "Atrinik is a cooperative fantasy game.",
  introduction:
    "Explore Atrinik’s isometric islands, ruins, and crystal-lit mysteries with other players. The maintained Classic release is available for Windows; the replacement game remains in development.",
  primaryAction: "Download Atrinik Classic",
  title: "Free, open-source online role-playing game",
};

const homepageHtml = `<title>${homepage.title} · Atrinik</title><meta name="description" content="${homepage.description}"><meta property="og:title" content="${homepage.title} · Atrinik"><meta property="og:description" content="${homepage.description}"><meta name="twitter:title" content="${homepage.title} · Atrinik"><meta name="twitter:description" content="${homepage.description}"><h1 id="hero-title">${homepage.heading}</h1><p class="eyebrow">${homepage.eyebrow}</p><p class="hero-lede">${homepage.introduction}</p><a class="button button--primary" href="/downloads/">${homepage.primaryAction} <span aria-hidden="true">→</span></a>`;

// Removes the fixture's module script element so the validator must notice
// it is missing. This builds a negative fixture; it is not a sanitizer.
const withoutModuleScript = (html) => {
  const start = html.indexOf("<script");
  const end = html.indexOf("</script>", start);
  assert.ok(start !== -1 && end !== -1, "fixture has a module script");
  return html.slice(0, start) + html.slice(end + "</script>".length);
};

test("homepage phrase set stays structurally aligned", () => {
  assert.doesNotThrow(() => validateHomepagePhraseSet(homepage));
  assert.doesNotThrow(() =>
    validateHomepagePresentation(homepageHtml, homepage, "Atrinik"),
  );
  for (const drift of [
    homepageHtml.replace('name="description"', 'name="summary"'),
    homepageHtml.replace('property="og:description"', 'property="og:summary"'),
    homepageHtml.replace(
      'name="twitter:description"',
      'name="twitter:summary"',
    ),
    homepageHtml.replace('id="hero-title"', 'id="other-title"'),
    homepageHtml.replace('href="/downloads/"', 'href="/about/"'),
  ])
    assert.throws(
      () => validateHomepagePresentation(drift, homepage, "Atrinik"),
      /homepage|description|primary|H1/u,
    );
  assert.throws(
    () =>
      validateHomepagePhraseSet({
        ...homepage,
        description: "x".repeat(161),
      }),
    /phrase set/u,
  );
});

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

const downloadsFallbackHtml = `<a class="button button--primary" href="https://github.com/atrinik/classic/releases/latest">Download from GitHub</a><code>windows-x86_64.zip</code><code>linux-x86_64.AppImage</code> glibc 2.39 <div data-classic-release></div><p class="server-status" data-server-status aria-live="polite"></p><script type="module" src="/assets/ServerStatus.abc123.js"></script>`;

test("the downloads page keeps a complete static fallback", () => {
  assert.doesNotThrow(() =>
    validateDownloadsPresentation(downloadsFallbackHtml),
  );
  for (const changed of [
    downloadsFallbackHtml.replace("/releases/latest", "/releases"),
    downloadsFallbackHtml.replace("glibc 2.39", ""),
    downloadsFallbackHtml.replace("<div data-classic-release></div>", ""),
    downloadsFallbackHtml.replace(' aria-live="polite"', ""),
    withoutModuleScript(downloadsFallbackHtml),
    `${downloadsFallbackHtml}<a href="https://github.com/atrinik/classic/releases/download/v1.2.3/guessed.zip">x</a>`,
    `${downloadsFallbackHtml}<a href="https://github.com/atrinik/classic/releases/tag/v1.2.3">x</a>`,
  ])
    assert.throws(
      () => validateDownloadsPresentation(changed),
      /static Classic fallback/u,
    );
});

test("Pages Functions are limited to the reviewed /api routes", async (context) => {
  assert.doesNotThrow(() =>
    validateRoutes('{"version":1,"include":["/api/*"],"exclude":[]}'),
  );
  for (const routes of [
    '{"version":1,"include":["/*"],"exclude":[]}',
    '{"version":1,"include":["/api/*","/downloads/*"],"exclude":[]}',
    '{"version":1,"include":["/api/*"],"exclude":[],"extra":1}',
    "not json",
  ])
    assert.throws(() => validateRoutes(routes), /Pages/u);

  await assert.doesNotReject(validateFunctionsTree(root));
  const temporary = await mkdtemp(join(tmpdir(), "atrinik-functions-test-"));
  context.after(async () => rm(temporary, { recursive: true }));
  for (const path of functionRoutes) {
    await mkdir(join(temporary, path, ".."), { recursive: true });
    await writeFile(
      join(temporary, path),
      "export const onRequest = () => {};",
    );
  }
  await assert.doesNotReject(validateFunctionsTree(temporary));
  await writeFile(join(temporary, "functions/_middleware.js"), "");
  await assert.rejects(
    validateFunctionsTree(temporary),
    /reviewed \/api routes/u,
  );
});

test("client scripts are limited to reviewed same-origin capabilities", () => {
  assert.doesNotThrow(() =>
    validateClientScript(
      'const a="https://github.com/atrinik/classic/releases";fetch("/api/status");fetch("/api/downloads/classic");node.textContent=x;',
    ),
  );
  for (const source of [
    "node.innerHTML=x",
    "node.insertAdjacentHTML('beforeend',x)",
    "document.cookie='a=b'",
    "localStorage.setItem('a','b')",
    "eval(x)",
    "new Function(x)",
    "import('/x.js')",
    "navigator.sendBeacon('/x')",
    'fetch("https://tracker.example/")',
    'fetch("/api/other")',
  ])
    assert.throws(() => validateClientScript(source), /client script/u);
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
  assert.doesNotThrow(() =>
    validateIconCatalog([
      validIcon,
      {
        ...validIcon,
        id: "atrinik-mask-icon",
        publicPath: "/mask-icon.svg",
        sourcePath: "public/mask-icon.svg",
      },
    ]),
  );
  assert.throws(
    () => validateIconCatalog([validIcon, { ...validIcon }]),
    /unique and complete/u,
  );
  assert.throws(
    () => validateIcon({ ...validIcon, author: "a".repeat(201) }),
    /icon author/u,
  );
  assert.doesNotThrow(() =>
    validateSvgIconSource('<svg viewBox="0 0 64 64"><path d="M0 0"/></svg>'),
  );
  assert.throws(
    () =>
      validateSvgIconSource(
        '<svg viewBox="0 0 64 64" onload = "alert(1)"></svg>',
      ),
    /unsafe icon/u,
  );
  assert.throws(
    () =>
      validateSvgIconSource(
        '<svg viewBox="0 0 64 64"/onload= "alert(1)"></svg>',
      ),
    /unsafe icon/u,
  );
  assert.throws(
    () =>
      validateSvgIconSource(
        '<svg viewBox="0 0 64 64"><g id="x"onload="alert(1)"/></svg>',
      ),
    /unsafe icon/u,
  );
  assert.throws(
    () =>
      validateSvgIconSource(
        '<svg viewBox="0 0 64 64"><style>@import url(https://tracker.example/icon.css)</style></svg>',
      ),
    /unsafe icon/u,
  );
});

test("page metadata stays complete, consistent, and safely inert", () => {
  assert.deepEqual(
    validatePageMetadata(completeMetadataShell, {
      canonicalUrl: "https://atrinik.org/about/",
      allowedMedia: allowedSocialMedia,
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
        {
          canonicalUrl: "https://atrinik.org/about/",
          allowedMedia: allowedSocialMedia,
        },
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
        {
          canonicalUrl: "https://atrinik.org/about/",
          allowedMedia: allowedSocialMedia,
        },
      ),
    /script block/u,
  );
  const noindex =
    '<html><head><title>Not found</title><meta name="description" content="Missing"><meta name="robots" content="noindex, nofollow"></head></html>';
  assert.doesNotThrow(() => validatePageMetadata(noindex));
  assert.throws(
    () =>
      validatePageMetadata(
        completeMetadataShell.replace('content="1120"', 'content="1119"'),
        {
          canonicalUrl: "https://atrinik.org/about/",
          allowedMedia: allowedSocialMedia,
        },
      ),
    /inconsistent/u,
  );
  assert.throws(
    () => validatePageMetadata(`${noindex}<script>alert(1)</script>`),
    /script block/u,
  );
  assert.deepEqual(
    parseInertJsonLd(
      '<script type="application/ld+json">{"text":"\\u003c/script\\u003e"}</script>',
    ),
    [{ text: "</script>" }],
  );
  assert.throws(
    () =>
      parseInertJsonLd(
        '<script type="application/ld+json">{"text":"</script>"}</script>',
      ),
    /safely serialized|valid JSON|script/u,
  );
  assert.deepEqual(
    parseInertJsonLd(
      '<script type="application/ld+json">{"safe":true}</script >',
    ),
    [{ safe: true }],
  );
  assert.deepEqual(
    parseInertJsonLd(
      '<SCRIPT type="application/ld+json">{"safe":true}</ScRiPt>',
    ),
    [{ safe: true }],
  );
  assert.throws(
    () =>
      parseInertJsonLd(
        '<script type="application/ld+json">{"safe":true}</script ignored>',
      ),
    /malformed/u,
  );
  assert.throws(
    () => parseInertJsonLd("</script><p>stray closing tag</p>"),
    /malformed/u,
  );
  assert.throws(() => parseInertJsonLd("<script/>alert(1)"), /script/u);
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
      '<a href="https://zoeysr.com/">Zoey Rose</a></main>',
    ),
  );
  await assert.doesNotReject(validateDist(root));
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
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace("<main", '<main onload = "alert(1)"'),
  );
  await assert.rejects(validateDist(root), /event handler/u);
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace("<main", "<main><img/onerror=alert(1)><span"),
  );
  await assert.rejects(validateDist(root), /event handler/u);
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace("<main", '<main id="x"onload=alert(1)'),
  );
  await assert.rejects(validateDist(root), /event handler/u);
  await writeFile(join(root, "index.html"), accessibleShell);
  await writeFile(join(root, "bad.js"), "alert(1)");
  await assert.rejects(validateDist(root), /unexpected script asset/u);
  await rm(join(root, "bad.js"));

  // Exactly the referenced, hashed, same-origin module is allowed.
  await mkdir(join(root, "assets"));
  const moduleTag =
    '<script type="module" src="/assets/live.AbC123_x.js"></script>';
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace("</main>", `</main>${moduleTag}`),
  );
  await writeFile(
    join(root, "assets/live.AbC123_x.js"),
    'fetch("/api/status").then(r=>r.json()).then(j=>{e.textContent=j.a})',
  );
  assert.ok((await validateDist(root)).javascript > 0);
  await writeFile(join(root, "assets/live.AbC123_x.js"), "e.innerHTML=x");
  await assert.rejects(validateDist(root), /forbidden capability/u);
  await writeFile(
    join(root, "assets/live.AbC123_x.js"),
    "x".repeat(limits.javascriptBytes + 1),
  );
  await assert.rejects(validateDist(root), /performance budget/u);
  await writeFile(join(root, "assets/live.AbC123_x.js"), "1");
  await writeFile(join(root, "assets/unused.Zz9.js"), "1");
  await assert.rejects(validateDist(root), /unreferenced/u);
  await rm(join(root, "assets/unused.Zz9.js"));
  for (const tag of [
    '<script type="module" src="https://cdn.example/x.js"></script>',
    '<script type="module" src="/assets/live.AbC123_x.js">alert(1)</script>',
    "<script>alert(1)</script>",
    '<script src="/assets/live.AbC123_x.js"></script>',
    '<script type="module" src="/assets/live.AbC123_x.js" async></script>',
  ]) {
    await writeFile(
      join(root, "index.html"),
      accessibleShell.replace("</main>", `</main>${tag}`),
    );
    await assert.rejects(validateDist(root), /script/u, tag);
  }
  await writeFile(
    join(root, "index.html"),
    accessibleShell.replace(
      "</main>",
      '</main><script type="module" src="/assets/missing.Aa1.js"></script>',
    ),
  );
  await assert.rejects(validateDist(root), /missing|unreferenced/u);
  await writeFile(
    join(root, "_routes.json"),
    '{"version":1,"include":["/*"],"exclude":[]}',
  );
  await writeFile(join(root, "index.html"), accessibleShell);
  await rm(join(root, "assets"), { recursive: true });
  await assert.rejects(validateDist(root), /limited to \/api/u);
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

test("dependency policy accepts npm-managed versions and optional overrides", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const policy = JSON.parse(
    await readFile(resolve(root, "policy/dependencies.json"), "utf8"),
  );
  delete manifest.overrides;
  assert.doesNotThrow(() => validateDependencyPolicy(manifest, policy));
  manifest.overrides = { "example-parent": { "example-child": "^2.0.0" } };
  assert.doesNotThrow(() => validateDependencyPolicy(manifest, policy));
  manifest.devDependencies.astro = "^8.0.0";
  assert.doesNotThrow(() => validateDependencyPolicy(manifest, policy));
});

test("dependency policy still rejects undeclared packages and script approval drift", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const policy = JSON.parse(
    await readFile(resolve(root, "policy/dependencies.json"), "utf8"),
  );
  for (const change of [
    (value) => {
      value.devDependencies["undeclared-package"] = "^1.0.0";
    },
    (value) => {
      delete value.devDependencies.astro;
    },
    (value) => {
      value.allowScripts.fsevents = true;
    },
    (value) => {
      delete value.allowScripts.esbuild;
    },
    (value) => {
      value.allowScripts["unreviewed-script"] = true;
    },
  ]) {
    const changed = structuredClone(manifest);
    change(changed);
    assert.throws(
      () => validateDependencyPolicy(changed, policy),
      /policy.*differ|policy drifted/u,
    );
  }
});

test("public copy omits development tooling", () => {
  assert.doesNotThrow(() =>
    validatePublicCopy(
      "<p>Concept artwork by Zoey Rose. Explore the islands and train your skills.</p>",
    ),
  );
  for (const text of [
    "Built with Codex",
    "made with OpenAI image generation",
    "Claude helped",
    "agentic workflows",
    "Agent-driven software",
    "AI tools",
    "generative art",
    "an A.I. image",
    "trained AIs",
    "an a.i. helper",
    "GenAI art",
    "artificial intelligence",
    "an LLM wrote it",
    "GPT-4 output",
    "DALL·E sketches",
    "Midjourney",
    "GitHub Copilot",
    "Stable Diffusion",
    "Cod&#101;x",
    "Open&#x41;I",
  ])
    assert.throws(() => validatePublicCopy(text), /development tooling/u);
  assert.throws(() => validatePublicCopy(null), /invalid public copy/u);
  assert.throws(
    () => validatePublicCopy("&#1114112;"),
    /invalid character reference/u,
  );
});
