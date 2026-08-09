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
Manual direct uploads use isolated `manual-<prefix>` branches and
`<prefix>.testing.atrinik.org`; eligible non-Dependabot same-repository pull
requests use their Git preview deployment and
`pr.<number>.testing.atrinik.org`. No preview hostname can select the production
branch or domains. Manual upload is restricted to trusted maintainer-controlled
worktrees after credential-free validation, never untrusted pull request code.

The public testing hosts deliberately render the production-canonical static
documents. Absolute host patterns in `_headers` add
`X-Robots-Tag: noindex, nofollow` only under `testing.atrinik.org`; production
remains indexable. The validator binds those header patterns to the deployment
contract so a broad noindex rule fails before upload.

The pull request workflow separates data from authority. Untrusted head ref and
revision values are metadata used to find a successful Pages deployment. The
privileged `pull_request_target` job checks out and executes only the trusted
base/`main` revision, receives read-only GitHub permission, and never consumes
head code, dependencies, caches, or artifacts. Its Cloudflare environment uses
a custom deployment branch policy that allows only `main` with
`protected_branches: false`; it can therefore create or remove the narrowly
validated Pages domain and proxied DNS record without giving pull request
content a credential path. Forks fail the repository-identity gate.
Dependabot fails the separate actor-identity gate.

Closing an eligible pull request triggers ownership-checked removal of its
custom-domain association and managed DNS record; a failed cleanup remains
visible and must be retried. Manual `undeploy:test` applies the same
public-hostname cleanup to a personal prefix. Cloudflare may preserve the
underlying immutable or branch deployment as opaque provider state; neither
cleanup path treats that deployment as a durable, supported URL.
