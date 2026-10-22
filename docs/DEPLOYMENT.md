# Cloudflare Pages deployment contract

Atrinik uses one Git-integrated Cloudflare Pages project, `atrinik-website`,
connected only to `atrinik/website`. Pages are static. Pages Functions answer
only `/api/*` ([atrinik/website#75](https://github.com/atrinik/website/issues/75)):
Classic download selection, the signed release webhook, and official server
status. They use one KV namespace and two secrets, listed below. There are no
application analytics, cookies, remote build inputs, or environment-dependent
pages. Cloudflare can still transform a response at the provider edge after
the build.

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
- Functions: the repository `functions/` directory, limited to `/api/*` by
  the checked-in `_routes.json`; bindings and secrets as described in
  [Pages Functions setup](#pages-functions-setup);
- Web Analytics: no repository snippet or build integration; dashboard-managed
  state must be checked against the delivered response and publicly disclosed.

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

## Pages Functions setup

The owner configures these in the Cloudflare dashboard; none of them belong in
source, previews, or logs. Configure **Production** and **Preview** separately.

1. **KV namespaces.** Under **Storage & Databases → KV**, create two
   namespaces: `atrinik-website-downloads` and
   `atrinik-website-downloads-preview`. A separate preview namespace is
   mandatory: previews run unreviewed branch code and must never share storage
   with production. In the Pages project open **Settings → Bindings → Add → KV
   namespace** and bind the variable name `DOWNLOADS` to the production
   namespace for Production and to the preview namespace for Preview. The
   runtime also prefixes every non-`main` key with `preview:` as a second
   barrier. Without the binding the download API answers 503 and the page
   keeps its static fallback.
2. **Variable.** Under **Settings → Variables and Secrets**, add the plain-text
   variable `OFFICIAL_SERVER_HOST` = `game.atrinik.com` for both environments.
   It names the server-directory entry whose version and protocol select the
   download.
3. **Secrets.** Add `GITHUB_WEBHOOK_SECRET` (a long random value, for example
   `openssl rand -hex 32`) as an encrypted secret. Add `GITHUB_TOKEN` as an
   encrypted secret too; it is required. Use a fine-grained personal access
   token with **public repositories read-only** access and no other
   permissions. Without it, requests to GitHub's API share the
   unauthenticated limit of 60 an hour per egress address with every other
   Worker on that address, so refreshes fail unpredictably. The runtime then
   keeps serving the last good record, but stops tracking releases.
4. **Redeploy** the latest `main` deployment (and a preview) so the bindings
   apply.
5. **GitHub webhook.** In `atrinik/classic` → **Settings → Webhooks → Add
   webhook**: payload URL `https://atrinik.org/api/github/release`, content
   type `application/json`, the same secret as `GITHUB_WEBHOOK_SECRET`, SSL
   verification enabled, and **Let me select individual events → Releases**
   only. GitHub sends a `ping` immediately, which must show 204.

The `deployment/cloudflare-pages.json` contract records exactly this binding,
variable, and secret set; validation rejects additions.

### Verify

- `curl -sS https://atrinik.org/api/downloads/classic` returns the record JSON
  with `Cache-Control: public, max-age=60`; the first request after setup may
  take a few seconds while it is computed. `serverMatch` should be `true` and
  `server.version` should equal the official server's version.
- `curl -sS https://atrinik.org/api/status` returns `available: true` and only
  the official server's name, version, player count, and online flag.
- `curl -sSI https://atrinik.org/downloads/` is served without invoking a
  Function (no `/api` path) and carries `script-src 'self'; connect-src
'self'`. Requests such as `curl -sSI -X POST https://atrinik.org/` must not
  reach a Function.
- An unsigned `curl -X POST https://atrinik.org/api/github/release` returns
  401; the webhook's **Recent Deliveries** show 202 for releases.
- In a browser, `/downloads/` shows both platform buttons and the status line
  with no CSP errors; with JavaScript disabled it shows the
  "Download from GitHub" fallback.
- The Pages **Functions** log shows only reason codes such as
  `classic download refresh: no-newer-matching-release`, never request
  content.

### KV keys

Production keys are listed below; preview deployments use the same keys with
a `preview:` prefix.

| Key                                | Contents                              | Expiry     |
| ---------------------------------- | ------------------------------------- | ---------- |
| `classic:download:v1`              | the selected release record           | none       |
| `classic:download:refresh-gate:v1` | visit refresh gate (staleness window) | 15 minutes |
| `classic:download:webhook-gate:v1` | webhook deduplication gate            | 60 seconds |
| `classic:tag-commit:v1:<tag>`      | commit a release tag points to        | 1 day      |
| `classic:protocol:v1:<commit>`     | `protocol_version` at an exact commit | none       |

### Outage behavior and rollback

If GitHub, the server directory, or KV fail, the API keeps serving the last
good record or returns `{ "available": false }`, and the page keeps its static
GitHub link. To force a recompute, use **Redeliver** on a webhook delivery in
GitHub; it bypasses the 15-minute gate. To withdraw the runtime, promote the
last verified deployment from before the Functions change; the static fallback
needs no bindings.

To reset selection, delete `classic:download:v1` and
`classic:download:refresh-gate:v1` in the production namespace (in **KV →
namespace → KV Pairs**, or with `wrangler kv key delete`); the next download
request recomputes the record synchronously. Delete `classic:tag-commit:v1:*`
entries if a tag was ever moved; `classic:protocol:v1:*` entries never need
resetting because they are keyed by immutable commit. Remove the webhook in `atrinik/classic` and the
secrets in Pages if the runtime is retired.

## Provider edge privacy boundary

The built artifact contains one self-hosted module script and sets no
application cookies. That does not make every Cloudflare-delivered response
free of other scripts or cookies.
Depending on hostname, request signals, and dashboard configuration, Cloudflare
may inject Web Analytics, add JavaScript for bot or challenge services, replace
the origin page with a challenge, or set strictly necessary security cookies
such as `__cf_bm` or `cf_clearance`. These are provider-controlled behaviors,
not files or application tracking emitted by Atrinik.

A live audit on 2026-08-10 observed a Cloudflare Web Analytics tag in the
production response for a Chromium browser user agent. This was
`static.cloudflareinsights.com/beacon.min.js`, not an anti-bot
`/cdn-cgi/challenge-platform/` script. The ordinary-site
`Content-Security-Policy: script-src 'none'` in force at the time blocked the
tag before it received
a response or sent a beacon; no cookies, local storage, or session storage were
created. The branch preview contained no injected script. A curl response and
a browser response differed, demonstrating that one request is not proof of
provider behavior for every visitor. No challenge occurred during the audit,
which likewise does not prove that Cloudflare will never challenge another
request.

Treat this observation as repeatable evidence, not a permanent invariant. For
production and preview, inspect the delivered HTML, CSP console failures,
script and `/cdn-cgi/` requests, response `Set-Cookie` headers, browser cookies,
and local/session storage with JavaScript both enabled and disabled. Do not
change dashboard analytics, bot, challenge, or cookie behavior through a source
change; record any separately authorized provider configuration change and
repeat this audit.

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
`_routes.json`, the `/api` checks above,
narrow and desktop keyboard behavior, no-JavaScript rendering, TLS, the apex
canonical, and the permanent `www` redirect. Compare `dist/` with production
and preview responses, recording provider-injected scripts, beacons,
`Set-Cookie`, browser storage, and CSP outcomes.

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
- https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/
- https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/
- https://developers.cloudflare.com/web-analytics/get-started/
