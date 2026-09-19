import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

/**
 * THE EVIDENCE FETCHER (CAP-6, ADR-023).
 *
 * Fetches a source URL so a claim can move from URL_SHAPED ("a string that looks like a URL") to RETRIEVED ("a
 * page existed at this address, and here is exactly what it said"). It never decides that a page SUPPORTS a claim —
 * that is a human's job (ADR-011: the FETCHER validator caps at RETRIEVED).
 *
 * It reaches out to the internet on behalf of a named operator, so every defence is on by default and none can be
 * switched off by the URL it is given:
 *
 *   - http/https only; no credentials in the URL; default ports only; no IP-literal hosts (this also defeats the
 *     decimal / octal / hex spellings of 127.0.0.1, which the URL parser normalises to IP literals)
 *   - every resolved address must be public; the connection is PINNED to the address that was checked, so DNS
 *     rebinding between the check and the connect cannot redirect it
 *   - at most 3 redirects, each one re-validated from scratch
 *   - 10 s total, 5 s to connect; 2 MB body cap; an allowlist of textual content types
 *   - robots.txt is honoured; a named user agent identifies the fetcher
 *
 * Script is never executed and nothing is rendered: HTML becomes plain text by deterministic stripping.
 */

export const USER_AGENT = 'KachmoOutboundOS-EvidenceFetcher/1.0 (+human-invoked source verification; honours robots.txt)';
export const UA_TOKEN = 'kachmooutboundos-evidencefetcher';
export const LIMITS = { totalMs: 10_000, connectMs: 5_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3, maxTextChars: 262_144, robotsMaxBytes: 512 * 1024 } as const;
export const ALLOWED_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml'] as const;

export type FetchOutcome =
  | 'OK'
  | 'DNS_FAILED'
  | 'TIMEOUT'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'BLOCKED_PRIVATE_ADDRESS'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'ROBOTS_DISALLOWED'
  | 'TLS_ERROR'
  | 'INVALID_URL'
  | 'TOO_MANY_REDIRECTS'
  | 'NETWORK_ERROR';

export interface FetchResult {
  outcome: FetchOutcome;
  requestedUrl: string;
  finalUrl: string | null;
  redirectChain: string[];
  httpStatus: number | null;
  contentType: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  textContent: string | null;
  error: string | null;
}

// ── Address policy ───────────────────────────────────────────────────────────

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (can embed private IPv4)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Null when the address is a public unicast address; otherwise why it is refused. */
export function addressRefusal(address: string): string | null {
  const family = isIP(address);
  if (family === 0) return `not an IP address: ${address}`;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:xxxx:xxxx) is refused outright rather than unwrapped: no public site
  // needs it, and it is a classic way to smuggle a private IPv4 past a check. (It is not a BlockList subnet because
  // Node applies an ::ffff:0:0/96 rule to every plain IPv4 address as well.)
  if (family === 6 && /^(0{0,4}:){0,5}:?ffff:/i.test(address.replace(/^\[|\]$/g, ''))) return `resolves to an IPv4-mapped address (${address})`;
  if (blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')) return `resolves to a non-public address (${address})`;
  return null;
}

/** Null when the URL may be fetched at all; otherwise why not. Pure: no DNS. */
export function urlRefusal(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return `only http and https are fetched (got ${u.protocol})`;
  if (u.username || u.password) return 'URLs carrying credentials are never fetched';
  if (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80'))) return `non-default port ${u.port} refused`;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return 'IP-address hosts are never fetched; a prospect source is a named site';
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/i.test(host) || /^localhost$/i.test(host)) return `not a public host name (${host})`;
  return null;
}

// ── Transport (injectable, so the whole fetcher is testable offline) ─────────

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** The body exceeded the cap and was cut off. */
  truncated: boolean;
}

export interface FetchTransport {
  resolve(host: string): Promise<string[]>;
  /** GET `url`, connecting ONLY to `address`. Must not follow redirects and must stop reading after `maxBytes`. */
  get(url: URL, address: string, opts: { maxBytes: number; connectMs: number; signal: AbortSignal }): Promise<RawResponse>;
}

export const nodeTransport: FetchTransport = {
  async resolve(host) {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map(r => r.address);
  },
  get(url, address, opts) {
    return new Promise((resolveResponse, reject) => {
      const family = isIP(address);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'accept-encoding': 'identity' },
          // The pin: whatever the name resolves to NOW, the socket goes to the address that was checked.
          // Node calls lookup with { all: true } when happy-eyeballs is on, and expects an array back.
          lookup: ((_host: string, o: { all?: boolean }, cb: (err: Error | null, addr: unknown, fam?: number) => void) =>
            o?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
          signal: opts.signal,
          timeout: opts.connectMs,
          // TLS certificate verification stays ON (the default). SNI and the certificate check use the host name.
          servername: url.hostname,
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on('data', (c: Buffer) => {
            if (truncated) return;
            size += c.length;
            if (size > opts.maxBytes) {
              truncated = true;
              chunks.push(c.subarray(0, c.length - (size - opts.maxBytes)));
              res.destroy();
              resolveResponse({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            if (!truncated) resolveResponse({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated: false });
          });
          res.on('error', err => {
            if (!truncated) reject(err);
          });
        }
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      req.end();
    });
  },
};

// ── Text extraction ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™' };

/** HTML → plain text, deterministically. Scripts, styles and hidden templates are dropped, never run. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|nav|main|aside|blockquote|pre|table|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

/** Whitespace-insensitive, case-sensitive containment: the rule an excerpt must meet to count as verbatim. */
export const normalizeForMatch = (s: string) => s.replace(/\s+/g, ' ').trim();
export const containsVerbatim = (text: string, excerpt: string) => {
  const e = normalizeForMatch(excerpt);
  return e.length >= 8 && normalizeForMatch(text).includes(e);
};

// ── robots.txt ───────────────────────────────────────────────────────────────

/**
 * Whether robots.txt allows `path` for this fetcher. Honours the group for our user agent if one exists, otherwise
 * `*`. Longest matching rule wins; Allow wins a tie. `*` and `$` wildcards are supported.
 */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const ours = groups.find(g => g.agents.some(a => a !== '*' && UA_TOKEN.startsWith(a)));
  const group = ours ?? groups.find(g => g.agents.includes('*'));
  if (!group) return true;
  const matches = (pattern: string) => {
    const anchored = pattern.endsWith('$');
    const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
  };
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (!matches(r.pattern)) continue;
    if (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow)) best = { allow: r.allow, len: r.pattern.length };
  }
  return best ? best.allow : true;
}

// ── The fetch ────────────────────────────────────────────────────────────────

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function classifyError(e: unknown): FetchOutcome {
  const err = e as { code?: string; name?: string; message?: string };
  const code = err.code ?? '';
  if (err.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ABORT_ERR' || /timeout/i.test(err.message ?? '')) return 'TIMEOUT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA' || code === 'ESERVFAIL') return 'DNS_FAILED';
  if (/CERT|SSL|TLS|ERR_TLS|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|HOSTNAME_MISMATCH|ERR_SSL/i.test(code) || /certificate|tls|ssl/i.test(err.message ?? '')) return 'TLS_ERROR';
  return 'NETWORK_ERROR';
}

const fail = (requestedUrl: string, outcome: FetchOutcome, error: string, extra: Partial<FetchResult> = {}): FetchResult => ({
  outcome,
  requestedUrl,
  finalUrl: null,
  redirectChain: [],
  httpStatus: null,
  contentType: null,
  byteSize: null,
  contentSha256: null,
  textContent: null,
  error: error.slice(0, 500),
  ...extra,
});

/** Resolves a host and checks EVERY address it returns. A mixed answer is refused: rebinding tricks hide there. */
async function safeAddress(transport: FetchTransport, host: string): Promise<{ address: string } | { outcome: FetchOutcome; error: string }> {
  let addresses: string[];
  try {
    addresses = await transport.resolve(host);
  } catch (e) {
    return { outcome: 'DNS_FAILED', error: `could not resolve ${host}: ${(e as Error).message}` };
  }
  if (!addresses.length) return { outcome: 'DNS_FAILED', error: `${host} has no addresses` };
  for (const a of addresses) {
    const refusal = addressRefusal(a);
    if (refusal) return { outcome: 'BLOCKED_PRIVATE_ADDRESS', error: `${host} ${refusal}` };
  }
  return { address: addresses[0] };
}

export interface FetchOptions {
  transport?: FetchTransport;
  /** robots.txt bodies already fetched this run, keyed by origin. */
  robotsCache?: Map<string, string | null>;
}

/** One hop: validate, resolve, pin, GET. */
async function getOnce(transport: FetchTransport, url: URL, maxBytes: number, signal: AbortSignal): Promise<RawResponse | { outcome: FetchOutcome; error: string }> {
  const refusal = urlRefusal(url.toString());
  if (refusal) return { outcome: refusal.startsWith('IP-address') || refusal.startsWith('not a public host') ? 'BLOCKED_PRIVATE_ADDRESS' : 'INVALID_URL', error: refusal };
  const pinned = await safeAddress(transport, url.hostname);
  if ('outcome' in pinned) return pinned;
  try {
    return await transport.get(url, pinned.address, { maxBytes, connectMs: LIMITS.connectMs, signal });
  } catch (e) {
    return { outcome: signal.aborted ? 'TIMEOUT' : classifyError(e), error: (e as Error).message ?? String(e) };
  }
}

/** robots.txt for an origin: null when there is none (4xx) — which allows everything — or the body. */
async function robotsFor(transport: FetchTransport, origin: URL, cache: Map<string, string | null>, signal: AbortSignal): Promise<string | null | { outcome: FetchOutcome; error: string }> {
  const key = origin.origin;
  if (cache.has(key)) return cache.get(key)!;
  const r = await getOnce(transport, new URL('/robots.txt', origin), LIMITS.robotsMaxBytes, signal);
  let body: string | null;
  if ('outcome' in r) {
    // No robots.txt reachable at all is not permission to crawl something we could not even ask about.
    if (r.outcome === 'DNS_FAILED' || r.outcome === 'BLOCKED_PRIVATE_ADDRESS' || r.outcome === 'TLS_ERROR') return r;
    body = null;
  } else if (r.status >= 500) {
    // A server error on robots.txt is treated as "disallow everything", as major crawlers do.
    body = 'User-agent: *\nDisallow: /';
  } else if (r.status >= 300) {
    body = null; // missing, forbidden or redirected robots.txt → no rules
  } else {
    body = r.body.toString('utf-8');
  }
  cache.set(key, body);
  return body;
}

export async function fetchSource(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const transport = opts.transport ?? nodeTransport;
  const robotsCache = opts.robotsCache ?? new Map<string, string | null>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.totalMs);
  const chain: string[] = [];
  try {
    const first = urlRefusal(rawUrl);
    if (first) return fail(rawUrl, first.startsWith('IP-address') || first.startsWith('not a public host') ? 'BLOCKED_PRIVATE_ADDRESS' : 'INVALID_URL', first);
    let url = new URL(rawUrl);
    url.hash = '';

    for (let hop = 0; ; hop++) {
      const robots = await robotsFor(transport, url, robotsCache, controller.signal);
      if (robots && typeof robots === 'object') return fail(rawUrl, robots.outcome, robots.error, { redirectChain: chain });
      if (typeof robots === 'string' && !robotsAllows(robots, `${url.pathname}${url.search}`)) {
        return fail(rawUrl, 'ROBOTS_DISALLOWED', `robots.txt at ${url.origin} disallows ${url.pathname}`, { redirectChain: chain });
      }

      const r = await getOnce(transport, url, LIMITS.maxBytes, controller.signal);
      if ('outcome' in r) return fail(rawUrl, r.outcome, r.error, { redirectChain: chain });

      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        if (hop >= LIMITS.maxRedirects) return fail(rawUrl, 'TOO_MANY_REDIRECTS', `more than ${LIMITS.maxRedirects} redirects`, { redirectChain: chain, httpStatus: r.status });
        const next = new URL(String(r.headers.location), url);
        next.hash = '';
        chain.push(next.toString());
        url = next;
        continue;
      }
      if (r.status >= 400) return fail(rawUrl, r.status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX', `HTTP ${r.status}`, { redirectChain: chain, httpStatus: r.status, finalUrl: url.toString() });
      if (r.status < 200 || r.status >= 300) return fail(rawUrl, 'NETWORK_ERROR', `unexpected HTTP ${r.status}`, { redirectChain: chain, httpStatus: r.status, finalUrl: url.toString() });
      if (r.truncated) return fail(rawUrl, 'TOO_LARGE', `the page is larger than ${LIMITS.maxBytes} bytes`, { redirectChain: chain, httpStatus: r.status, finalUrl: url.toString() });

      const contentType = String(r.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
        return fail(rawUrl, 'UNSUPPORTED_TYPE', `content type "${contentType || 'none'}" is not a readable page`, { redirectChain: chain, httpStatus: r.status, finalUrl: url.toString(), contentType });
      }
      const raw = r.body.toString('utf-8');
      const text = (contentType === 'text/plain' ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ') : htmlToText(raw)).slice(0, LIMITS.maxTextChars);
      return {
        outcome: 'OK',
        requestedUrl: rawUrl,
        finalUrl: url.toString(),
        redirectChain: chain,
        httpStatus: r.status,
        contentType,
        byteSize: r.body.length,
        contentSha256: sha256(r.body),
        textContent: text,
        error: null,
      };
    }
  } catch (e) {
    return fail(rawUrl, controller.signal.aborted ? 'TIMEOUT' : classifyError(e), (e as Error).message ?? String(e), { redirectChain: chain });
  } finally {
    clearTimeout(timer);
  }
}
