/**
 * AZIZSTAN Zero Waste — Drizzle schema (PostgreSQL 16).
 *
 * Conventions
 *  - ids: uuid v7 generated in app code (`newId()`), except append-only logs (bigserial).
 *  - timestamps: timestamptz, UTC. Dates without time (effective ranges): `date`.
 *  - scores: numeric(6,3). Read as string from pg; convert with src/lib/scoring/decimal.ts (thousandths).
 *  - Requirement IDs (FR-xx) refer to docs/01-requirements.md.
 *
 * Constraints that Drizzle cannot express are listed at the bottom (RAW_SQL) and must be added
 * to the first migration by hand.
 */
import {
  pgTable, pgEnum, uuid, text, integer, smallint, boolean, numeric, timestamp, date,
  jsonb, bigserial, primaryKey, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ───────────────────────────── Enums ─────────────────────────────
export const roleEnum = pgEnum('role', ['super_admin', 'admin', 'executive', 'teacher']);
export const authSourceEnum = pgEnum('auth_source', ['local', 'school']);
export const termStatusEnum = pgEnum('term_status', ['draft', 'active', 'closed']);
export const areaTypeEnum = pgEnum('area_type', ['zone', 'building']);
export const scoreModeEnum = pgEnum('score_mode', ['group', 'individual']);
export const scoreFormatEnum = pgEnum('score_format', ['integer', 'decimal']);
export const roundStatusEnum = pgEnum('round_status', ['scheduled', 'open', 'closed', 'finalized']);
export const componentUnitEnum = pgEnum('component_unit', ['class', 'area']);
export const componentSourceEnum = pgEnum('component_source', ['committee', 'area_teacher']);
export const componentKindEnum = pgEnum('component_kind', ['score', 'deduct']);
export const trackEnum = pgEnum('track', ['general', 'religious', 'vocational']);
export const dutyEnum = pgEnum('duty', ['committee', 'area_teacher', 'approver']);
export const targetTypeEnum = pgEnum('target_type', ['class', 'area']);
export const studentStatusEnum = pgEnum('student_status', ['active', 'inactive', 'review']);
export const evaluationStatusEnum = pgEnum('evaluation_status', ['submitted', 'returned', 'approved', 'void']);
export const evidenceKindEnum = pgEnum('evidence_kind', ['site', 'signature']);
export const requestTypeEnum = pgEnum('request_type', [
  'late_entry', 'edit_score', 'edit_photos', 'edit_comment', 'move_target', 'delete',
]);
export const requestStatusEnum = pgEnum('request_status', ['waiting', 'approved', 'rejected', 'cancelled', 'expired']);
export const syncSourceEnum = pgEnum('sync_source', ['general', 'vocational']);
export const syncStatusEnum = pgEnum('sync_status', ['success', 'aborted', 'failed']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const score = (name: string) => numeric(name, { precision: 6, scale: 3 });

// ───────────────────────────── Users & auth (FR-U*) ─────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  role: roleEnum('role').notNull(),
  authSource: authSourceEnum('auth_source').notNull().default('local'),
  externalId: text('external_id'),                      // id in the school system (FR-U8)
  passwordHash: text('password_hash'),                  // argon2id, local accounts only
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_username_uq').on(sql`lower(${t.username})`),
  uniqueIndex('users_external_uq').on(t.authSource, t.externalId),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),                          // sha256 of the cookie token
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

// ───────────────────────────── Terms, rounds, components (FR-C*) ─────────────────────────────
export const terms = pgTable('terms', {
  id: uuid('id').primaryKey(),
  academicYear: smallint('academic_year').notNull(),    // 2569
  termNo: smallint('term_no').notNull(),                // 1 | 2
  status: termStatusEnum('status').notNull().default('draft'),
  areaType: areaTypeEnum('area_type').notNull(),
  roomMode: scoreModeEnum('room_mode').notNull().default('group'),
  areaMode: scoreModeEnum('area_mode').notNull().default('group'),
  scoreFormat: scoreFormatEnum('score_format').notNull().default('decimal'),
  scoreStep: score('score_step').notNull().default('0.500'),   // 1.000 when integer
  finalMax: score('final_max').notNull(),               // e.g. 15
  selfEditHours: smallint('self_edit_hours').notNull().default(24),
  lateEntryDefaultHours: smallint('late_entry_default_hours').notNull().default(24),
  photoMin: smallint('photo_min').notNull().default(3),
  photoMax: smallint('photo_max').notNull().default(5),
  commentMax: smallint('comment_max').notNull().default(300),
  studentLevelEnabled: boolean('student_level_enabled').notNull().default(false), // show/export per student
  reminderHours: jsonb('reminder_hours').$type<number[]>().notNull().default([72, 24]), // before closes_at
  publicRankingsVisible: boolean('public_rankings_visible').notNull().default(true),
  publicShowLiveScores: boolean('public_show_live_scores').notNull().default(true),    // false = only finalized rounds
  copiedFromTermId: uuid('copied_from_term_id'),
  configLockedAt: ts('config_locked_at'),               // set when first evaluation is created (FR-C9)
  closedAt: ts('closed_at'),                            // BR-D1
  purgeAfter: date('purge_after'),                      // closed_at + 365 d (FR-S2)
  purgedAt: ts('purged_at'),                            // term data deleted; row kept for the history list
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('terms_year_no_uq').on(t.academicYear, t.termNo),
  check('terms_photo_range', sql`${t.photoMin} >= 0 AND ${t.photoMax} >= ${t.photoMin} AND ${t.photoMax} <= 10`),
  check('terms_step_positive', sql`${t.scoreStep} > 0`),
]);

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey(),
  termId: uuid('term_id').notNull().references(() => terms.id),
  roundNo: smallint('round_no').notNull(),
  opensAt: ts('opens_at').notNull(),
  closesAt: ts('closes_at').notNull(),
  status: roundStatusEnum('status').notNull().default('scheduled'),
  finalizedAt: ts('finalized_at'),
  finalizedBy: uuid('finalized_by').references(() => users.id),
}, (t) => [
  uniqueIndex('rounds_term_no_uq').on(t.termId, t.roundNo),
  check('rounds_dates', sql`${t.closesAt} > ${t.opensAt}`),
]);

export const scoreComponents = pgTable('score_components', {
  id: uuid('id').primaryKey(),
  termId: uuid('term_id').notNull().references(() => terms.id),
  key: text('key').notNull(),                           // 'room', 'area', 'area_deduct'
  label: text('label').notNull(),                       // 'คะแนนห้อง'
  unit: componentUnitEnum('unit').notNull(),
  source: componentSourceEnum('source').notNull().default('committee'),
  kind: componentKindEnum('kind').notNull().default('score'),
  maxValue: score('max_value').notNull(),               // score: max points; deduct: max deduction
  enabled: boolean('enabled').notNull().default(true),  // e.g. zone-teacher score configured but off this term
  requiresSignature: boolean('requires_signature').notNull().default(true), // false for building/zone (FR-E2)
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('components_term_key_uq').on(t.termId, t.key)]);

/** Optional per-round full marks (FR-C11). No row = the component's max_value applies to that round. */
export const roundComponentMax = pgTable('round_component_max', {
  roundId: uuid('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  componentId: uuid('component_id').notNull().references(() => scoreComponents.id, { onDelete: 'cascade' }),
  maxValue: score('max_value').notNull(),
}, (t) => [primaryKey({ columns: [t.roundId, t.componentId] })]);

// ───────────────────────────── Places (FR-P*) ─────────────────────────────
export const areas = pgTable('areas', {
  id: uuid('id').primaryKey(),
  type: areaTypeEnum('type').notNull(),
  code: text('code').notNull(),                         // 'A'..'Y' or '1'..'8'
  name: text('name').notNull(),                         // 'โซน A' / 'อาคาร 1'
  description: text('description'),                     // zone area description
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('areas_type_code_uq').on(t.type, t.code)]);

export const physicalRooms = pgTable('physical_rooms', {
  id: uuid('id').primaryKey(),
  buildingId: uuid('building_id').notNull().references(() => areas.id),
  roomNumber: text('room_number').notNull(),            // '121'
  floor: smallint('floor'),
  qrToken: text('qr_token').notNull(),                  // random; QR on the door → /r/{qrToken}
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [
  uniqueIndex('rooms_number_uq').on(t.roomNumber),
  uniqueIndex('rooms_qr_uq').on(t.qrToken),
]);

export const classes = pgTable('classes', {
  id: uuid('id').primaryKey(),
  track: trackEnum('track').notNull(),
  gradeCode: text('grade_code').notNull(),              // 'M1'..'M6', 'VOC1'..'VOC3', 'REL-SAN2', 'REL-SAN3'
  gradeLabel: text('grade_label').notNull(),            // 'ม.1', 'ปวช.2', 'ซานาวี ปี 2'
  rankGroup: text('rank_group').notNull(),              // ranking bucket: 'ม.1' … 'ปวช.', 'ซานาวี' (Q13)
  roomNo: smallint('room_no').notNull(),                // sort only, never shown for general track
  name: text('name').notNull(),                         // 'Amanah' | 'ปวช.2/1' | '2S Muslim'
  displayName: text('display_name').notNull(),          // 'ม.1 Amanah'
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [uniqueIndex('classes_track_grade_name_uq').on(t.track, t.gradeCode, t.name)]);

export const classAliases = pgTable('class_aliases', {
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull().references(() => classes.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),                       // normalized (see business rules §9.2)
}, (t) => [uniqueIndex('class_aliases_alias_uq').on(t.alias)]);

/** Class ↔ physical room with effective dates (FR-P3). No overlap: see RAW_SQL. */
export const classRoomLinks = pgTable('class_room_links', {
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull().references(() => classes.id),
  physicalRoomId: uuid('physical_room_id').notNull().references(() => physicalRooms.id),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),                    // null = still current; exclusive end
  createdBy: uuid('created_by').references(() => users.id),
});

/** What a zone consists of: buildings (linked) and/or named places (free text) (FR-C10). */
export const zonePlaces = pgTable('zone_places', {
  id: uuid('id').primaryKey(),
  zoneId: uuid('zone_id').notNull().references(() => areas.id, { onDelete: 'cascade' }),
  buildingId: uuid('building_id').references(() => areas.id),   // set when the place is a building
  label: text('label').notNull(),                               // 'ประตูใหญ่', 'อาคาร 1 ชั้นล่าง'
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [index('zone_places_zone_idx').on(t.zoneId)]);

/** Zone mode only: which classes are responsible for which zone this term (FR-P4). */
/**
 * Which classes take part in a term (FR-P7). Only these classes are evaluation targets, ranked, shown publicly
 * and exported. The class register (`classes`) keeps every class; this table is the per-term selection.
 */
export const termClasses = pgTable('term_classes', {
  termId: uuid('term_id').notNull().references(() => terms.id),
  classId: uuid('class_id').notNull().references(() => classes.id),
}, (t) => [primaryKey({ columns: [t.termId, t.classId] })]);

export const termClassZones = pgTable('term_class_zones', {
  termId: uuid('term_id').notNull().references(() => terms.id),
  classId: uuid('class_id').notNull().references(() => classes.id),
  areaId: uuid('area_id').notNull().references(() => areas.id),
}, (t) => [primaryKey({ columns: [t.termId, t.classId] })]);

/**
 * Frozen at round open: which area (and room) each class belonged to in this round (FR-R4).
 * Building mode: derived from class_room_links at rounds.opens_at. Zone mode: from term_class_zones.
 * Admin may correct rows while the round is not finalized.
 */
export const roundClassAreas = pgTable('round_class_areas', {
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  classId: uuid('class_id').notNull().references(() => classes.id),
  areaId: uuid('area_id').notNull().references(() => areas.id),
  physicalRoomId: uuid('physical_room_id').references(() => physicalRooms.id),
}, (t) => [primaryKey({ columns: [t.roundId, t.classId] })]);

// ───────────────────────────── Duties (FR-U6, FR-U7) ─────────────────────────────
export const duties = pgTable('duties', {
  id: uuid('id').primaryKey(),
  termId: uuid('term_id').notNull().references(() => terms.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  duty: dutyEnum('duty').notNull(),
  targetType: targetTypeEnum('target_type'),            // null for approver = "all targets"
  targetClassId: uuid('target_class_id').references(() => classes.id),
  targetAreaId: uuid('target_area_id').references(() => areas.id),
  isFreelance: boolean('is_freelance').notNull().default(false),
  validUntil: ts('valid_until'),                        // freelance assignments expire
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('duties_user_term_idx').on(t.userId, t.termId),
  check('duties_target_shape', sql`
    (${t.targetType} IS NULL AND ${t.targetClassId} IS NULL AND ${t.targetAreaId} IS NULL) OR
    (${t.targetType} = 'class' AND ${t.targetClassId} IS NOT NULL AND ${t.targetAreaId} IS NULL) OR
    (${t.targetType} = 'area'  AND ${t.targetAreaId} IS NOT NULL AND ${t.targetClassId} IS NULL)`),
]);

// ───────────────────────────── Students (FR-I*, FR-S*) ─────────────────────────────
export const students = pgTable('students', {
  id: uuid('id').primaryKey(),
  studentCode: text('student_code').notNull(),          // รหัสนักเรียน
  fullName: text('full_name').notNull(),                // never rendered in UI (FR-S1)
  generalClassId: uuid('general_class_id').references(() => classes.id),
  religiousClassId: uuid('religious_class_id').references(() => classes.id),
  homeClassId: uuid('home_class_id').references(() => classes.id), // FR-R10
  status: studentStatusEnum('status').notNull().default('active'),
  reviewReason: text('review_reason'),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  deleteAfter: date('delete_after').notNull(),          // last_seen + 365 d (FR-S2)
}, (t) => [
  uniqueIndex('students_code_uq').on(t.studentCode),
  index('students_home_idx').on(t.homeClassId),
]);

export const rosterSnapshots = pgTable('roster_snapshots', {
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  classId: uuid('class_id').notNull().references(() => classes.id),
}, (t) => [
  primaryKey({ columns: [t.roundId, t.studentId] }),
  index('roster_round_class_idx').on(t.roundId, t.classId),
]);

// ───────────────────────────── Evaluations (FR-E*) ─────────────────────────────
export const evaluations = pgTable('evaluations', {
  id: uuid('id').primaryKey(),
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  componentId: uuid('component_id').notNull().references(() => scoreComponents.id),
  targetType: targetTypeEnum('target_type').notNull(),
  targetClassId: uuid('target_class_id').references(() => classes.id),
  targetAreaId: uuid('target_area_id').references(() => areas.id),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  score: score('score'),                                // group mode; null in individual mode
  comment: text('comment'),
  roomNumberAtEval: text('room_number_at_eval'),        // '121' — printed on PDF
  status: evaluationStatusEnum('status').notNull().default('submitted'),
  firstSubmittedAt: ts('first_submitted_at').notNull(),
  selfEditUntil: ts('self_edit_until').notNull(),       // first_submitted_at + term.self_edit_hours
  lastEditedAt: ts('last_edited_at').notNull(),
  returnedAt: ts('returned_at'),
  returnedReason: text('returned_reason'),
  approvedAt: ts('approved_at'),
  approvedBy: uuid('approved_by').references(() => users.id),
  version: integer('version').notNull().default(1),    // +1 on every applied change
  pdfStatus: text('pdf_status').notNull().default('none'), // none | queued | ready | failed (monitor board)
  pdfError: text('pdf_error'),                          // last render error, shown to admins
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('evaluations_round_idx').on(t.roundId, t.status),
  index('evaluations_owner_idx').on(t.ownerId),
  check('evaluations_target_shape', sql`
    (${t.targetType} = 'class' AND ${t.targetClassId} IS NOT NULL AND ${t.targetAreaId} IS NULL) OR
    (${t.targetType} = 'area'  AND ${t.targetAreaId} IS NOT NULL AND ${t.targetClassId} IS NULL)`),
]);

/** Individual mode only (FR-R6). */
export const evaluationStudentScores = pgTable('evaluation_student_scores', {
  evaluationId: uuid('evaluation_id').notNull().references(() => evaluations.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  score: score('score').notNull(),
}, (t) => [primaryKey({ columns: [t.evaluationId, t.studentId] })]);

export const evidence = pgTable('evidence', {
  id: uuid('id').primaryKey(),
  evaluationId: uuid('evaluation_id').references(() => evaluations.id), // null while uploading (orphan GC 24 h)
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  kind: evidenceKindEnum('kind').notNull(),
  filePath: text('file_path').notNull(),                // relative to DATA_DIR, e.g. uploads/ab/abcd….webp
  sha256: text('sha256').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  bytes: integer('bytes').notNull(),
  capturedAt: ts('captured_at').notNull(),              // server time stamped on the image
  sortOrder: smallint('sort_order').notNull().default(0),
  removedAt: ts('removed_at'),                          // soft delete; files kept until retention
}, (t) => [index('evidence_eval_idx').on(t.evaluationId)]);

export const pdfDocuments = pgTable('pdf_documents', {
  id: uuid('id').primaryKey(),
  evaluationId: uuid('evaluation_id').notNull().references(() => evaluations.id),
  evaluationVersion: integer('evaluation_version').notNull(),
  docNumber: text('doc_number').notNull(),              // 'ZW-2569-2-R1-0001'
  version: integer('version').notNull(),                // 1, 2, …
  isDraft: boolean('is_draft').notNull(),               // watermark "ฉบับร่าง" (FR-D2)
  filePath: text('file_path').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  supersededAt: ts('superseded_at'),
}, (t) => [uniqueIndex('pdf_eval_version_uq').on(t.evaluationId, t.version)]);

// ───────────────────────────── Requests (FR-E5..E7) ─────────────────────────────
export const requests = pgTable('requests', {
  id: uuid('id').primaryKey(),
  type: requestTypeEnum('type').notNull(),
  status: requestStatusEnum('status').notNull().default('waiting'),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  componentId: uuid('component_id').references(() => scoreComponents.id),
  evaluationId: uuid('evaluation_id').references(() => evaluations.id), // null for late_entry
  targetType: targetTypeEnum('target_type'),
  targetClassId: uuid('target_class_id').references(() => classes.id),
  targetAreaId: uuid('target_area_id').references(() => areas.id),
  reason: text('reason').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: ts('decided_at'),
  decisionNote: text('decision_note'),
  grantUntil: ts('grant_until'),                        // late_entry: entry allowed until
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('requests_status_idx').on(t.status, t.createdAt)]);

// ───────────────────────────── Results (FR-R*) ─────────────────────────────
/** Written at finalize (frozen) and recomputed live for dashboards before that. */
export const roundClassResults = pgTable('round_class_results', {
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  classId: uuid('class_id').notNull().references(() => classes.id),
  areaId: uuid('area_id').references(() => areas.id),
  classScore: score('class_score').notNull(),           // sum of class-unit score components
  areaScore: score('area_score').notNull(),             // sum of area-unit score components
  deduction: score('deduction').notNull(),
  total: score('total').notNull(),
  rankInGroup: smallint('rank_in_group').notNull(),
  frozen: boolean('frozen').notNull().default(false),
  computedAt: ts('computed_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.roundId, t.classId] })]);

export const roundAreaResults = pgTable('round_area_results', {
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  areaId: uuid('area_id').notNull().references(() => areas.id),
  score: score('score').notNull(),
  rank: smallint('rank').notNull(),
  frozen: boolean('frozen').notNull().default(false),
  computedAt: ts('computed_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.roundId, t.areaId] })]);

/** Student-level results for ปพ.5 (FR-R9). Kept after student deletion? No — cascades (FR-S2). */
export const roundStudentResults = pgTable('round_student_results', {
  roundId: uuid('round_id').notNull().references(() => rounds.id),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  classId: uuid('class_id').notNull().references(() => classes.id),
  total: score('total').notNull(),
}, (t) => [primaryKey({ columns: [t.roundId, t.studentId] })]);

// ───────────────────────────── Documents & content ─────────────────────────────
export const appointmentOrders = pgTable('appointment_orders', {
  id: uuid('id').primaryKey(),
  termId: uuid('term_id').notNull().references(() => terms.id),
  title: text('title').notNull(),                       // 'คำสั่งที่ 23/2569'
  filePath: text('file_path').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const guidePages = pgTable('guide_pages', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  audience: text('audience').notNull().default('public'), // public | committee | admin
  sortOrder: smallint('sort_order').notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('guide_slug_uq').on(t.slug)]);

// ───────────────────────────── Notifications ─────────────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                         // see docs/11-jobs-notifications.md
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.readAt)]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSuccessAt: ts('last_success_at'),
}, (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint)]);

// ───────────────────────────── Operations ─────────────────────────────
/** School-wide settings (not per term). Keys listed in docs/08-ux-ui.md §6.20. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),                        // 'school.name', 'pdf.docPrefix', 'retention.studentDays', …
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey(),
  source: syncSourceEnum('source').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: syncStatusEnum('status'),
  counts: jsonb('counts').$type<Record<string, number>>(),     // {rows, added, moved, renamed, inactive, review, malformed}
  changes: jsonb('changes').$type<unknown[]>(),                // per-student change list (codes only, no names)
  error: text('error'),
  triggeredBy: uuid('triggered_by').references(() => users.id), // null = scheduled
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),                         // 'ปพ.5 program'
  keyHash: text('key_hash').notNull(),                  // sha256
  createdAt: ts('created_at').notNull().defaultNow(),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
});

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  actorId: uuid('actor_id'),                            // null = system/worker
  action: text('action').notNull(),                     // 'evaluation.approve'
  entity: text('entity').notNull(),                     // 'evaluation'
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
}, (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_at_idx').on(t.at)]);

/**
 * Add to the first migration by hand (Drizzle cannot express these).
 */
export const RAW_SQL = `
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- FR-P3: a class is in one room at a time, and a room holds one class at a time.
ALTER TABLE class_room_links ADD CONSTRAINT class_room_links_class_no_overlap
  EXCLUDE USING gist (class_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
ALTER TABLE class_room_links ADD CONSTRAINT class_room_links_room_no_overlap
  EXCLUDE USING gist (physical_room_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

-- FR-E1: one live evaluation per (round, component, target).
CREATE UNIQUE INDEX evaluations_one_per_class_target ON evaluations (round_id, component_id, target_class_id)
  WHERE status <> 'void' AND target_class_id IS NOT NULL;
CREATE UNIQUE INDEX evaluations_one_per_area_target ON evaluations (round_id, component_id, target_area_id)
  WHERE status <> 'void' AND target_area_id IS NOT NULL;

-- One waiting request per (evaluation, type) and per (late entry target).
CREATE UNIQUE INDEX requests_one_waiting_per_eval ON requests (evaluation_id, type)
  WHERE status = 'waiting' AND evaluation_id IS NOT NULL;

-- Audit log is append-only (works whatever DB role the app uses).
CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();
`;
