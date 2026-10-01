/**
 * Files under DATA_DIR (02-architecture §4): uploads/, pdf/, tmp/. Paths stored in the database are relative to
 * DATA_DIR so the volume can move. Writes go through a temp file + rename, so a crash never leaves half a file.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function dataDir(): string {
  // runtime location (a mounted volume), not a build input: keep Turbopack from tracing the whole project
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? './data');
}

/** Absolute path of a stored relative path; refuses anything that escapes DATA_DIR. */
export function resolveData(relative: string, root = dataDir()): string {
  const full = path.resolve(/*turbopackIgnore: true*/ root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`path escapes DATA_DIR: ${relative}`);
  return full;
}

export async function writeDataFile(relative: string, data: Uint8Array, root = dataDir()): Promise<void> {
  const full = resolveData(relative, root);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, full);
}

export async function dataFileExists(relative: string, root = dataDir()): Promise<boolean> {
  try {
    return (await stat(resolveData(relative, root))).isFile();
  } catch {
    return false;
  }
}

export async function removeDataFile(relative: string, root = dataDir()): Promise<void> {
  await rm(resolveData(relative, root), { force: true });
}
