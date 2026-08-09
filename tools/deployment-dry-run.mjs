import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, validateDist } from "./site-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const contract = await readJson(
  resolve(root, "deployment/cloudflare-pages.json"),
);
if (
  contract.provider !== "cloudflare-pages" ||
  contract.project !== "atrinik-website" ||
  contract.productionBranch !== "main" ||
  contract.buildCommand !== "npm ci && npm run build" ||
  contract.outputDirectory !== "dist"
)
  throw new Error("Cloudflare Pages deployment contract drift");
if (
  contract.functions !== false ||
  contract.analytics !== false ||
  contract.secrets.length !== 0
)
  throw new Error(
    "static deployment gained an unreviewed dynamic/privacy boundary",
  );
if (
  contract.productionDomain !== "atrinik.org" ||
  contract.previewAccess !== "team-only-until-reviewed"
)
  throw new Error("deployment environment boundary drift");
const headers = await readFile(resolve(root, "dist/_headers"), "utf8");
if (!headers.includes("Content-Security-Policy:"))
  throw new Error("built deployment lacks security headers");
const downloads = await readJson(resolve(root, "src/data/downloads.json"));
const media = await readJson(resolve(root, "src/data/media.json"));
const result = await validateDist(resolve(root, "dist"), {
  allowedMedia: new Map(
    media.entries.map((record) => [record.publicPath, record]),
  ),
  allowedReleaseUrls: new Set(downloads.entries.map((record) => record.url)),
});
console.log(
  `deployment dry-run valid for ${contract.project}: ${JSON.stringify(result)}`,
);
