/**
 * Kachmo Outbound OS — Next.js configuration.
 * Private internal application: no indexing, strict security headers, no framework fingerprint.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This package is the build root (the repository root has its own lockfile for the CLI engine).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // The domain engine lives outside this package (../core), imported directly rather than duplicated.
  // Note: os/ code uses extensionless relative imports, because Turbopack does not map NodeNext ".js" specifiers to
  // ".ts". When the app starts importing core/ at runtime, core/ needs a package entry point for the same reason.
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
