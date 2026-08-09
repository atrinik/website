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

`deployment/cloudflare-pages.json` is a reviewed machine contract, not an
infrastructure provisioner. Create the project through Cloudflare's Git
integration with these exact settings:

- project: `atrinik-website`;
- repository: `atrinik/website`, with the root directory left blank;
- production branch: `main`;
- build command: `npm ci && npm run build`;
- output directory: `dist`;
- Functions, bindings, secrets, and Web Analytics: absent or disabled.

The repository's `.nvmrc` pins Node 24.18.1. After the first deployment,
confirm the build used that version and verify the generated `pages.dev`
hostname before attaching a production domain. Git-integrated projects cannot
later be converted to Direct Upload projects.

## Environments and permissions

- Limit the Cloudflare Workers & Pages GitHub App installation to only
  `atrinik/website`. Current new installations request repository
  Administration and Contents read/write permissions for Cloudflare's template
  creation features, even though this deployment never authorizes source
  changes. Organization owners review those permissions during installation
  and keep the repository scope narrow.
- `main` is the only production branch. Preview URLs are team-only until their
  content and headers are reviewed; a preview never receives the production
  custom domain. Pages previews are public by default, so enable the project's
  Access policy under **Settings → General** before relying on this boundary.
- The Cloudflare role used to administer the project is scoped to Pages and
  DNS for the Atrinik zone. Routine Git builds require no API token in GitHub.
- `atrinik.org` is the canonical host. `www.atrinik.org` may only redirect to
  it through reviewed zone/Page rules. `meta.atrinik.org` remains separately
  owned by the metaserver.

## Domain attachment

Domain registration and Cloudflare DNS are separate. Public DNS for
`atrinik.org` was already delegated to Cloudflare when this contract was
reviewed, so a registrar transfer or routine nameserver change is not required.
First confirm that the existing zone is visible in the same Cloudflare account
as the Pages project. If it is not, recover access or coordinate with that
account's owner; do not replace nameservers as a shortcut.

Before any DNS mutation, export and review the complete zone. Preserve
`meta.atrinik.org`, Google mail MX records, SPF, DKIM, DMARC, verification
records, and every other independently owned hostname. Attach the apex through
**Pages → Custom domains → Set up a domain → `atrinik.org`** so Pages provisions
the correct DNS and certificate relationship. Do not create only a manual
CNAME. Add `www.atrinik.org` through the reviewed custom-domain flow and use a
proxied redirect rule to send it permanently to the canonical apex while
preserving path and query.

The response policy enables one-year HSTS with `includeSubDomains`. Confirm
every retained web-facing subdomain serves valid HTTPS before production
cutover.

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
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://developers.cloudflare.com/pages/configuration/preview-deployments/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/configuration/rollbacks/
