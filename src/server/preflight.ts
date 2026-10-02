/**
 * Go-live preflight (14-deployment §2 step 0): checks a production `.env` before the stack is started, so a
 * forgotten placeholder never reaches the school. Pure — the script (`scripts/preflight.ts`) adds the database
 * and disk checks and prints the result.
 */
import { inCidr, parseCidrs } from '../lib/net/cidr.ts';

export type Level = 'ok' | 'warn' | 'error';

export interface Finding {
  level: Level;
  key: string;
  message: string;
}

type Env = Record<string, string | undefined>;

/** Values copied from `.env.example` that must never reach production. */
const PLACEHOLDERS = [
  'change-me',
  'generate-64-random-bytes-base64',
  'generate-32-random-bytes-base64',
  'put-the-rotated-token-here',
];
const isPlaceholder = (v: string) => PLACEHOLDERS.some((p) => v.includes(p));

/** The four private ranges `.env.example` ships with: fine for testing, too wide for the ปพ.5 machine. */
const WIDE_DEFAULTS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

const cidrValid = (c: string) => {
  const [base] = c.split('/');
  return !!base && inCidr(base, c);
};

export function checkEnv(env: Env): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, key: string, message: string) => out.push({ level, key, message });
  const get = (k: string) => (env[k] ?? '').trim();

  // APP_URL: printed on QR sheets and in every notification link
  const appUrl = get('APP_URL');
  let url: URL | null = null;
  try {
    url = appUrl ? new URL(appUrl) : null;
  } catch {
    url = null;
  }
  if (!url) add('error', 'APP_URL', 'ยังไม่ได้ตั้ง หรือไม่ใช่ URL ที่ถูกต้อง (QR และลิงก์แจ้งเตือนใช้ค่านี้)');
  else if (url.protocol !== 'https:') add('error', 'APP_URL', 'ต้องเป็น https://');
  else if (['localhost', '127.0.0.1'].includes(url.hostname))
    add('error', 'APP_URL', 'ยังชี้ไปที่ localhost — พิมพ์ QR แล้วจะสแกนไม่ได้');
  else if (url.pathname !== '/' || appUrl.endsWith('/'))
    add('warn', 'APP_URL', 'ไม่ควรมี / หรือ path ต่อท้าย (เช่น https://zerowaste.azizstan.net)');
  else add('ok', 'APP_URL', appUrl);

  for (const [key, min] of [
    ['SESSION_SECRET', 32],
    ['INTERNAL_PDF_SECRET', 24],
  ] as const) {
    const v = get(key);
    if (!v) add('error', key, 'ยังไม่ได้ตั้ง');
    else if (isPlaceholder(v)) add('error', key, 'ยังเป็นค่าตัวอย่างจาก .env.example — สร้างค่าสุ่มใหม่');
    else if (v.length < min) add('error', key, `สั้นเกินไป (อย่างน้อย ${min} ตัวอักษร)`);
    else add('ok', key, 'ตั้งแล้ว');
  }

  const dbUrl = get('DATABASE_URL');
  const pgPassword = get('POSTGRES_PASSWORD');
  if (!dbUrl) add('error', 'DATABASE_URL', 'ยังไม่ได้ตั้ง');
  else if (isPlaceholder(dbUrl) || isPlaceholder(pgPassword))
    add('error', 'POSTGRES_PASSWORD', 'ยังเป็นรหัสผ่านตัวอย่าง change-me');
  else add('ok', 'DATABASE_URL', 'ตั้งแล้ว');

  // Q14: the student API token must be rotated before production
  const token = get('STUDENT_API_TOKEN');
  if (!token) add('error', 'STUDENT_API_TOKEN', 'ยังไม่ได้ตั้ง — ซิงก์รายชื่อนักเรียนจะไม่ทำงาน');
  else if (isPlaceholder(token)) add('error', 'STUDENT_API_TOKEN', 'ยังเป็นค่าตัวอย่าง');
  else
    add(
      'warn',
      'STUDENT_API_TOKEN',
      'ตรวจด้วยตัวเองว่าเป็น token ใหม่ที่เปลี่ยน (rotate) แล้ว ไม่ใช่ token เดิมที่เคยแชร์ (Q14)',
    );
  const studentBase = get('STUDENT_API_BASE');
  if (!studentBase) add('error', 'STUDENT_API_BASE', 'ยังไม่ได้ตั้ง');
  else if (!studentBase.startsWith('https://')) add('warn', 'STUDENT_API_BASE', 'ควรเป็น https://');

  // ปพ.5 allow-list (12-security §2a)
  const cidrs = parseCidrs(env.PP5_ALLOWED_CIDRS);
  const bad = cidrs.filter((c) => !cidrValid(c));
  if (cidrs.length === 0) add('error', 'PP5_ALLOWED_CIDRS', 'ยังไม่ได้ตั้ง — ระบุ IP ของเครื่องโปรแกรม ปพ.5');
  else if (bad.length) add('error', 'PP5_ALLOWED_CIDRS', `รูปแบบไม่ถูกต้อง: ${bad.join(', ')}`);
  else if (cidrs.some((c) => WIDE_DEFAULTS.includes(c)))
    add(
      'warn',
      'PP5_ALLOWED_CIDRS',
      'ยังเปิดทั้งวงเครือข่ายภายใน — ควรจำกัดเฉพาะ IP ของเครื่อง ปพ.5 (เช่น 192.168.1.20/32)',
    );
  else add('ok', 'PP5_ALLOWED_CIDRS', cidrs.join(', '));

  // web push is optional, but half a key pair is a mistake
  const pub = get('VAPID_PUBLIC_KEY');
  const priv = get('VAPID_PRIVATE_KEY');
  if (!!pub !== !!priv) add('error', 'VAPID_PRIVATE_KEY', 'ต้องตั้งทั้ง VAPID_PUBLIC_KEY และ VAPID_PRIVATE_KEY คู่กัน');
  else if (!pub)
    add('warn', 'VAPID_PUBLIC_KEY', 'ไม่ได้ตั้ง — ปิดการแจ้งเตือนบนมือถือ (กล่องแจ้งเตือนในระบบยังใช้ได้)');
  else if (get('VAPID_SUBJECT').includes('example.com'))
    add('warn', 'VAPID_SUBJECT', 'ยังเป็น admin@example.com — ใส่อีเมลของโรงเรียน');
  else add('ok', 'VAPID_PUBLIC_KEY', 'ตั้งแล้ว');

  if (!get('CLOUDFLARE_TUNNEL_TOKEN'))
    add('warn', 'CLOUDFLARE_TUNNEL_TOKEN', 'ไม่ได้ตั้ง — ภายนอกโรงเรียนจะเข้าเว็บไม่ได้ ถ้าไม่ได้ใช้ช่องทางอื่น');
  if (!get('DATA_DIR')) add('error', 'DATA_DIR', 'ยังไม่ได้ตั้ง (รูปและ PDF เก็บที่นี่)');
  if (!get('TEACHER_AUTH_URL')) add('ok', 'TEACHER_AUTH_URL', 'ไม่ได้ตั้ง — ใช้บัญชีในระบบเท่านั้น (T33 รอสเปก API)');
  return out;
}

export const hasErrors = (f: readonly Finding[]) => f.some((x) => x.level === 'error');
