# Cloudflare Pages deployment contract

Atrinik uses one Cloudflare Pages project, `atrinik-website`, for production and
preview deployments. It is connected only to `atrinik/website`. The site stays
fully static: there are no Pages Functions, bindings, runtime secrets,
analytics, remote build inputs, or environment-dependent pages.

The deployment topology is fixed:

- `main` is the only production branch and serves `https://atrinik.org`;
- `https://www.atrinik.org/<path>` permanently redirects to
  `https://atrinik.org/<path>`, preserving the query string;
- a manual preview named `zoey` uses the Pages branch `manual-zoey` and serves
  `https://zoey.testing.atrinik.org`;
- pull request 123 from a branch in `atrinik/website` serves
  `https://pr.123.testing.atrinik.org`.

`deployment/cloudflare-pages.json` is the reviewed machine contract for this
topology. It is not an infrastructure provisioner.

## Project and production setup

Create the project through Cloudflare's Git integration with these exact
settings:

- project: `atrinik-website`;
- repository: `atrinik/website`, with the root directory left blank;
- production branch: `main`;
- preview branch deployments: enabled for all non-production branches;
- build command: `npm ci && npm run build`;
- output directory: `dist`;
- Functions, bindings, runtime secrets, and Web Analytics: absent or disabled.

The repository's `.nvmrc` pins Node 24.18.1. Confirm that the first build uses
that version and that the generated `pages.dev` hostname works before adding
custom domains. A Git-integrated project cannot be converted into a Direct
Upload project, but Cloudflare does support Wrangler uploads to an existing
Git-integrated project. Manual previews use that supported path; they do not
create a second Pages project.

Limit the Cloudflare Workers & Pages GitHub App installation to
`atrinik/website`. Organization owners must review its repository permissions
and keep the installation scope narrow.

Domain registration and Cloudflare DNS are separate. Confirm that the existing
`atrinik.org` zone and the Pages project are in the intended account. Before
changing DNS, export and review the zone, preserving `meta.atrinik.org`, mail
MX records, SPF, DKIM, DMARC, verification records, and every independently
owned hostname.

Add `atrinik.org` and `www.atrinik.org` through **Pages → Custom domains** so
Pages provisions their DNS and certificates. Do not create only a manual CNAME.
Configure a reviewed Cloudflare Redirect Rule for `www.atrinik.org` that returns
a permanent redirect to the canonical apex while preserving path and query.
The response policy enables one-year HSTS with `includeSubDomains`; every
retained web-facing subdomain must therefore serve valid HTTPS.

## Preview boundary and credentials

All `testing.atrinik.org` hostnames are temporary, public review surfaces. They
serve static output with production canonical links, but host-specific
`_headers` rules send `X-Robots-Tag: noindex, nofollow`. Do not add that header
to the global `/*` rule: doing so would remove production from search indexes.
A preview URL is not an authentication boundary and must never contain private
content or credentials.

Cloudflare currently allows 100 custom domains per Pages project on the Free
plan. The production apex and `www` consume two; concurrent manual and pull
request hostnames share the remaining quota. Cleanup releases the custom-domain
slot and public DNS name, even though Cloudflare may retain the opaque
`pages.dev` deployment behind it.

Create the GitHub environment `cloudflare-preview-domains` with exactly:

- variable `CLOUDFLARE_ACCOUNT_ID`, identifying the Pages account;
- variable `CLOUDFLARE_ZONE_ID`, identifying only the `atrinik.org` zone;
- secret `CLOUDFLARE_PREVIEW_TOKEN`.

The custom token needs Account / Cloudflare Pages / Edit (called `Pages Write`
by the API) for the selected account and Zone / DNS / Edit for only the
`atrinik.org` zone. It needs no GitHub permission and must not be committed,
logged, placed in Pages build variables, or exposed to pull request code.
Configure a custom environment deployment branch policy with
`protected_branches: false` and only `main` allowed; `pull_request_target` runs
in that trusted base/`main` context. Do not add a protection rule that can
indefinitely hold a close-event cleanup.

Manual deployments are only for trusted, maintainer-controlled worktrees.
Never check out untrusted pull request code and then run the manual deployment
command or load Cloudflare credentials into that worktree. Before loading any
credential, install the pinned tools, run every local gate, and inspect exactly
what the worktree contains:

```sh
npm ci
npm run check
npm run deploy:dry-run
git status --short
```

Ensure the current worktree contains no secret or unintended file. Reviewed
uncommitted maintainer changes are supported and recorded by Wrangler as a
dirty commit. One scoped token then authenticates both Wrangler's static upload
and the preview-domain helper's DNS and Pages custom-domain operations. Provide
the account ID, zone ID, and token only through the local environment:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_ZONE_ID=your-zone-id
read -r -s -p "Cloudflare preview token: " CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
```

Never put the token in a tracked `.env` file, shell command argument, or log.
The deployment wrapper passes it through the environment to Wrangler and the
domain-management helper.

## Manual testing hostname

After the credential-free validation and inspection above, load the token and
deploy that trusted current worktree to the stable personal testing hostname:

```sh
npm run deploy:test -- zoey
curl -fsSI https://zoey.testing.atrinik.org/
curl -fsS https://zoey.testing.atrinik.org/ | grep -F '<link rel="canonical" href="https://atrinik.org/">'
```

The prefix is validated and converted to the non-production Pages branch
`manual-zoey`; it can never select `main`, `atrinik.org`, `www.atrinik.org`, or
another arbitrary zone name. The command validates and builds the current
worktree, uploads `dist` to the existing `atrinik-website` project, associates
the custom domain, and creates or updates only its managed proxied CNAME.

The header response must include `X-Robots-Tag: noindex, nofollow` plus the
normal security headers. The second request must find the production canonical
link. Remove the public hostname when review is complete:

```sh
npm run undeploy:test -- zoey
unset CLOUDFLARE_API_TOKEN
```

Removal deletes the managed DNS record and Pages custom-domain association. A
Cloudflare deployment URL or branch deployment is opaque provider state and may
remain after the hostname is removed; its persistence is not permission to
reuse it as a stable public URL.

## Pull request hostnames

Cloudflare's Git integration builds enabled same-repository branches. For an
eligible non-Dependabot pull request, the privileged GitHub workflow is only a
metadata control plane that attaches the successful Pages deployment for the
current pull request head to `pr.<number>.testing.atrinik.org`.

The workflow uses `pull_request_target` because it needs the protected GitHub
environment on open, reopen, synchronize, and close events. Its security
boundary is strict:

- the pull request head repository must be exactly `atrinik/website`;
- the pull request author must not be `dependabot[bot]`;
- the workflow file and helper are checked out from the pull request's trusted
  base revision, never its head;
- the head branch name and commit are treated only as metadata used to find the
  matching successful Pages deployment;
- the job never checks out or executes pull request code, installs its
  dependencies, restores its cache, or downloads its artifacts;
- GitHub permissions remain read-only, and the Cloudflare token is available
  only through `cloudflare-preview-domains`.

Fork and Dependabot pull requests still receive normal repository validation,
but they never receive a custom hostname or Cloudflare credentials. An eligible
same-repository pull request's hostname is public and noindex, not private.

Every eligible pull request close event triggers ownership-checked removal of
its managed DNS record and Pages custom-domain association, whether the pull
request was merged or closed without merging. Per-pull-request concurrency does
not hard-cancel an in-progress operation. A failed cleanup stays visible as a
failed workflow and must be retried; Cloudflare may retain the underlying
immutable or branch preview deployment after successful hostname cleanup.

## Health, rollback, and recovery

Before production promotion, record the exact Git revision and Pages
deployment ID/URL plus the results of `npm ci`, `npm run check`, `npm run build`,
and `npm run deploy:dry-run`. Verify `/`, `/about/`, `/downloads/`, `/licenses/`,
`/404.html`, `_headers`, narrow and desktop keyboard behavior, no-JavaScript
rendering, TLS, the apex canonical, and the permanent `www` redirect.

Production health means the canonical root serves the reviewed `main` revision
with the expected security headers. If it does not, promote the last verified
production deployment in Pages and repeat the checks before diagnosing the
failed build. Hashed assets remain immutable; invalidate only the affected
deployment where necessary.

If preview cleanup fails, rerun the close workflow or use the matching
`undeploy:test` operation for a manual prefix. Resolve only records and Pages
domains matching the reviewed testing patterns. Never delete or repoint an
unrecognized record as cleanup.

Cloudflare's relevant documentation:

- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/configuration/preview-deployments/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developers.cloudflare.com/pages/configuration/api/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/configuration/rollbacks/
