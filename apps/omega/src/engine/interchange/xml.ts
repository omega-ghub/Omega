// A tiny, strict XML reader and writer used by the interchange package
// (FCPXML writing, well-formedness checks in tests). Not a full XML parser:
// no external entities, no namespaces resolution. Throws on malformed input.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const BARE_AMP = /&(?!(?:#x[0-9a-f]+|#\d+|[a-z]+);)/i;

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, b: string) => {
    if (b[0] === '#') return String.fromCodePoint(b[1] === 'x' || b[1] === 'X' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10));
    if (b in ENT) return ENT[b];
    throw new Error(`Unknown entity ${all}`);
  });
}

/** Parses an XML document and returns its root element. Throws on malformed XML. */
export function parseXml(src: string): XmlNode {
  let i = 0;
  const n = src.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const fail = (msg: string): never => {
    const line = src.slice(0, i).split('\n').length;
    throw new Error(`XML error at line ${line}: ${msg}`);
  };
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    const text = src.slice(i, textEnd);
    if (text.trim()) {
      if (!stack.length) fail('text outside the root element');
      if (BARE_AMP.test(text)) fail("bare '&' in text");
      stack[stack.length - 1].text += decode(text);
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i);
      if (end < 0) fail('unterminated processing instruction');
      i = end + 2;
    } else if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) fail('unterminated comment');
      if (src.slice(i + 4, end).includes('--')) fail("'--' inside a comment");
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      if (end < 0) fail('unterminated CDATA');
      if (!stack.length) fail('CDATA outside the root element');
      stack[stack.length - 1].text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith('<!DOCTYPE', i)) {
      if (root || stack.length) fail('DOCTYPE after the root element');
      const end = src.indexOf('>', i);
      if (end < 0) fail('unterminated DOCTYPE');
      i = end + 1;
    } else if (src.startsWith('</', i)) {
      const m = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(src.slice(i, i + 200));
      if (!m) fail('bad closing tag');
      const open = stack.pop();
      if (!open || open.name !== m![1]) fail(`closing </${m![1]}> does not match <${open?.name ?? '(none)'}>`);
      i += m![0].length;
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(i, i + 200));
      if (!m) fail('bad tag');
      const node: XmlNode = { name: m![1], attrs: {}, children: [], text: '' };
      i += m![0].length;
      for (;;) {
        const ws = /^\s*/.exec(src.slice(i))![0].length;
        i += ws;
        if (src.startsWith('/>', i)) {
          i += 2;
          attach(node);
          break;
        }
        if (src[i] === '>') {
          i += 1;
          attach(node);
          stack.push(node);
          break;
        }
        if (!ws) fail('expected whitespace between attributes');
        const am = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(src.slice(i));
        if (!am) fail(`bad attribute in <${node.name}>`);
        const key = am![1];
        if (key in node.attrs) fail(`duplicate attribute ${key}`);
        const raw = am![3] ?? am![4] ?? '';
        if (BARE_AMP.test(raw)) fail(`bare '&' in attribute ${key}`);
        node.attrs[key] = decode(raw);
        i += am![0].length;
      }
    }
  }
  if (stack.length) fail(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) fail('no root element');
  return root!;

  function attach(node: XmlNode) {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) fail('more than one root element');
    else root = node;
  }
}

/** Depth-first search for elements by name. */
export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  if (node.name === name) out.push(node);
  for (const c of node.children) findAll(c, name, out);
  return out;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export interface XEl {
  name: string;
  attrs?: Record<string, string | number | undefined | null>;
  children?: (XEl | null | undefined | false)[];
  text?: string;
}

export function el(name: string, attrs?: XEl['attrs'], children?: XEl['children']): XEl {
  return { name, attrs, children };
}

function escAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function escText(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** Serializes an element tree with two-space indentation (attribute order preserved). */
export function writeXml(node: XEl, indent = 0): string {
  const pad = '  '.repeat(indent);
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join('');
  const kids = (node.children ?? []).filter((c): c is XEl => !!c);
  if (!kids.length && !node.text) return `${pad}<${node.name}${attrs}/>`;
  if (!kids.length) return `${pad}<${node.name}${attrs}>${escText(node.text ?? '')}</${node.name}>`;
  return [`${pad}<${node.name}${attrs}>`, ...kids.map((k) => writeXml(k, indent + 1)), `${pad}</${node.name}>`].join('\n');
}
