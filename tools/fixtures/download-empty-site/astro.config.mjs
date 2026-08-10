import { defineConfig } from "astro/config";

if (!process.env.ASTRO_TEST_CACHE_DIR)
  throw new Error("ASTRO_TEST_CACHE_DIR is required for the fixture build");

export default defineConfig({
  cacheDir: process.env.ASTRO_TEST_CACHE_DIR,
  output: "static",
});
