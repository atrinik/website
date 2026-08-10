# Security policy

Report vulnerabilities privately through GitHub Security Advisories for
`atrinik/website`. Do not include credentials, private account data, or exploit
details in a public issue.

The supported site is static output from `main`. It intentionally accepts no
user input and emits no application cookies, analytics, tracking, browser
scripts, third-party embeds, Pages Functions, bindings, or secrets. Cloudflare
is a separate provider boundary: it may inject bot/security JavaScript or a
dashboard-managed Web Analytics beacon, set strictly necessary cookies, or
serve a challenge response with different HTML, scripts, cookies, and CSP. The
ordinary static response's no-script CSP blocks injected scripts. Report unsafe
or undisclosed provider behavior through the same private channel. Treat
imported metadata, Markdown, URLs, SVG, and media as untrusted and validate them
before publication.
