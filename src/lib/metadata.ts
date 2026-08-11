import media from "../data/media.json";
import site from "../data/site.json";

export type RobotsPolicy = "index, follow" | "noindex, nofollow";
export type OpenGraphType = "website";
export type TwitterCard = "summary_large_image";

export interface SocialImageMetadata {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface PageMetadata {
  title: string;
  description: string;
  robots: RobotsPolicy;
  canonicalUrl?: string;
  openGraph?: {
    type: OpenGraphType;
    title: string;
    description: string;
    url: string;
    image: SocialImageMetadata;
  };
  twitter?: {
    card: TwitterCard;
    title: string;
    description: string;
    image: SocialImageMetadata;
  };
  structuredData?: JsonLdValue[];
}

type JsonLdScalar = string | number | boolean | null;
export type JsonLdValue =
  JsonLdScalar | JsonLdValue[] | { [key: string]: JsonLdValue };

interface IndexablePageInput {
  title: string;
  description: string;
  canonicalPath: `/${string}`;
  socialImageId?: string;
  structuredData?: JsonLdValue[];
}

interface NoindexPageInput {
  title: string;
  description: string;
}

// This generated concept image is the explicit sitewide preview fallback until
// issue #22 supplies provenance-cleared human-created preview artwork.
export const SOCIAL_IMAGE_FALLBACK_ID = "atrinik-now";

function socialImage(id: string): SocialImageMetadata {
  const record = media.entries.find((entry) => entry.id === id);
  if (!record) throw new Error(`missing social media record: ${id}`);
  return {
    url: new URL(record.publicPath, site.canonicalOrigin).href,
    width: record.width,
    height: record.height,
    alt: `Temporary OpenAI-generated website concept artwork: ${record.alt}`,
  };
}

export function indexablePage({
  title,
  description,
  canonicalPath,
  socialImageId = SOCIAL_IMAGE_FALLBACK_ID,
  structuredData,
}: IndexablePageInput): PageMetadata {
  const canonicalUrl = new URL(canonicalPath, site.canonicalOrigin).href;
  const image = socialImage(socialImageId);
  return {
    title,
    description,
    robots: "index, follow",
    canonicalUrl,
    openGraph: {
      type: "website",
      title,
      description,
      url: canonicalUrl,
      image,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      image,
    },
    ...(structuredData ? { structuredData } : {}),
  };
}

export function noindexPage({
  title,
  description,
}: NoindexPageInput): PageMetadata {
  return { title, description, robots: "noindex, nofollow" };
}

export function websiteIdentity(): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://atrinik.org/#website",
    url: "https://atrinik.org/",
    name: site.title,
    description: site.description,
    sameAs: [
      "https://github.com/atrinik",
      "https://github.com/atrinik/website",
    ],
  };
}

export function serializeJsonLd(value: JsonLdValue): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
