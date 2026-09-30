import type { Role } from '@/server/policies';

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'ผู้ดูแลระบบสูงสุด',
  admin: 'แอดมิน',
  executive: 'ผู้บริหาร',
  teacher: 'ครู',
};

export const AUTH_SOURCE_LABEL = { local: 'บัญชีในระบบ', school: 'บัญชีโรงเรียน' } as const;
