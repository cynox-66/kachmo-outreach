# ADR-023: Evidence Retrieval Is a Human-Invoked, SSRF-Guarded Fetch

> **Status:** Approved & Canonical (Phase B)
> **Owner:** Dev Jaiswal (Kachmo Studios)
> **Last Updated:** 2026-09-19
> **Version:** 1.0.0

---

## Purpose

ADR-011 made RETRIEVED a real level but nothing could reach it. This records how a source is fetched.

## Decision

`npm --prefix os run evidence:fetch` (dry run by default; `--apply --actor="<name>"` fetches) retrieves the source
URLs of unreviewed claim evidence. There is no background worker and no schedule: a named person runs it.

Defences, all on by default and none switchable by the URL:

- http/https only, default ports only, no credentials in the URL, no IP-literal hosts (this also defeats the
  decimal/octal/hex spellings of 127.0.0.1); `.local`/`.internal`-style names refused
- every resolved address must be public (RFC1918, loopback, link-local/metadata, CGNAT, multicast, documentation,
  6to4, NAT64, unique-local, IPv4-mapped IPv6 …); a mixed answer is refused; **the socket is pinned to the checked
  address**, so DNS rebinding cannot redirect it
- at most 3 redirects, each re-validated from scratch; 10 s total, 5 s connect, 2 MB body, textual types only
- `robots.txt` honoured (a 5xx robots.txt means "disallow"); a named user agent; ≤ 1 request per host every 5 s
- TLS verification is never disabled (asserted by test)

Every attempt is appended to `evidence_retrieval` (append-only). A success links the retrieval to every unreviewed
claim citing the URL, whose derived level becomes **RETRIEVED — the FETCHER validator's cap**. A 404 is not a
contradiction. Failures cool down (1 h, then 24 h); after three, the URL is left for a person (NEEDS_HUMAN).

Retrieved page text may contain contact details, so it is shown only to actors with `lead.view_contacts`.

## Implementation

`os/server/evidence/{fetch,fetch-run}.ts`, migration 0004, `os/tests/evidence.ts` §1–§3, §5.
