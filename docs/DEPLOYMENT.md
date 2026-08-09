# Cloudflare Pages deployment contract

Atrinik uses one Git-integrated Cloudflare Pages project, `atrinik-website`,
connected only to `atrinik/website`. The site is fully static: it has no Pages
Functions, bindings, runtime secrets, analytics, remote build inputs, or
environment-dependent pages.

The deployment topology is fixed:

- `main` is the only production branch and serves `https://atrinik.org`;
- `https://www.atrinik.org/<path>` permanently redirects to
  `https://atrinik.org/<path>`, preserving the query string;
- all non-production branches use Cloudflare's native `pages.dev` preview
  deployments and aliases;
- the repository has no custom preview domain or manual direct-upload path.

`deployment/cloudflare-pages.json` is the reviewed machine contract for this
topology. It validates repository intent but does not provision Cloudflare.

## Project and production setup

Configure the Pages Git integration with:

- project: `atrinik-website`;
- repository: `atrinik/website`, with the root directory left blank;
- production branch: `main`;
- automatic production deployments: enabled;
- preview branch deployments: **All non-production branches**;
- build command: `npm ci && npm run build`;
- output directory: `dist`;
- Functions, bindings, runtime secrets, and Web Analytics: absent or disabled.

The repository's `.nvmrc` pins Node 24.18.1. Limit the Cloudflare Workers &
Pages GitHub App installation to `atrinik/website` and periodically review its
repository access. Routine production and preview builds require no
Cloudflare API token in GitHub.

Domain registration and Cloudflare DNS are separate. Confirm that the
`atrinik.org` zone and Pages project belong to the intended account. Preserve
`meta.atrinik.org`, mail records, verification records, and every independently
owned hostname during DNS work.

Attach `atrinik.org` and `www.atrinik.org` through **Pages → Custom domains** so
Pages owns their DNS and certificate relationship. A reviewed Cloudflare
Redirect Rule permanently redirects `www.atrinik.org` to the apex while
preserving path and query. The response policy enables one-year HSTS with
`includeSubDomains`, so every retained web-facing subdomain must serve valid
HTTPS.

## Native preview deployments

Cloudflare automatically deploys every enabled non-production branch. For a
pull request whose branch belongs to `atrinik/website`, the Cloudflare GitHub
integration posts the preview URL and keeps it updated as commits are pushed.
Cloudflare does not create that pull-request preview for a fork.

Pages exposes two useful provider-managed forms:

- a unique, immutable URL for a particular deployment;
- a normalized branch alias that follows the latest deployment on that branch.

These are public review surfaces, not an authentication boundary. Never put
private content or credentials in a preview. Cloudflare adds
`X-Robots-Tag: noindex` to native preview responses by default. The repository
must not add that header globally because the same static `_headers` file also
serves production.

An immutable deployment URL may remain visitable after a pull request is
merged or closed. Pages supports deleting eligible old deployments separately,
but the latest deployment for a branch cannot be deleted. Atrinik does not run
credentialed cleanup automation: the provider hostname has no DNS authority
over `atrinik.org`, and its possible persistence is accepted as public provider
state. Enable the project's Cloudflare Access preview policy if previews ever
need an authentication boundary.

There is intentionally no Wrangler dependency, manual upload command,
`testing.atrinik.org` custom hostname, preview-domain workflow, or GitHub-held
Cloudflare credential. To review a change, push its branch and use the link
posted by Cloudflare on the pull request.

## Health, rollback, and recovery

Before production promotion, record the exact Git revision and Pages
deployment ID/URL plus the results of:

```sh
npm ci
npm run check
npm run build
npm run deploy:dry-run
```

Verify `/`, `/about/`, `/downloads/`, `/licenses/`, `/404.html`, `_headers`,
narrow and desktop keyboard behavior, no-JavaScript rendering, TLS, the apex
canonical, and the permanent `www` redirect.

Production health means the canonical root serves the reviewed `main` revision
with the expected security headers. If it does not, promote the last verified
production deployment in Pages and repeat the checks before diagnosing the
failed build. Hashed assets remain immutable; invalidate only the affected
deployment where necessary.

Cloudflare's relevant documentation:

- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://developers.cloudflare.com/pages/configuration/branch-build-controls/
- https://developers.cloudflare.com/pages/configuration/preview-deployments/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developers.cloudflare.com/pages/configuration/rollbacks/
