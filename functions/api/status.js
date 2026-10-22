// @ts-check
// Cloudflare Pages Function: whitelisted official Classic server status.
import { handleStatus } from "../../server/handlers.js";

/** @param {import("../../server/handlers.js").PagesContext} context */
export const onRequest = (context) => handleStatus(context);
