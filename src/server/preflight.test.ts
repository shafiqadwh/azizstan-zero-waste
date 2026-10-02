import { describe, expect, it } from 'vitest';
import { checkEnv, hasErrors } from './preflight.ts';

const good = {
  APP_URL: 'https://zerowaste.azizstan.net',
  SESSION_SECRET: 'x'.repeat(64),
  INTERNAL_PDF_SECRET: 'y'.repeat(44),
  POSTGRES_PASSWORD: 'a-real-password',
  DATABASE_URL: 'postgres://zw:a-real-password@db:5432/zw',
  STUDENT_API_BASE: 'https://azizstan.net/StudentCareV4/students',
  STUDENT_API_TOKEN: 'rotated-token',
  PP5_ALLOWED_CIDRS: '192.168.1.20/32',
  VAPID_PUBLIC_KEY: 'pub',
  VAPID_PRIVATE_KEY: 'priv',
  VAPID_SUBJECT: 'mailto:it@azizstan.ac.th',
  CLOUDFLARE_TUNNEL_TOKEN: 't',
  COMPOSE_PROFILES: 'tunnel',
  DATA_DIR: '/data',
};
const level = (env: Record<string, string>, key: string) => checkEnv(env).find((f) => f.key === key)?.level;

describe('go-live preflight (14-deployment)', () => {
  it('passes a filled-in production .env (the token rotation is a reminder, not an error)', () => {
    const f = checkEnv(good);
    expect(hasErrors(f)).toBe(false);
    expect(f.filter((x) => x.level === 'warn').map((x) => x.key)).toEqual(['STUDENT_API_TOKEN']);
  });

  it('rejects the .env.example placeholders', () => {
    const example = {
      ...good,
      POSTGRES_PASSWORD: 'change-me',
      SESSION_SECRET: 'generate-64-random-bytes-base64',
      STUDENT_API_TOKEN: 'put-the-rotated-token-here',
    };
    expect(level(example, 'POSTGRES_PASSWORD')).toBe('error');
    expect(level(example, 'SESSION_SECRET')).toBe('error');
    expect(level(example, 'STUDENT_API_TOKEN')).toBe('error');
  });

  it('APP_URL must be https, not localhost, without a trailing path', () => {
    expect(level({ ...good, APP_URL: '' }, 'APP_URL')).toBe('error');
    expect(level({ ...good, APP_URL: 'http://zerowaste.azizstan.net' }, 'APP_URL')).toBe('error');
    expect(level({ ...good, APP_URL: 'https://localhost' }, 'APP_URL')).toBe('error');
    expect(level({ ...good, APP_URL: 'https://zerowaste.azizstan.net/' }, 'APP_URL')).toBe('warn');
  });

  it('PP5_ALLOWED_CIDRS: required, valid, and narrower than the example ranges', () => {
    expect(level({ ...good, PP5_ALLOWED_CIDRS: '' }, 'PP5_ALLOWED_CIDRS')).toBe('error');
    expect(level({ ...good, PP5_ALLOWED_CIDRS: '192.168.1/24' }, 'PP5_ALLOWED_CIDRS')).toBe('error');
    expect(level({ ...good, PP5_ALLOWED_CIDRS: '10.0.0.0/8,172.16.0.0/12' }, 'PP5_ALLOWED_CIDRS')).toBe('warn');
  });

  it('push keys come in pairs; none just turns phone notifications off', () => {
    expect(level({ ...good, VAPID_PRIVATE_KEY: '' }, 'VAPID_PRIVATE_KEY')).toBe('error');
    expect(level({ ...good, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }, 'VAPID_PUBLIC_KEY')).toBe('warn');
  });

  it('Cloudflare Tunnel: the token and the "tunnel" compose profile go together', () => {
    expect(level({ ...good, CLOUDFLARE_TUNNEL_TOKEN: '' }, 'CLOUDFLARE_TUNNEL_TOKEN')).toBe('error');
    expect(level({ ...good, COMPOSE_PROFILES: '' }, 'COMPOSE_PROFILES')).toBe('warn');
    expect(level({ ...good, CLOUDFLARE_TUNNEL_TOKEN: '', COMPOSE_PROFILES: '' }, 'CLOUDFLARE_TUNNEL_TOKEN')).toBe(
      'warn',
    );
  });
});
