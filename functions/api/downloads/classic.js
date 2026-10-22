// @ts-check
// Cloudflare Pages Function: the selected Classic release record.
import { handleClassicDownload } from "../../../server/handlers.js";

/** @param {import("../../../server/handlers.js").PagesContext} context */
export const onRequest = (context) => handleClassicDownload(context);
