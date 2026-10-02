import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

/** Test users are created straight in the database (same argon2id parameters as the app). */
export async function createTestUser(opts: {
  role: 'super_admin' | 'admin' | 'executive' | 'teacher';
  password: string;
  mustChange?: boolean;
}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('e2e needs DATABASE_URL (migrated database)');
  const username = `e2e_${opts.role}_${randomBytes(4).toString('hex')}`;
  const passwordHash = await hash(opts.password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, username, display_name, role, auth_source, password_hash, must_change_password)
       VALUES (gen_random_uuid(), $1, $2, $3, 'local', $4, $5)`,
      [username, `ผู้ทดสอบ ${opts.role}`, opts.role, passwordHash, opts.mustChange ?? false],
    );
  } finally {
    await client.end();
  }
  return username;
}

/** An active term for pages that need one (idempotent; e2e projects run in parallel on one database). */
export async function ensureActiveTerm() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('e2e needs DATABASE_URL (migrated database)');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO terms (id, academic_year, term_no, status, area_type, final_max)
       VALUES (gen_random_uuid(), 2569, 2, 'active', 'building', 15) ON CONFLICT DO NOTHING`,
    );
  } finally {
    await client.end();
  }
}

/** A (year, term) pair not used yet. Parity keeps the two viewport projects (run in parallel) apart. */
export async function freeTermSlot(parity: 0 | 1) {
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ academic_year: number; term_no: number }>(
      'SELECT academic_year, term_no FROM terms',
    );
    const used = new Set(rows.map((r) => `${r.academic_year}/${r.term_no}`));
    for (let year = 2600 + parity; year <= 2700; year += 2) {
      for (const termNo of [1, 2, 3]) if (!used.has(`${year}/${termNo}`)) return { academicYear: year, termNo };
    }
    throw new Error('no free term slot');
  } finally {
    await client.end();
  }
}

/**
 * A draft building-mode term of its own (random high year, retried on conflict) with one new building and one
 * selected class, so coverage assertions never collide with other specs running in parallel.
 */
export async function seedCommitteeFixture() {
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const tag = randomBytes(3).toString('hex').toUpperCase();
  try {
    let termId: string | undefined;
    for (let i = 0; !termId && i < 50; i++) {
      const year = 2650 + Math.floor(Math.random() * 50);
      const termNo = 1 + Math.floor(Math.random() * 3);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO terms (id, academic_year, term_no, status, area_type, final_max)
         VALUES (gen_random_uuid(), $1, $2, 'draft', 'building', 15) ON CONFLICT DO NOTHING RETURNING id`,
        [year, termNo],
      );
      termId = rows[0]?.id;
    }
    if (!termId) throw new Error('no free term slot');
    const building = `อาคาร E2E ${tag}`;
    await client.query(
      `INSERT INTO areas (id, type, code, name, sort_order) VALUES (gen_random_uuid(), 'building', $1, $2, 900)`,
      [`Z${tag}`, building],
    );
    const className = `ม.C C${tag}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO classes (id, track, grade_code, grade_label, rank_group, room_no, name, display_name)
       VALUES (gen_random_uuid(), 'general', 'E2E-C', 'ม.C', 'ม.C', 0, $1, $2) RETURNING id`,
      [`C${tag}`, className],
    );
    await client.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, rows[0]!.id]);
    return { termId, building, className };
  } finally {
    await client.end();
  }
}

/** An open round in the fixture's term (status set directly; round_class_areas left empty → "ไม่มีพื้นที่"). */
export async function seedOpenRound(termId: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO rounds (id, term_id, round_no, opens_at, closes_at, status)
       VALUES (gen_random_uuid(), $1, 1, now() - interval '1 day', now() + interval '3 days', 'open') RETURNING id`,
      [termId],
    );
    return rows[0]!.id;
  } finally {
    await client.end();
  }
}

/** A class selected in the active term with a committee duty for `username` (for evidence uploads). */
export async function seedUploadFixture(username: string) {
  await ensureActiveTerm();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const tag = randomBytes(3).toString('hex').toUpperCase();
  try {
    const term = await client.query<{ id: string }>("SELECT id FROM terms WHERE status = 'active'");
    const user = await client.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
    const cls = await client.query<{ id: string }>(
      `INSERT INTO classes (id, track, grade_code, grade_label, rank_group, room_no, name, display_name)
       VALUES (gen_random_uuid(), 'general', 'E2E-U', 'ม.U', 'ม.U', 0, $1, $2) RETURNING id`,
      [`U${tag}`, `ม.U U${tag}`],
    );
    const termId = term.rows[0]!.id;
    const classId = cls.rows[0]!.id;
    await client.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, classId]);
    await client.query(
      `INSERT INTO duties (id, term_id, user_id, duty, target_type, target_class_id)
       VALUES (gen_random_uuid(), $1, $2, 'committee', 'class', $3)`,
      [termId, user.rows[0]!.id, classId],
    );
    return { classId };
  } finally {
    await client.end();
  }
}

/**
 * Journey 1 fixture: the active term with a "room" component and an open round 1; a new building, room and
 * class (frozen in the round) and a committee duty for `username`. Room numbers are random so specs never clash.
 */
export async function seedJourneyFixture(username: string, opts: { closedRound?: boolean } = {}) {
  const roundNo = opts.closedRound ? 2 : 1;
  await ensureActiveTerm();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const tag = randomBytes(3).toString('hex').toUpperCase();
  const roomNumber = `9${parseInt(tag, 16) % 100000}`;
  try {
    const termId = (await client.query<{ id: string }>("SELECT id FROM terms WHERE status = 'active'")).rows[0]!.id;
    await client.query(
      `INSERT INTO score_components (id, term_id, key, label, unit, source, kind, max_value, enabled, requires_signature, sort_order)
       VALUES (gen_random_uuid(), $1, 'room', 'คะแนนห้องเรียน', 'class', 'committee', 'score', 5, true, true, 1)
       ON CONFLICT DO NOTHING`,
      [termId],
    );
    // round 1 is open (journeys 1 and 4); round 2 has closed already ("time travel" for journey 3)
    const [opens, closes, status] = opts.closedRound
      ? ["now() - interval '5 days'", "now() - interval '1 day'", 'closed']
      : ["now() - interval '1 day'", "now() + interval '10 days'", 'open'];
    await client.query(
      `INSERT INTO rounds (id, term_id, round_no, opens_at, closes_at, status)
       VALUES (gen_random_uuid(), $1, $2, ${opens}, ${closes}, '${status}')
       ON CONFLICT (term_id, round_no) DO UPDATE SET status = '${status}', opens_at = ${opens}, closes_at = ${closes}`,
      [termId, roundNo],
    );
    const roundId = (
      await client.query<{ id: string }>('SELECT id FROM rounds WHERE term_id = $1 AND round_no = $2', [
        termId,
        roundNo,
      ])
    ).rows[0]!.id;
    const buildingId = (
      await client.query<{ id: string }>(
        `INSERT INTO areas (id, type, code, name, sort_order) VALUES (gen_random_uuid(), 'building', $1, $2, 950) RETURNING id`,
        [`J${tag}`, `อาคาร J${tag}`],
      )
    ).rows[0]!.id;
    const qrToken = `qr-${tag}-${randomBytes(6).toString('hex')}`;
    const roomId = (
      await client.query<{ id: string }>(
        `INSERT INTO physical_rooms (id, building_id, room_number, floor, qr_token)
         VALUES (gen_random_uuid(), $1, $2, 2, $3) RETURNING id`,
        [buildingId, roomNumber, qrToken],
      )
    ).rows[0]!.id;
    const classId = (
      await client.query<{ id: string }>(
        `INSERT INTO classes (id, track, grade_code, grade_label, rank_group, room_no, name, display_name)
         VALUES (gen_random_uuid(), 'general', 'E2E-J', 'ม.J', 'ม.J', 0, $1, $2) RETURNING id`,
        [`J${tag}`, `ม.J J${tag}`],
      )
    ).rows[0]!.id;
    await client.query(
      `INSERT INTO class_room_links (id, class_id, physical_room_id, effective_from) VALUES (gen_random_uuid(), $1, $2, '2020-01-01')`,
      [classId, roomId],
    );
    await client.query('INSERT INTO term_classes (term_id, class_id) VALUES ($1, $2)', [termId, classId]);
    await client.query(
      'INSERT INTO round_class_areas (round_id, class_id, area_id, physical_room_id) VALUES ($1, $2, $3, $4)',
      [roundId, classId, buildingId, roomId],
    );
    const userId = (await client.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])).rows[0]!
      .id;
    await client.query(
      `INSERT INTO duties (id, term_id, user_id, duty, target_type, target_class_id)
       VALUES (gen_random_uuid(), $1, $2, 'committee', 'class', $3)`,
      [termId, userId, classId],
    );
    const componentId = (
      await client.query<{ id: string }>("SELECT id FROM score_components WHERE term_id = $1 AND key = 'room'", [
        termId,
      ])
    ).rows[0]!.id;
    return { roomNumber, className: `ม.J J${tag}`, roundId, componentId, classId, userId, areaId: buildingId, qrToken };
  } finally {
    await client.end();
  }
}

/**
 * Specs share one active term, and the first evaluation locks its config (BR-TM2). Specs that submit
 * evaluations unlock it again; specs that edit the config unlock right before they do.
 */
export async function unlockActiveTerm() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query("UPDATE terms SET config_locked_at = NULL WHERE status = 'active'");
  } finally {
    await client.end();
  }
}

/**
 * Journey 4: an evaluation (4.5) by `userId` on the fixture's class whose 24 h self-edit window has already
 * passed ("time travel"), with 3 site photos and a signature sheet.
 */
export async function seedOldEvaluation(f: {
  roundId: string;
  componentId: string;
  classId: string;
  userId: string;
  roomNumber: string;
}) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO evaluations (id, round_id, component_id, target_type, target_class_id, owner_id, score, comment,
           room_number_at_eval, status, first_submitted_at, self_edit_until, last_edited_at, version)
         VALUES (gen_random_uuid(), $1, $2, 'class', $3, $4, 4.5, 'เดิม', $5, 'submitted',
           now() - interval '30 hours', now() - interval '6 hours', now() - interval '30 hours', 1)
         RETURNING id`,
        [f.roundId, f.componentId, f.classId, f.userId, f.roomNumber],
      )
    ).rows[0]!.id;
    for (const [i, kind] of ['site', 'site', 'site', 'signature'].entries()) {
      await client.query(
        `INSERT INTO evidence (id, evaluation_id, uploaded_by, kind, file_path, sha256, width, height, bytes, captured_at, sort_order)
         VALUES (gen_random_uuid(), $1, $2, $3, 'uploads/00/missing.webp', 'missing', 10, 10, 10, now(), $4)`,
        [id, f.userId, kind, i],
      );
    }
    return id;
  } finally {
    await client.end();
  }
}

/** T40: snapshot students (codes + a name that must never be shown) into the fixture class for its round. */
export async function seedRoster(f: { roundId: string; classId: string }, codes: string[]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    for (const code of codes) {
      const id = (
        await client.query<{ id: string }>(
          `INSERT INTO students (id, student_code, full_name, home_class_id, delete_after)
           VALUES (gen_random_uuid(), $1, $2, $3, current_date + 365) RETURNING id`,
          [code, `ชื่อลับ ${code}`, f.classId],
        )
      ).rows[0]!.id;
      await client.query('INSERT INTO roster_snapshots (round_id, student_id, class_id) VALUES ($1, $2, $3)', [
        f.roundId,
        id,
        f.classId,
      ]);
    }
  } finally {
    await client.end();
  }
}

/** T40: the shared active term's room mode (the "individual" project runs alone, after every other spec). */
export async function setRoomMode(mode: 'group' | 'individual') {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query("UPDATE terms SET room_mode = $1 WHERE status = 'active'", [mode]);
  } finally {
    await client.end();
  }
}

/**
 * T41: an enabled class-unit deduction by area teachers (max 3) on the shared active term, and an area_teacher
 * duty for `username` on `areaId`. Returns the component id; {@link disableDeduction} switches it off again.
 */
export async function seedDeduction(username: string, areaId: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    const termId = (await client.query<{ id: string }>("SELECT id FROM terms WHERE status = 'active'")).rows[0]!.id;
    const componentId = (
      await client.query<{ id: string }>(
        `INSERT INTO score_components (id, term_id, key, label, unit, source, kind, max_value, enabled, requires_signature, sort_order)
         VALUES (gen_random_uuid(), $1, 'e2e_deduct', 'หักคะแนนจากครูผู้รับผิดชอบ', 'class', 'area_teacher', 'deduct', 3, true, false, 9)
         ON CONFLICT (term_id, key) DO UPDATE SET enabled = true
         RETURNING id`,
        [termId],
      )
    ).rows[0]!.id;
    const userId = (await client.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])).rows[0]!
      .id;
    await client.query(
      `INSERT INTO duties (id, term_id, user_id, duty, target_type, target_area_id)
       VALUES (gen_random_uuid(), $1, $2, 'area_teacher', 'area', $3)`,
      [termId, userId, areaId],
    );
    return componentId;
  } finally {
    await client.end();
  }
}

export async function disableDeduction() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query(
      "UPDATE score_components SET enabled = false WHERE key = 'e2e_deduct' AND term_id = (SELECT id FROM terms WHERE status = 'active')",
    );
  } finally {
    await client.end();
  }
}

export async function setAutoApprove(enabled: boolean) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query("UPDATE terms SET auto_approve = $1 WHERE status = 'active'", [enabled]);
  } finally {
    await client.end();
  }
}
