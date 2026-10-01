'use client';

import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'error';

const toKey = (base64: string) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/**
 * 11-jobs §3: "เปิดการแจ้งเตือน" — permission is asked only after this tap, never on page load.
 * Registers `/sw.js`, subscribes with the VAPID public key and stores the subscription for this user.
 */
export function PushControls({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<State>('loading');
  useEffect(() => {
    const check = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
        return setState('unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration('/');
      setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    };
    void check().catch(() => setState('unsupported'));
  }, []);

  const enable = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'denied' : 'off');
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidKey) }));
      const res = await fetch('/api/v1/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      setState(res.ok ? 'on' : 'error');
    } catch {
      setState('error');
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/v1/push/subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState('off');
  };

  if (state === 'loading' || state === 'unsupported') return null;
  const cls =
    'inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium';
  if (state === 'denied')
    return (
      <p className="text-[13px] text-ink-muted">การแจ้งเตือนถูกปิดในเบราว์เซอร์ เปิดได้ที่การตั้งค่าของเว็บไซต์</p>
    );
  return state === 'on' ? (
    <button type="button" onClick={() => void disable()} className={cls}>
      <BellOff size={16} aria-hidden /> ปิดการแจ้งเตือนในเครื่องนี้
    </button>
  ) : (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => void enable()} className={cls}>
        <Bell size={16} aria-hidden /> เปิดการแจ้งเตือน
      </button>
      {state === 'error' ? (
        <span role="alert" className="text-[13px] text-danger-ink">
          เปิดการแจ้งเตือนไม่สำเร็จ ลองใหม่อีกครั้ง
        </span>
      ) : null}
    </span>
  );
}
