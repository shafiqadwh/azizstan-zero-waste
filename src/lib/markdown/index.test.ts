import { describe, expect, test } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './index';

describe('guide Markdown subset', () => {
  test('headings, paragraphs joined across lines, lists and rules', () => {
    expect(parseMarkdown('# หัวข้อ\n\nบรรทัดแรก\nบรรทัดสอง\n\n- หนึ่ง\n- สอง\n1. ก\n---')).toEqual([
      { t: 'h', level: 1, c: [{ t: 'text', v: 'หัวข้อ' }] },
      { t: 'p', c: [{ t: 'text', v: 'บรรทัดแรก บรรทัดสอง' }] },
      { t: 'ul', items: [[{ t: 'text', v: 'หนึ่ง' }], [{ t: 'text', v: 'สอง' }]] },
      { t: 'ol', items: [[{ t: 'text', v: 'ก' }]] },
      { t: 'hr' },
    ]);
  });

  test('bold, italic, code and safe links only', () => {
    expect(parseInline('**ตัวหนา** *เอียง* `x` [ลิงก์](/rankings)')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'ตัวหนา' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'เอียง' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'x' },
      { t: 'text', v: ' ' },
      { t: 'link', href: '/rankings', c: [{ t: 'text', v: 'ลิงก์' }] },
    ]);
    // javascript: and protocol-relative links lose the link, keep the text
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { t: 'text', v: 'x' },
      { t: 'text', v: ')' },
    ]);
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('https://zerowaste.azizstan.net')).toBe('https://zerowaste.azizstan.net');
  });

  test('raw HTML stays text', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([
      { t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] },
    ]);
  });
});
