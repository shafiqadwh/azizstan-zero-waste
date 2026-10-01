import { describe, expect, test } from 'vitest';
import { inCidr, ipAllowed, ipBytes, parseCidrs } from './cidr';

describe('CIDR allow-list', () => {
  test('IPv4 ranges', () => {
    expect(inCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(inCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(inCidr('172.20.5.5', '172.16.0.0/12')).toBe(true);
    expect(inCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
    expect(inCidr('192.168.1.10', '192.168.1.10')).toBe(true);
    expect(inCidr('192.168.1.11', '192.168.1.10/32')).toBe(false);
  });

  test('IPv6, IPv4-mapped IPv6 and junk', () => {
    expect(inCidr('::1', '::1/128')).toBe(true);
    expect(inCidr('fd00::12', 'fd00::/8')).toBe(true);
    expect(inCidr('2001:db8::1', 'fd00::/8')).toBe(false);
    expect(inCidr('::ffff:192.168.0.7', '192.168.0.0/16')).toBe(true);
    expect(ipBytes('unknown')).toBeNull();
    expect(inCidr('999.1.1.1', '0.0.0.0/0')).toBe(false);
    expect(inCidr('10.0.0.1', '10.0.0.0/33')).toBe(false);
  });

  test('a comma list from the environment', () => {
    const list = parseCidrs('10.0.0.0/8, 192.168.0.0/16,,');
    expect(list).toEqual(['10.0.0.0/8', '192.168.0.0/16']);
    expect(ipAllowed('192.168.9.9', list)).toBe(true);
    expect(ipAllowed('8.8.8.8', list)).toBe(false);
    expect(ipAllowed('8.8.8.8', [])).toBe(false);
  });
});
