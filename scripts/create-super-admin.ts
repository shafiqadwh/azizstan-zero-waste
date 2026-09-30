/**
 * Create the first super admin, or reset an existing one's password (06-auth, 14-deployment step 5).
 *   pnpm user:super-admin [--username superadmin] [--name "ผู้ดูแลระบบ"]
 *   container: docker compose -f deploy/docker-compose.yml run --rm app node scripts/create-super-admin.js
 * The password is read from ZW_SUPER_ADMIN_PASSWORD, or asked twice on the terminal (not echoed).
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createDb } from '../db/client.ts';
import { upsertSuperAdmin } from '../src/server/services/auth.service.ts';

type MutableRl = { _writeToOutput: (s: string) => void };

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const internal = rl as unknown as MutableRl;
    const write = internal._writeToOutput.bind(rl);
    internal._writeToOutput = (s: string) => write(s.startsWith(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      username: { type: 'string', default: 'superadmin' },
      name: { type: 'string', default: 'ผู้ดูแลระบบสูงสุด' },
    },
  });
  let password = process.env.ZW_SUPER_ADMIN_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY) throw new Error('No terminal: set ZW_SUPER_ADMIN_PASSWORD or run with -it');
    password = await askHidden('New password (min 8 characters): ');
    const again = await askHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match');
  }
  const { db, close } = createDb();
  try {
    const outcome = await upsertSuperAdmin(
      db,
      { username: values.username, displayName: values.name, password },
      new Date(),
    );
    console.log(`super admin "${values.username}" ${outcome}`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
