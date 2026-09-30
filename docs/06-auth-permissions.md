# 06 — Authentication and Permissions

## 1. Authentication

### 1.1 Local accounts (super admin, admin, executive; fallback for teachers)
- Password hash: argon2id (m=19 MiB, t=2, p=1). Minimum 8 characters.
- Session: random 32-byte token in cookie `zw_session` (httpOnly, Secure, SameSite=Lax, Path=/).
  DB stores `sha256(token)`. Idle timeout 12 h for staff; absolute 30 days; sliding `last_seen_at`
  updated at most every 5 minutes.
- Login rate limit: 5 failures per 15 min per (IP, username) → `RATE_LIMITED`.
- `must_change_password` forces `/account/password` before any other page.

### 1.2 School accounts (teachers) — adapter, spec pending (Q1)
```ts
// src/server/auth/external.ts
export interface ExternalAuthProvider {
  /** Verify credentials against the school system. Must not persist the password. */
  verify(username: string, password: string): Promise<
    | { ok: true; externalId: string; displayName: string }
    | { ok: false; reason: 'invalid' | 'unavailable' }
  >;
}
```
- Login flow: if a user row exists with `auth_source = 'school'` → call `verify`. On success, update
  `display_name`, create session. On `unavailable` → show "ระบบยืนยันตัวตนของโรงเรียนไม่ตอบสนอง".
- First login of an unknown school user: create a `teacher` row **disabled** (no duty) and show
  "บัญชีของคุณยังไม่ได้รับมอบหมายหน้าที่ในเทอมนี้". Admin assigns a duty → account enabled automatically.
- Until the API exists, implement `ExternalAuthProvider` with a stub that always returns `unavailable`, and
  use local accounts.

## 2. Authorization model

Decision = **role** (what kind of user) + **duty** (what they were given this term).

```ts
// src/server/policies/index.ts
type Action =
  | 'public.read'
  | 'staff.read'                        // dashboards, all results, evidence, PDFs
  | 'evaluation.create' | 'evaluation.update' | 'evaluation.delete'
  | 'evaluation.approve' | 'evaluation.return'
  | 'request.create' | 'request.decide'
  | 'term.configure' | 'round.manage' | 'round.finalize'
  | 'place.manage' | 'duty.manage' | 'student.sync' | 'content.manage' | 'apikey.manage'
  | 'user.create' | 'user.setRole' | 'user.manage';

export function can(user: SessionUser, action: Action, ctx?: PolicyContext): boolean;
export function assertCan(...): void; // throws ForbiddenError
```

## 3. Permission matrix

| Action | super_admin | admin | executive | teacher | anonymous |
|---|---|---|---|---|---|
| public.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| staff.read (all results, evidence, dashboards) | ✓ | ✓ | ✓ | own targets only | – |
| monitor.read — `/monitor` board + target popover | all targets | all targets | all targets | own targets only (needs committee duty) | – |
| evaluation.create/update/delete | duty | duty | duty | duty | – |
| evaluation.approve / return | ✓ | ✓ (approver rule BR-E6) | – | – | – |
| request.create | duty | duty | duty | duty | – |
| request.decide | ✓ | ✓ | – | – | – |
| term.configure, round.manage, round.finalize | ✓ | ✓ | – | – | – |
| place.manage, duty.manage, student.sync | ✓ | ✓ | – | – | – |
| content.manage (orders, guide) | ✓ | ✓ | – | – | – |
| apikey.manage | ✓ | ✓ | – | – | – |
| user.create | ✓ | – | – | – | – |
| user.setRole (set role: admin, executive, teacher, super admin) | ✓ | – | – | – | – |
| user.manage (activate, reset password of non-admins) | ✓ | – (Q8) | – | – | – |

"duty" = allowed only with a matching committee duty (BR-P1). An executive without duty is read-only (FR-U4).
Roles are never narrowed by a duty: an admin/executive/super admin who is also a committee member keeps the
"all targets" scope everywhere (monitor, dashboards) and additionally may score their own targets.

## 4. Rules for implementers

1. Every server action begins with `const user = await requireUser(); assertCan(user, action, ctx);`.
2. Row-level checks (duty, ownership, approver) go in `ctx` resolvers inside the policy module — never inline in
   components.
3. Route groups: `(committee)` layout requires any active duty in the active term **or** admin/executive;
   `(admin)` layout requires admin, super_admin or executive (executive sees read-only variants: action buttons
   hidden **and** server actions still refuse).
4. File endpoints (`/files`, `/pdf`) always re-check permission; files are never served from a public static
   path.
