import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { plexThai } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'AZIZSTAN ZERO WASTE',
  description: 'ระบบประเมินความสะอาดห้องเรียนและพื้นที่ โรงเรียนมูลนิธิอาซิซสถาน',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'ZERO WASTE', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#1D6A4E',
  width: 'device-width',
  initialScale: 1,
};

/** Every page renders per request: the CSP nonce (src/proxy.ts) must reach Next.js's inline scripts. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="th" className={plexThai.variable}>
      <body>{children}</body>
    </html>
  );
}
