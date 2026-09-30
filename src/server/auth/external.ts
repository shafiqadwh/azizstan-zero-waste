/** School account verification (06-auth §1.2). The school API is not specified yet. */
export interface ExternalAuthProvider {
  /** Verify credentials against the school system. Must not persist the password. */
  verify(
    username: string,
    password: string,
  ): Promise<{ ok: true; externalId: string; displayName: string } | { ok: false; reason: 'invalid' | 'unavailable' }>;
}

// OPEN-QUESTION: Q1 — teacher login API unknown; always "unavailable" until the school provides it.
export const externalAuth: ExternalAuthProvider = {
  async verify() {
    return { ok: false, reason: 'unavailable' };
  },
};
