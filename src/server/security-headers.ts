/**
 * HTTP security headers (12-security §2 item 1). Static headers are set for every response in next.config.ts;
 * the CSP carries a per-request nonce and is set by src/proxy.ts on page responses.
 */

/**
 * - scripts: only Next.js's own, which carry the nonce ('strict-dynamic' lets them load their chunks);
 * - styles: 'unsafe-inline' for React `style` attributes (no user content is ever put in a style);
 * - images: self + blob:/data: (camera previews before upload);
 * - PDFs open in their own tab (same origin); nothing may frame the app.
 * Dev mode adds 'unsafe-eval' (React's dev tooling); production never does.
 */
export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'self'`,
    `frame-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/** Applied to every response (pages, API, files) through next.config.ts `headers()`. */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];
