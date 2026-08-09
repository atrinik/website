# Static website architecture

Astro compiles typed local data and `.astro` templates to static HTML and CSS.
No browser JavaScript or server runtime is emitted. `src/data` is the only
published content input; closed validators reject unknown download/media
fields and unsafe coordinates before rendering.

Downloads remain in their owning GitHub releases. A website record must bind
the component, semantic version/tag, 40-character source revision, platform,
architecture, artifact filename/size/SHA-256, exact release URL, license, and
compatibility. Missing or contradictory records render as unavailable.

Media stays absent until a record binds both source and published digests,
repository/path, a durable Git blob object ID, published dimensions, author,
exact license, transformations, alt text, and notice. Same-repository sources
are digest-checked from a traversal-safe path. The website never imports an
asset tree by implication.

The executable validator intentionally mirrors only the closed required-field
sets and bounds from the two JSON Schemas so the build does not acquire a
general-purpose runtime schema dependency. Source validation compares their
field sets and closed-object flags on every run; contract changes must update
both forms and their fixtures together.

`public/_headers` supplies a no-script CSP and browser hardening for every
static response. The built-output validator additionally enforces at most 16
generated files, 900,000 bytes total, 140,000 aggregate HTML bytes, 40,000
aggregate CSS bytes, 700,000 aggregate raster image bytes, and zero JavaScript.
Published image filenames are content-addressed for immutable caching, and
images below the fold are lazy-loaded. Artwork uses its intrinsic aspect ratio
and an automatic rendered height so neither the portrait hero nor landscape
posters are cropped. The presentation avoids fixed decorative texture layers,
backdrop filters, large CSS blur filters, and image filter/transform effects so
scrolling does not continuously repaint those effects. Accessibility
validation covers language, landmarks, skip navigation, primary navigation
labelling, one page heading, useful image alternatives, focus visibility,
reflow, and reduced-motion policy; manual assistive-technology review remains
a release gate.

## Deployment topology

One Git-integrated Cloudflare Pages project serves every environment. The
`main` deployment owns canonical `atrinik.org`, and a Cloudflare permanent
redirect maps `www.atrinik.org` to the apex without changing path or query.
Every non-production branch uses Cloudflare's native `pages.dev` preview; there
are no custom preview domains or direct uploads.

Cloudflare's GitHub integration builds same-repository pull requests and posts
the preview link without a repository workflow or API credential. Each commit
has an immutable provider URL, while the normalized branch alias follows the
latest deployment for that branch. Fork pull requests do not receive a Pages
preview. These provider URLs are public and Cloudflare adds
`X-Robots-Tag: noindex`; an immutable deployment URL may remain reachable after
the branch or pull request closes.

Repository `_headers` therefore contains production-safe security and cache
rules only. It must not add a global noindex response: Cloudflare owns the
preview-only indexing header at the edge while production stays indexable.
