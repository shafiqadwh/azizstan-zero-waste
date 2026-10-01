/**
 * A small Markdown subset for guide pages (T24), parsed to a tree that React renders as elements — never HTML
 * strings, so page text cannot inject markup. Supported: `#`–`###` headings, paragraphs, `-`/`*` and `1.` lists,
 * `---`, **bold**, *italic*, `code` and [links](https://… or /path).
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'hr' };

/** Links may only point to http(s) or a path on this site. */
export const safeHref = (href: string) => (/^(https?:\/\/|\/(?!\/))/i.test(href.trim()) ? href.trim() : null);

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ t: 'code', v: m[1]! });
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/))) {
      flush();
      out.push({ t: 'strong', c: parseInline(m[1]!) });
    } else if ((m = rest.match(/^\*([^*]+)\*/))) {
      flush();
      out.push({ t: 'em', c: parseInline(m[1]!) });
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = safeHref(m[2]!);
      if (href) out.push({ t: 'link', href, c: parseInline(m[1]!) });
      else out.push(...parseInline(m[1]!));
    } else {
      text += s[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (!line) {
      endPara();
      endList();
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      endPara();
      endList();
      blocks.push({ t: 'h', level: m[1]!.length as 1 | 2 | 3, c: parseInline(m[2]!) });
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      endPara();
      endList();
      blocks.push({ t: 'hr' });
    } else if ((m = line.match(/^([-*]|\d+\.)\s+(.*)$/))) {
      endPara();
      const kind = /\d/.test(m[1]!) ? 'ol' : 'ul';
      if (list && list.t !== kind) endList();
      list ??= { t: kind, items: [] };
      list.items.push(parseInline(m[2]!));
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}
