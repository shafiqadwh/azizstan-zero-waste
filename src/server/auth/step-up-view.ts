import { formatThaiTime } from '../../lib/dates/index.ts';
import type { SessionUser } from '../policies/index.ts';
import { hasRecentStepUp, STEP_UP_MS } from './session-policy.ts';

/** For <StepUpCard>: "16:42 น." while the step-up window is open, else null. */
export function stepUpValidUntil(user: SessionUser, now: Date): string | null {
  if (!hasRecentStepUp(user.stepUpAt, now)) return null;
  return formatThaiTime(new Date(user.stepUpAt!.getTime() + STEP_UP_MS));
}
