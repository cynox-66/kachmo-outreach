/**
 * Kachmo Outbound OS — Next.js configuration.
 * Private internal application: no indexing, strict security headers, no framework fingerprint.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The turbopack root encloses ../core, because server components import the domain engine at runtime.
  turbopack: { root: resolve(dirname(fileURLToPath(import.meta.url)), '..') },
  // The domain engine is a real package (@kachmo/core -> ../core) rather than a pile of "../../../core" hops.
  // It resolves to core/dist (emitted ESM) at runtime and to the TypeScript sources for types: Turbopack will not
  // map core's NodeNext ".js" specifiers onto ".ts" files, so the app consumes compiled output. `npm run build`
  // rebuilds core first, so a stale dist can never reach a build.
  experimental: { externalDir: true },
  // node-postgres must stay a real Node dependency, not be bundled.
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // TODO (hardening): replace 'unsafe-inline' with per-request nonces for Next's inline bootstrap.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
