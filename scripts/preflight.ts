/**
 * Go-live preflight (14-deployment §2 step 0): checks `.env`, the data directory and the database before the
 * school starts using the system. Exit code 1 when anything blocking is found.
 *   local:     node --env-file=.env scripts/preflight.ts        (or: pnpm preflight)
 *   container: docker compose -f deploy/docker-compose.yml run --rm app node scripts/preflight.js
 */
import { access, constants, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDb } from '../db/client.ts';
import { checkEnv, hasErrors, type Finding } from '../src/server/preflight.ts';

const ICON = { ok: '✓', warn: '!', error: '✗' } as const;

// Not imported from db/migrate.ts: bundled, that module would run the migrations itself (it checks argv[1]).
const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

async function runtimeChecks(env: NodeJS.ProcessEnv, now: Date): Promise<Finding[]> {
  const out: Finding[] = [];
  const dataDir = env.DATA_DIR;
  if (dataDir) {
    try {
      await access(dataDir, constants.W_OK);
      out.push({ level: 'ok', key: 'DATA_DIR', message: `${dataDir} เขียนได้` });
    } catch {
      out.push({ level: 'error', key: 'DATA_DIR', message: `${dataDir} ไม่มีหรือเขียนไม่ได้` });
    }
  }
  if (!env.DATABASE_URL) return out;
  const { db, close } = createDb(env.DATABASE_URL);
  try {
    const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
    const journal = JSON.parse(await readFile(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    const applied = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).catch(
      () => [{ n: 0 }],
    );
    const pending = journal.entries.length - (applied[0]?.n ?? 0);
    out.push(
      pending > 0
        ? {
            level: 'error',
            key: 'migrations',
            message: `ยังไม่ได้ migrate อีก ${pending} รายการ (node scripts/migrate.js)`,
          }
        : { level: 'ok', key: 'migrations', message: `ครบ ${journal.entries.length} รายการ` },
    );
    if (pending > 0) return out;

    const [admins] = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM users WHERE role = 'super_admin' AND is_active`,
    );
    out.push(
      admins!.n > 0
        ? { level: 'ok', key: 'super_admin', message: `${admins!.n} บัญชี` }
        : { level: 'error', key: 'super_admin', message: 'ยังไม่มี — สร้างด้วย node scripts/create-super-admin.js' },
    );

    const [term] = await rows<{ academic_year: number; term_no: number; auto_approve: boolean }>(
      sql`SELECT academic_year, term_no, auto_approve FROM terms WHERE status = 'active' LIMIT 1`,
    );
    out.push(
      term
        ? {
            level: 'ok',
            key: 'term',
            message: `ภาคเรียน ${term.term_no}/${term.academic_year} · อนุมัติอัตโนมัติ${term.auto_approve ? 'เปิด' : 'ปิด'}`,
          }
        : { level: 'warn', key: 'term', message: 'ยังไม่มีภาคเรียนที่เปิดใช้ — ตั้งค่าที่ /admin/settings/term' },
    );

    const [backup] = await rows<{ value: { at?: string } }>(
      sql`SELECT value FROM app_settings WHERE key = 'backup.last'`,
    );
    const at = backup?.value?.at ? new Date(backup.value.at) : null;
    out.push(
      !at
        ? { level: 'warn', key: 'backup', message: 'ยังไม่เคยสำรองข้อมูลสำเร็จ — ตั้ง cron ของ deploy/backup.sh' }
        : now.getTime() - at.getTime() > 26 * 3600_000
          ? { level: 'warn', key: 'backup', message: `สำรองล่าสุด ${at.toISOString()} เกิน 1 วันแล้ว` }
          : { level: 'ok', key: 'backup', message: `ล่าสุด ${at.toISOString()}` },
    );
  } catch (err) {
    out.push({ level: 'error', key: 'database', message: `เชื่อมต่อไม่ได้: ${(err as Error).message}` });
  } finally {
    await close();
  }
  return out;
}

async function main() {
  const findings = [...checkEnv(process.env), ...(await runtimeChecks(process.env, new Date()))];
  for (const f of findings) console.log(`${ICON[f.level]} ${f.key.padEnd(24)} ${f.message}`);
  const errors = findings.filter((f) => f.level === 'error').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  console.log(
    `\n${errors ? `✗ ต้องแก้ ${errors} รายการก่อนใช้งานจริง` : '✓ พร้อมใช้งาน'}${warns ? ` · ควรตรวจ ${warns} รายการ` : ''}`,
  );
  process.exit(hasErrors(findings) ? 1 : 0);
}

void main();
