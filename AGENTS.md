# Atrinik website repository guide

## Ownership and architecture

- This repository solely owns atrinik.org: the evidence-gated MIT
  Astro/TypeScript site, public content, deployment configuration, and recovery
  docs. Keep it independently buildable/deployable; the wrapper never owns
  Astro source.
- Use static Astro output, semantic HTML/CSS/Markdown, and structured data.
  [atrinik/website#75](https://github.com/atrinik/website/issues/75) defines
  the only dynamic surface: Cloudflare Pages Functions under `/api/*` only
  (`functions/` routes, logic in `server/`, `_routes.json` include `/api/*`)
  and one Astro-bundled, self-hosted module script for Classic downloads and
  official server status. Any further browser JavaScript, route, binding,
  secret, database, CMS, client framework, or third-party script requires an
  issue defining its necessity, privacy/security ownership, CSP changes, and
  validation.
- The site is presentation/discovery, not an account/game API, metaserver,
  protocol authority, content compiler, release store, or documentation fork.
  Never handle credentials, characters, payments, private community data, or
  persistent game sessions.
- Every page works without JavaScript and without the `/api` runtime: the
  static downloads page links to the latest Classic GitHub release with
  platform guidance, and the module only enhances it after validating API
  JSON, building DOM with `textContent`. Status integrations are read-only,
  bounded, cached appropriately, and honest when empty, stale, malformed,
  timed out, or unavailable; they never fabricate status.
- The `/api` runtime accepts only signed `atrinik/classic` release webhooks
  (HMAC verified over the bounded raw body before parsing) and GET reads. It
  stores one validated record in the `DOWNLOADS` KV namespace, fetches only
  allowlisted https hosts with timeouts and size bounds, never trusts webhook
  URLs or digests, and never replaces a good record with a worse or empty one.
  It logs reason codes only, never bodies or visitor identifiers.
- Cloudflare Pages owns preview/production deployment. Document project/branch,
  environments, domain/DNS/TLS, permissions, health, cache invalidation,
  rollback, and outage behavior. Keep metaserver/game hosts separate. Never
  deploy or change production DNS without explicit user authorization.
- Keep one Git-integrated Pages project: only `main` serves `atrinik.org`,
  `www.atrinik.org` permanently redirects to the apex, and all non-production
  branches use Cloudflare's provider-managed `pages.dev` previews. Do not add
  custom preview domains, direct-upload tooling, preview credentials, or a
  privileged preview workflow.
- Native Pages previews are public and Cloudflare adds `X-Robots-Tag: noindex`.
  Same-repository pull requests receive a Pages preview link through the
  Cloudflare GitHub integration; forks do not. Treat every preview as public:
  immutable deployment URLs can remain reachable after a branch or pull
  request is closed.
- Treat Cloudflare response transformation as a separate provider boundary.
  It may inject bot/security JavaScript or a dashboard-managed Web Analytics
  beacon, set strictly necessary cookies, or serve a challenge with its own
  HTML, scripts, cookies, and CSP. Keep those features out of source, disclose
  them honestly, retain the same-origin `script-src 'self'` and
  `connect-src 'self'` CSP on ordinary site responses, and audit
  production plus preview behavior rather than inferring it from `dist/`.

## Content, privacy, and security

- Offer a direct Classic download only for a published, immutable,
  non-prerelease release whose exact client asset names exist, whose
  `SHA256SUMS` digests equal GitHub's asset digests, and whose protocol matches
  the official server (see `docs/ARCHITECTURE.md`). Do not scrape mutable pages
  or guess download URLs; invalid metadata leaves the static release-page
  fallback.
- Keep classic GPL and replacement MIT packages clearly distinct. The site MIT
  license never covers downloaded binaries or mixed authored media/content.
  Media derivatives require a locally retained source bound to its repository
  path, immutable Git blob object ID and digest, published digest and binary
  dimensions, author, license, transformation, attribution, and accessible
  alternative text/role. Validation rejects unproven or uncatalogued media.
- Independent implementation is the default where exact reuse is not proven.
  Historical Classic destination reuse follows the
  [local provenance record](PROVENANCE.md) and
  [canonical grant registry](https://github.com/atrinik/atrinik/blob/main/docs/PROVENANCE.md).
  At an exact source revision, prove every copyrightable portion is separable,
  within a recorded grant's past-contribution scope, and original work solely
  authored by its grantor. Present-day blame, majority authorship, a later
  edit, or an agent-assisted commit cannot fill a coverage gap. Admitted
  material may be inspected as implementation reference, copied, adapted,
  ported, translated, and MIT-relicensed in this destination. Record the exact
  source, destination, transformation, and registry revision; uncovered
  material fails closed. The Classic repository remains GPL-distributed. Do not
  republish archived personal data without a separate privacy and provenance
  decision.
- Public copy, captions, alt text, credits, structured data, and social or
  search metadata, and repository records (docs, notices, and `media.json` or
  `icons.json` fields), must not mention AI, agents, or the tools used to make
  the software or media; credit the author only. `validatePublicCopy` enforces
  this on `site.json`, the media and icon catalogs, and every built page.
- Do not put secrets in source, static output, browser code, logs, fixtures,
  preview metadata, or `PUBLIC_` values. Protected environments use least
  privilege. Omit repository-managed analytics, tracking, cookies, ads, and
  third-party embeds by default; separately disclose provider-controlled edge
  behavior.
- Treat Markdown, metadata, URLs, SVG, and remote input as untrusted: validate
  schemas, allowlist destinations/protocols, escape output, prevent traversal
  and injection, and bound size, redirects, retries, and timeouts. Apply/test a
  restrictive CSP and security/privacy/cache/content/referrer/frame/permissions
  headers.

## Accessibility, performance, and validation

- Accessibility gates semantic structure, keyboard/focus behavior, contrast,
  headings/labels/errors, zoom/reflow, reduced motion, and screen-reader use.
  Enforce page/image/font/script/request and representative mobile/desktop
  performance budgets. Generated output is disposable and untracked.
- `atrinik/atrinik#168` is the program roadmap; local issues/milestones own
  website delivery. Do not copy M1-M6 schedules into this guide.
- Run the current pinned aggregate commands:

  ```sh
  npm ci
  npm run check
  npm run build
  git diff --check
  ```

  `Website validation` owns formatting/lint/types/Astro build, links,
  provenance/license, accessibility, performance, dependencies/security, and
  deployment dry-run as documented. Manually check affected URLs with keyboard,
  reduced motion, representative screen reader, mobile/desktop, slow/no JS,
  missing metadata, and broken images. For deployed pages also inspect response
  HTML, network requests, `Set-Cookie`, browser storage, and CSP failures for
  provider-injected scripts or beacons.

- Dependency security CI runs `node scripts/audit-delta.mjs` before lifecycle
  scripts, comparing fresh complete audits of the event base and tested candidate.
  Keep the exact revision fences, isolated verified bundle hydration, and full
  reports. New advisory/affected-package pairs at any severity and severity
  increases fail; existing findings warn and fixes pass. Missing baselines and
  install, audit, or parsing errors fail closed. Do not add advisory allowlists
  or known-good version gates. See README for the execution contract.

- `Dependency review` provides nonblocking advisory feedback on eligible ordinary
  PR runs where this workflow exists on the relevant revision, with no target-branch
  filter, across runtime, development, and unknown scopes at every severity.
  Implementing agents must read the latest job summary for the current PR head,
  even when a PR comment exists, because comments may be stale. If that summary
  is unavailable, treat results as unknown and inspect annotations and logs.
  Fix actionable introduced risks, or record an explicit maintainer acceptance
  of existing risk, before merge. This adds no required human approval gate;
  preserve all other validation and security checks.

- Wrapper replacement build adapters are not available yet. Use repository
  validation; a website-only change has no game topology/state proof. Coordinate
  meaningful dependency/toolchain/Action/image/validation changes with their
  owners and preserve standard locks/integrity manifests. Wrapper supply-chain
  inventories are optional diagnostics; catalog updates never gate PR readiness.
- Commits/PR titles use Conventional Commits; semantic-release owns releases.
  Deployment handoffs name preview, revision, inputs, checks, environment,
  health, rollback, and anything not exercised.
