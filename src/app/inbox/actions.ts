'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { markInboxRead } from '@/server/services/push.service';

export async function markAllReadAction() {
  await markInboxRead(getDb(), await requireUser(), new Date());
  revalidatePath('/inbox');
}

export async function openNotificationAction(id: string) {
  await markInboxRead(getDb(), await requireUser(), new Date(), [id]);
}
