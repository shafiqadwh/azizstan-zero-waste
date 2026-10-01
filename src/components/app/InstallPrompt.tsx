'use client';

import { Share, SquarePlus, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'zw.installPrompt.dismissed';
const safeGet = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/**
 * 08-ux-ui §6.6: after login on a phone, a sheet "ติดตั้งแอปเพื่อรับการแจ้งเตือน". Android/Chrome gets the install
 * button (beforeinstallprompt); iOS Safari gets the three illustrated steps (push needs the home-screen app there).
 * "ไว้ทีหลัง" hides it on this device.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<'none' | 'android' | 'ios'>('none');
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || safeGet()) return;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    if (ios) {
      // after hydration, so the server HTML and the first client render agree
      const id = window.setTimeout(() => setMode('ios'), 0);
      return () => window.clearTimeout(id);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const later = () => {
    try {
      localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      /* private mode: just hide */
    }
    setMode('none');
  };

  if (mode === 'none') return null;
  return (
    <section
      aria-label="ติดตั้งแอป"
      className="rounded-[18px] border border-line bg-surface p-4"
      data-testid="install-prompt"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Smartphone size={18} aria-hidden /> ติดตั้งแอปเพื่อรับการแจ้งเตือน
      </p>
      {mode === 'ios' ? (
        <ol className="mt-2 flex flex-col gap-1.5 text-[14px]">
          <li className="flex items-center gap-2">
            <span className="font-bold">1.</span> แตะปุ่มแชร์ <Share size={16} aria-label="ปุ่มแชร์" />
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold">2.</span> เพิ่มไปยังหน้าจอโฮม <SquarePlus size={16} aria-hidden />
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold">3.</span> เปิดจากไอคอนบนหน้าจอโฮม
          </li>
        </ol>
      ) : null}
      <div className="mt-3 flex gap-2">
        {mode === 'android' && event ? (
          <button
            type="button"
            onClick={async () => {
              await event.prompt();
              await event.userChoice;
              setMode('none');
            }}
            className="h-10 rounded-[12px] bg-brand px-4 text-[14px] font-semibold text-white"
          >
            ติดตั้งแอป
          </button>
        ) : null}
        <button
          type="button"
          onClick={later}
          className="h-10 rounded-[12px] border border-line-strong px-4 text-[14px]"
        >
          ไว้ทีหลัง
        </button>
      </div>
    </section>
  );
}
