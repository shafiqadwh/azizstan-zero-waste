/**
 * IPv4/IPv6 CIDR matching for the ปพ.5 API allow-list (`PP5_ALLOWED_CIDRS`, 12-security). IPv4-mapped IPv6
 * addresses (`::ffff:10.0.0.5`) are compared as IPv4.
 */

function v4(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function v6(ip: string): number[] | null {
  if (!ip.includes(':') || ip.includes('.')) return null;
  const [head, tail, ...rest] = ip.split('::');
  if (rest.length) return null;
  const a = head ? head.split(':') : [];
  const b = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const groups = b === null ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 255];
  });
}

/** Bytes of an address; IPv4-mapped IPv6 becomes its IPv4 bytes. */
export function ipBytes(raw: string): number[] | null {
  const ip = raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return v4(mapped ? mapped[1]! : ip) ?? v6(ip);
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, lenRaw] = cidr.trim().split('/');
  const addr = ipBytes(ip);
  const net = base ? ipBytes(base) : null;
  if (!addr || !net || addr.length !== net.length) return false;
  const len = lenRaw === undefined ? net.length * 8 : Number(lenRaw);
  if (!Number.isInteger(len) || len < 0 || len > net.length * 8) return false;
  for (let bit = 0; bit < len; bit++) {
    const i = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if ((addr[i]! & mask) !== (net[i]! & mask)) return false;
  }
  return true;
}

export const parseCidrs = (list: string | undefined) =>
  (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const ipAllowed = (ip: string, cidrs: string[]) => cidrs.some((c) => inCidr(ip, c));
