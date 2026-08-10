# Atrinik website repository guide

## Ownership and architecture

- This repository solely owns atrinik.org: the clean-room MIT Astro/TypeScript
  site, public content, deployment configuration, and recovery docs. Keep it
  independently buildable/deployable; the wrapper never owns Astro source.
- Use static Astro output, semantic HTML/CSS/Markdown, and structured data with
  no repository-authored browser JavaScript under the current contract.
  Introducing browser JavaScript requires an issue defining its necessity,
  privacy/security ownership, CSP changes, and validation. A server runtime,
  database, CMS, client framework, or dynamic function likewise requires an
  issue proving static design is insufficient and defining security/ownership.
- The site is presentation/discovery, not an account/game API, metaserver,
  protocol authority, content compiler, release store, or documentation fork.
  Never handle credentials, characters, payments, private community data, or
  persistent game sessions.
- Core pages and built artifacts contain no repository-authored browser
  JavaScript and require no live services. Status integrations are read-only,
  bounded, cached appropriately, and honest when empty, stale, malformed,
  timed out, or unavailable.
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
  them honestly, retain a no-script CSP on ordinary site responses, and audit
  production plus preview behavior rather than inferring it from `dist/`.

## Content, privacy, and security

- Consume immutable schema-validated release metadata with component, version,
  source revision, platform, compatibility, artifact, size, digest, provenance,
  and exact license. Do not scrape mutable pages or guess download URLs; invalid
  metadata makes a download unavailable.
- Keep classic GPL and replacement MIT packages clearly distinct. The site MIT
  license never covers downloaded binaries or mixed authored media/content.
  Media derivatives require a locally retained source bound to its repository
  path, immutable Git blob object ID and digest, published digest and binary
  dimensions, author, license, transformation, attribution, and accessible
  alternative text/role. Validation rejects unproven or uncatalogued media.
- Historical reuse follows local `PROVENANCE.md` and canonical
  `atrinik/atrinik/docs/PROVENANCE.md`, failing closed on incomplete/mixed
  evidence. Do not republish archived personal data without a separate privacy
  and provenance decision.
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

- Wrapper replacement build adapters are not available yet. Use repository
  validation; a website-only change has no game topology/state proof. Update
  wrapper supply-chain inventory when dependencies/toolchains/Actions/images or
  validation paths change.
- Commits/PR titles use Conventional Commits; semantic-release owns releases.
  Deployment handoffs name preview, revision, inputs, checks, environment,
  health, rollback, and anything not exercised.
