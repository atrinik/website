# Static website architecture

Astro compiles typed local data and `.astro` templates to static HTML and CSS.
No browser JavaScript or server runtime is emitted by the build. The only
permitted `script` element is inert `type="application/ld+json"` data generated
locally with `<`, `>`, `&`, and JavaScript line separators escaped before raw
HTML insertion. `src/data` is the schema-validated catalog input, the typed
metadata factory owns page identity, and `.astro` templates contain authored
page prose. Closed validators reject unknown download/media/icon fields and
unsafe coordinates before rendering. Cloudflare can transform a deployed
response after this build boundary; provider-injected security or performance
code is not part of `dist/` and is audited separately.

Every indexable page supplies an explicit metadata object with a unique title,
description, canonical route, index policy, and matched Open Graph/Twitter
identity. Social images resolve only through `src/data/media.json`, including
their canonical local URL, dimensions, and alternative text. The temporary
`atrinik-now` concept image is the explicit sitewide fallback pending issue #22;
pages may choose a more relevant proven catalog record. The homepage alone owns
the canonical `WebSite` JSON-LD record for `https://atrinik.org/` and its two
verified Atrinik GitHub identities. The 404 emits no canonical, preview, or
structured identity and retains `noindex, nofollow`.

Downloads remain in their owning GitHub releases. Catalog schema version 2
separates the release repository from the artifact's logical role and marks at
most one deliberately reviewed primary artifact. A record binds its semantic
version/tag, 40-character source revision, publication and review times,
immutable/attested release state, asset count, platform, architecture, archive format, filename, byte size,
SHA-256, exact versioned artifact/evidence URLs, software and bundled-asset
license boundaries, compatibility, and installation guidance. Draft,
prerelease, zero-asset, mutable, incomplete, duplicate, or unsupported primary
records fail source validation. An empty catalog remains valid and renders the
release-page fallback without a direct download.

The catalog is checked-in review evidence, not release discovery. Builds do not
query GitHub, sort tags, follow `latest`, scrape release pages, or synthesize
filenames. A newer tag therefore cannot displace the selected artifact until a
reviewed catalog change updates every immutable coordinate together. Built
output permits direct release links only when the exact URLs occur in the
validated record.

Media stays absent until a record binds both source and published digests,
repository/path, a durable Git blob object ID, published dimensions, author,
exact license, transformations, alt text, and notice. Same-repository sources
are digest-checked from a traversal-safe path. The website never imports an
asset tree by implication.

The two SVG site icons use a separate closed catalog because they are
repository-native vector interface artwork rather than page media. Each record
binds the exact checked-in source/published bytes to a Git blob object ID and
SHA-256, 64×64 view box, author, MIT license, transformation, purpose, and
notice. Source validation rejects SVG scripts, event attributes, and external
references; built pages must link both canonical local files.

The executable validator checks the JSON Schema's locally expressible field
sets, patterns, formats, bounds, constants, primary-artifact restrictions, and
archive suffix rules on every run, without adding a general-purpose runtime
schema dependency. Cross-field identity rules remain executable-only: the tag
must equal the version, evidence URLs must share the record's repository and
tag, the artifact URL and suffix must match its filename and format, review
cannot precede publication, and the primary filename and SBOM name must match
the reviewed Classic release. Tests exercise valid and adversarial forms and
contract changes must update both representations and their fixtures together.

`public/_headers` supplies a no-script CSP and browser hardening for every
static response. Inert JSON-LD does not relax `script-src 'none'`. The
built-output validator rejects every other script element or script attribute,
parses the JSON-LD, compares it with visible metadata and canonical identity,
and additionally enforces at most 16
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

The zero-JavaScript budget covers repository output. Cloudflare may inject
bot/security JavaScript or a dashboard-managed Web Analytics beacon, set
strictly necessary cookies, or serve a challenge with its own HTML, scripts,
cookies, and CSP. Ordinary deployed pages retain `script-src 'none'`, which
blocks injected scripts. Public privacy language therefore distinguishes the
static artifact from this provider edge boundary.

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
The same edge may inject provider code based on hostname, request, or dashboard
state, so a clean static artifact does not prove that every delivered response
is script-, cookie-, or analytics-free.
