import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './src/server/security-headers';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Chromium driver for the on-demand signature sheet PDF (09-pdf §3): load it from node_modules, never bundle it
  serverExternalPackages: ['playwright-core'],
  async headers() {
    return [{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }];
  },
};

export default nextConfig;
