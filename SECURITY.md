# Security policy

Report vulnerabilities privately through GitHub Security Advisories for
`atrinik/website`. Do not include credentials, private account data, or exploit
details in a public issue.

The supported site is static output from `main` plus Cloudflare Pages
Functions limited to `/api/*` ([#75](https://github.com/atrinik/website/issues/75)).
The runtime accepts only signed `atrinik/classic` release webhooks and
read-only GET requests, and the pages carry one self-hosted module script. It
emits no application cookies, analytics, tracking, or third-party embeds. Its
only secrets are the webhook secret and an optional read-only GitHub token,
held in Cloudflare. Cloudflare
is a separate provider boundary: it may inject bot/security JavaScript or a
dashboard-managed Web Analytics beacon, set strictly necessary cookies, or
serve a challenge response with different HTML, scripts, cookies, and CSP. The
ordinary static response's same-origin CSP (`script-src 'self'`) blocks
injected third-party scripts. Report unsafe
or undisclosed provider behavior through the same private channel. Treat
imported metadata, Markdown, URLs, SVG, and media as untrusted and validate them
before publication.
