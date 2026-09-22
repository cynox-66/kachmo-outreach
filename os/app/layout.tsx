import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

/*
 * Kachmo's display face (Cinzel Black), self-hosted exactly as the website does it: one weight, the OFL licence
 * committed beside the file (app/fonts/Cinzel-OFL.txt), no third-party request (CSP `font-src 'self'`). It is used for
 * the wordmark, page titles and the company name — nowhere else (docs/DESIGN_LANGUAGE.md §4).
 */
const display = localFont({
  src: './fonts/Cinzel-Black.ttf',
  weight: '900',
  style: 'normal',
  display: 'swap',
  variable: '--font-cinzel',
});

export const metadata: Metadata = {
  title: { default: 'Kachmo Outbound', template: '%s · Kachmo Outbound' },
  description: 'Private internal outreach workspace for Kachmo Studios.',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B0A09' },
    { media: '(prefers-color-scheme: light)', color: '#EDE9E0' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
