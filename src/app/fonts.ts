import localFont from 'next/font/local';

/** IBM Plex Sans Thai (UI font), self-hosted from /fonts — the server may not reach Google (AGENTS §3). */
export const plexThai = localFont({
  src: [
    { path: '../../fonts/ibm-plex-sans-thai/IBMPlexSansThai-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-thai/IBMPlexSansThai-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-thai/IBMPlexSansThai-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../../fonts/ibm-plex-sans-thai/IBMPlexSansThai-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-thai',
  display: 'swap',
  fallback: ['Tahoma', 'sans-serif'],
});
