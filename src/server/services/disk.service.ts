/**
 * Disk space watch (14-deployment §4): the worker measures the filesystem under DATA_DIR every hour. At 80 % used
 * every admin gets one inbox notice per day until space is freed; the last reading shows on
 * /admin/settings/privacy. Photos, PDFs and the database share the machine's disk, and a full disk stops uploads.
 */
import { statfs } from 'node:fs/promises';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import * as evalRepo from '../repositories/evaluations.repository.ts';
import * as systemRepo from '../repositories/system.repository.ts';
import { dataDir } from '../storage.ts';
import { send } from './notify.service.ts';

export const DISK_QUEUE = 'disk.check';
export const DISK_ALERT_RATIO = 0.8;
export const DISK_KEY = 'disk.last';
const ALERTED_KEY = 'disk.alerted';

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedRatio: number;
}

export interface DiskReading extends DiskUsage {
  at: string;
}

export async function measureDisk(dir: string): Promise<DiskUsage> {
  const s = await statfs(dir);
  const totalBytes = s.blocks * s.bsize;
  // bavail: what an unprivileged process (the app user) can still write
  const freeBytes = s.bavail * s.bsize;
  return { totalBytes, freeBytes, usedRatio: totalBytes > 0 ? 1 - freeBytes / totalBytes : 0 };
}

export const formatGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Job `disk.check`: store the reading; notify admins once per Bangkok day while usage is at or over 80 %. */
export async function checkDisk(
  db: Db,
  now: Date,
  opts: { root?: string; measure?: (dir: string) => Promise<DiskUsage> } = {},
): Promise<{ usage: DiskUsage; alerted: boolean }> {
  const usage = await (opts.measure ?? measureDisk)(opts.root ?? dataDir());
  const reading: DiskReading = { ...usage, at: now.toISOString() };
  await systemRepo.writeSetting(db, DISK_KEY, reading, now);
  if (usage.usedRatio < DISK_ALERT_RATIO) return { usage, alerted: false };
  const today = bangkokDateString(now);
  if ((await systemRepo.readSetting(db, ALERTED_KEY)) === today) return { usage, alerted: false };
  await send(
    db,
    {
      userIds: await evalRepo.listAdminIds(db),
      type: 'disk_space',
      title: `พื้นที่ดิสก์ใกล้เต็ม (ใช้ไป ${formatPercent(usage.usedRatio)})`,
      body: `เหลือ ${formatGb(usage.freeBytes)} จาก ${formatGb(usage.totalBytes)} — ถ้าเต็ม ระบบจะรับรูปและสร้าง PDF ไม่ได้ ให้ผู้ดูแลเครื่องเพิ่มพื้นที่หรือลบไฟล์ที่ไม่ใช้`,
      link: '/admin/settings/privacy',
    },
    now,
  );
  await systemRepo.writeSetting(db, ALERTED_KEY, today, now);
  return { usage, alerted: true };
}

export async function readLastDisk(db: Db): Promise<DiskReading | null> {
  return (await systemRepo.readSetting(db, DISK_KEY)) as DiskReading | null;
}
