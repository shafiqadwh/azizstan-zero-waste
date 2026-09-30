/**
 * Dev seed (docs/03-database.md §5). Idempotent: every insert is keyed on a natural unique key and skips rows
 * that already exist, so running it twice leaves the same data.
 * Usage: DATABASE_URL=… pnpm db:seed
 *
 * Users are created without a password (must_change_password = true); set one with
 * scripts/create-super-admin.js once T10 lands. Students are fake — never seed real student data.
 */
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { classLookupKey } from '../src/lib/scoring/classKey.ts';
import { newId } from '../src/lib/ids.ts';
import { createDb, type Db } from './client.ts';
import * as s from './schema.ts';
import { SEED_CLASSES, SEED_ZONES } from './seed-data.ts';

const TERM = { academicYear: 2569, termNo: 2, startDate: '2026-11-01' };
const ROUNDS = [
  { roundNo: 1, opensAt: '2026-11-16T08:00:00+07:00', closesAt: '2026-11-20T16:30:00+07:00' },
  { roundNo: 2, opensAt: '2026-12-14T08:00:00+07:00', closesAt: '2026-12-18T16:30:00+07:00' },
  { roundNo: 3, opensAt: '2027-01-18T08:00:00+07:00', closesAt: '2027-01-22T16:30:00+07:00' },
];
const USERS: { username: string; displayName: string; role: 'super_admin' | 'admin' | 'executive' }[] = [
  { username: 'superadmin', displayName: 'ผู้ดูแลระบบสูงสุด', role: 'super_admin' },
  { username: 'admin1', displayName: 'แอดมิน 1', role: 'admin' },
  { username: 'admin2', displayName: 'แอดมิน 2', role: 'admin' },
  { username: 'exec1', displayName: 'ผู้บริหาร 1', role: 'executive' },
  { username: 'exec2', displayName: 'ผู้บริหาร 2', role: 'executive' },
  { username: 'exec3', displayName: 'ผู้บริหาร 3', role: 'executive' },
];
const BUILDINGS = 8;
const FLOORS = 3;
const ROOMS_PER_FLOOR = 4;
const FAKE_STUDENTS = 200;

export async function seed(db: Db) {
  await db.transaction(async (tx) => {
    // Users
    await tx
      .insert(s.users)
      .values(USERS.map((u) => ({ id: newId(), ...u, mustChangePassword: true })))
      .onConflictDoNothing();

    // Term 2/2569: building mode, group scoring, decimal step 0.5, room 5 + building 10 = 15
    await tx
      .insert(s.terms)
      .values({
        id: newId(),
        academicYear: TERM.academicYear,
        termNo: TERM.termNo,
        status: 'active',
        areaType: 'building',
        roomMode: 'group',
        areaMode: 'group',
        scoreFormat: 'decimal',
        scoreStep: '0.500',
        finalMax: '15.000',
      })
      .onConflictDoNothing();
    const [term] = await tx
      .select({ id: s.terms.id })
      .from(s.terms)
      .where(and(eq(s.terms.academicYear, TERM.academicYear), eq(s.terms.termNo, TERM.termNo)));
    if (!term) throw new Error('seed: term missing after insert');

    await tx
      .insert(s.scoreComponents)
      .values([
        {
          id: newId(),
          termId: term.id,
          key: 'room',
          label: 'คะแนนห้อง',
          unit: 'class',
          maxValue: '5.000',
          requiresSignature: true,
          sortOrder: 1,
        },
        {
          id: newId(),
          termId: term.id,
          key: 'area',
          label: 'คะแนนอาคาร',
          unit: 'area',
          maxValue: '10.000',
          requiresSignature: false,
          sortOrder: 2,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(s.rounds)
      .values(
        ROUNDS.map((r) => ({
          id: newId(),
          termId: term.id,
          roundNo: r.roundNo,
          opensAt: new Date(r.opensAt),
          closesAt: new Date(r.closesAt),
        })),
      )
      .onConflictDoNothing();

    // Areas: 8 buildings and zones A–Y (zones are used by zone-mode terms)
    await tx
      .insert(s.areas)
      .values([
        ...Array.from({ length: BUILDINGS }, (_, i) => ({
          id: newId(),
          type: 'building' as const,
          code: String(i + 1),
          name: `อาคาร ${i + 1}`,
          sortOrder: i + 1,
        })),
        ...SEED_ZONES.map((z, i) => ({
          id: newId(),
          type: 'zone' as const,
          code: z.code,
          name: `โซน ${z.code}`,
          description: z.description,
          sortOrder: i + 1,
        })),
      ])
      .onConflictDoNothing();
    const buildings = await tx
      .select({ id: s.areas.id, code: s.areas.code })
      .from(s.areas)
      .where(eq(s.areas.type, 'building'));
    const buildingId = new Map(buildings.map((b) => [b.code, b.id]));

    // Physical rooms 1xx…8xx: room number = building, floor, room (121 = building 1, floor 2, room 1)
    const roomRows = [];
    for (let b = 1; b <= BUILDINGS; b++) {
      for (let f = 1; f <= FLOORS; f++) {
        for (let r = 1; r <= ROOMS_PER_FLOOR; r++) {
          roomRows.push({
            id: newId(),
            buildingId: buildingId.get(String(b))!,
            roomNumber: `${b}${f}${r}`,
            floor: f,
            qrToken: randomBytes(16).toString('base64url'),
          });
        }
      }
    }
    await tx.insert(s.physicalRooms).values(roomRows).onConflictDoNothing({ target: s.physicalRooms.roomNumber });
    const rooms = await tx
      .select({ id: s.physicalRooms.id, roomNumber: s.physicalRooms.roomNumber })
      .from(s.physicalRooms)
      .orderBy(s.physicalRooms.roomNumber);

    // Classes + aliases
    await tx
      .insert(s.classes)
      .values(
        SEED_CLASSES.map((c) => ({
          id: newId(),
          track: c.track,
          gradeCode: c.gradeCode,
          gradeLabel: c.gradeLabel,
          rankGroup: c.rankGroup,
          roomNo: c.roomNo,
          name: c.name,
          displayName: c.displayName,
        })),
      )
      .onConflictDoNothing();
    const classes = await tx
      .select({ id: s.classes.id, track: s.classes.track, gradeCode: s.classes.gradeCode, name: s.classes.name })
      .from(s.classes);
    const classId = new Map(classes.map((c) => [`${c.track}|${c.gradeCode}|${c.name}`, c.id]));
    const seedIds = SEED_CLASSES.map((c) => classId.get(`${c.track}|${c.gradeCode}|${c.name}`)!);

    await tx
      .insert(s.classAliases)
      .values(
        SEED_CLASSES.flatMap((c, i) =>
          c.sourceStrings.map((str) => ({ id: newId(), classId: seedIds[i]!, alias: classLookupKey(str)! })),
        ),
      )
      .onConflictDoNothing();

    // Class ↔ room links: class n → room n, from the term start; only for classes that have no link yet
    const linked = new Set(
      (
        await tx
          .select({ classId: s.classRoomLinks.classId })
          .from(s.classRoomLinks)
          .where(inArray(s.classRoomLinks.classId, seedIds))
      ).map((l) => l.classId),
    );
    const links = seedIds
      .map((id, i) => ({ id: newId(), classId: id, physicalRoomId: rooms[i]!.id, effectiveFrom: TERM.startDate }))
      .filter((l) => !linked.has(l.classId));
    if (links.length > 0) await tx.insert(s.classRoomLinks).values(links);

    // Every seeded class takes part in the seed term (FR-P7)
    await tx
      .insert(s.termClasses)
      .values(seedIds.map((id) => ({ termId: term.id, classId: id })))
      .onConflictDoNothing();

    // Fake students spread over the classes (codes S00001…; names are obviously fake)
    const deleteAfter = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    await tx
      .insert(s.students)
      .values(
        Array.from({ length: FAKE_STUDENTS }, (_, i) => {
          const c = SEED_CLASSES[i % SEED_CLASSES.length]!;
          const id = seedIds[i % seedIds.length]!;
          const religious = c.track === 'religious';
          return {
            id: newId(),
            studentCode: `S${String(i + 1).padStart(5, '0')}`,
            fullName: `นักเรียนทดสอบ ${String(i + 1).padStart(3, '0')}`,
            generalClassId: religious ? null : id,
            religiousClassId: religious ? id : null,
            homeClassId: id,
            deleteAfter,
          };
        }),
      )
      .onConflictDoNothing();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') {
    console.error('db:seed creates fake data and must not run in production');
    process.exit(1);
  }
  const { db, close } = createDb();
  seed(db)
    .then(() => console.log('seed done'))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(close);
}
