import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  limits,
  validateDist,
  validateDownload,
  validateMedia,
} from "./site-contract.mjs";

const accessibleShell =
  '<!doctype html><html lang="en"><head><title>Title</title><meta name="description" content="Description"><link rel="canonical" href="https://atrinik.org/"></head><body><a href="#content">Skip</a><nav aria-label="Primary navigation"></nav><main id="content"><h1>Title</h1></main></body></html>';

const validDownload = {
  component: "client",
  version: "1.2.3",
  tag: "v1.2.3",
  revision: "0".repeat(40),
  platform: "linux",
  architecture: "x86_64",
  artifact: "client.tar.gz",
  bytes: 10,
  sha256: "1".repeat(64),
  url: "https://github.com/atrinik/client/releases/download/v1.2.3/client.tar.gz",
  license: "MIT",
  compatibility: "Game Protocol 1",
};

test("download coordinates are closed and immutable", () => {
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
});

test("media records require complete provenance and safe paths", () => {
  const valid = {
    id: "licensed-image",
    publicPath: "/media/licensed.png",
    sourceRepository: "atrinik/resources",
    sourcePath: "paintings/licensed.png",
    sourceRevision: "2".repeat(40),
    sourceSha256: "3".repeat(64),
    publishedSha256: "4".repeat(64),
    author: "Example Author",
    license: "CC-BY-4.0",
    transformations: ["lossless metadata removal"],
    alt: "A described fixture",
    notice: "Copyright Example Author",
  };
  assert.doesNotThrow(() => validateMedia(valid));
  assert.throws(
    () => validateMedia({ ...valid, publicPath: "/media/../escape.png" }),
    /unsafe/u,
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

  const extensions = ["webp", "avif", "png", "jpg", "jpeg"];
  for (const extension of extensions)
    await writeFile(join(root, `image.${extension}`), Buffer.alloc(1));

  const boundedWebpBytes = limits.imageBytes - extensions.length + 1;
  await writeFile(join(root, "image.webp"), Buffer.alloc(boundedWebpBytes));
  const result = await validateDist(root);
  assert.equal(result.images, limits.imageBytes);

  await writeFile(join(root, "image.webp"), Buffer.alloc(boundedWebpBytes + 1));
  await assert.rejects(validateDist(root), /performance budget/u);
});
