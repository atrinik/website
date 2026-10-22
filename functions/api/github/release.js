// @ts-check
// Cloudflare Pages Function: signed atrinik/classic release notifications.
import { handleGithubRelease } from "../../../server/handlers.js";

/** @param {import("../../../server/handlers.js").PagesContext} context */
export const onRequest = (context) => handleGithubRelease(context);
