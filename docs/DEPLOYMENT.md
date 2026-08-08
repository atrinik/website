# Cloudflare Pages deployment contract

The Cloudflare Pages project `atrinik-website` is connected only to
`atrinik/website`. Production builds exact `main` revisions with
`npm ci && npm run build` and publishes `dist`; pull requests receive isolated
preview deployments. This follows Cloudflare's current Astro Pages contract:
`npm run build` with output directory `dist`.

The site is fully static. It has no Pages Functions, bindings, secrets,
analytics, remote build inputs, or environment-dependent content. Adding any
dynamic boundary requires a separate security/ownership issue and an updated
machine deployment contract.

## Environments and permissions

- GitHub installation access is limited to `atrinik/website`; Pages may read
  source and commit metadata but cannot write repository contents.
- `main` is the only production branch. Preview URLs are team-only until their
  content and headers are reviewed; a preview never receives the production
  custom domain.
- The Cloudflare role used to administer the project is scoped to Pages and
  DNS for the Atrinik zone. Routine Git builds require no API token in GitHub.
- `atrinik.org` is the canonical host. `www.atrinik.org` may only redirect to
  it through reviewed zone/Page rules. `meta.atrinik.org` remains separately
  owned by the metaserver.

## Promotion, health, and rollback

Before production promotion, record the exact Git revision, Pages deployment
ID/URL, `npm ci`, `npm run check`, `npm run build`, and
`npm run deploy:dry-run` results. Verify `/`, `/about/`, `/downloads/`,
`/licenses/`, `/404.html`, `_headers`, narrow/desktop keyboard behavior, no-
JavaScript rendering, and the custom-domain TLS/canonical redirect.

Health means the canonical root returns the reviewed static revision with the
expected security headers. If it does not, promote the last verified
production deployment in Pages, verify the same checks, and only then diagnose
the failed build. Cache invalidation is limited to the affected deployment;
hashed assets are immutable.

Cloudflare documents Git-integrated preview deployments and production
rollbacks at:

- https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/
- https://developers.cloudflare.com/pages/configuration/preview-deployments/
- https://developers.cloudflare.com/pages/configuration/rollbacks/
