import { hash, verify } from '@node-rs/argon2';

/** 06-auth §1.1: argon2id, m = 19 MiB, t = 2, p = 1. */
const OPTIONS = {
  algorithm: 2 /* Algorithm.Argon2id (const enum) */,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash
  }
}

/** A real hash of a random value, verified when the username does not exist so timing does not reveal it. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  await verifyPassword(await dummyHash, password);
  return false;
}
