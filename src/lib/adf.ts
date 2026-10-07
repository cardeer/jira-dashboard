import type { JSONContent } from '@tiptap/react';

/**
 * Converters between Atlassian Document Format (Jira's rich text) and TipTap's JSON.
 *
 * Nodes and marks the editor supports natively are converted both ways. Everything else
 * (mentions, emoji, smart links, images, tables, panels, text colour, …) is carried through as
 * opaque `adfInline` / `adfBlock` nodes and an `adfMarks` mark that store the original ADF, so
 * editing a description never loses content the editor can't render.
 */

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

const ADF_TO_TIPTAP_NODE: Record<string, string> = {
  doc: 'doc',
  paragraph: 'paragraph',
  text: 'text',
  heading: 'heading',
  bulletList: 'bulletList',
  orderedList: 'orderedList',
  listItem: 'listItem',
  blockquote: 'blockquote',
  codeBlock: 'codeBlock',
  rule: 'horizontalRule',
  hardBreak: 'hardBreak',
};
const TIPTAP_TO_ADF_NODE = Object.fromEntries(Object.entries(ADF_TO_TIPTAP_NODE).map(([a, t]) => [t, a]));

const ADF_TO_TIPTAP_MARK: Record<string, string> = {
  strong: 'bold',
  em: 'italic',
  strike: 'strike',
  code: 'code',
  underline: 'underline',
  link: 'link',
};
const TIPTAP_TO_ADF_MARK = Object.fromEntries(Object.entries(ADF_TO_TIPTAP_MARK).map(([a, t]) => [t, a]));

/** Parents whose children are inline content (so unknown children are inline atoms). */
const INLINE_PARENTS = new Set(['paragraph', 'heading']);

/** Names of the editor extensions that carry unsupported ADF through untouched. */
export const OPAQUE = { inline: 'adfInline', block: 'adfBlock', marks: 'adfMarks' } as const;

/** True when the document contains content shown as read-only placeholders in the editor. */
export function adfHasOpaqueContent(doc: AdfNode | null | undefined): boolean {
  if (!doc) return false;
  const opaque = (n: AdfNode): boolean =>
    !(n.type in ADF_TO_TIPTAP_NODE) || (n.content ?? []).some(opaque);
  return opaque(doc);
}

export function adfToTiptap(doc: AdfNode | null | undefined): JSONContent {
  const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
  if (!doc) return empty;
  const conv = (n: AdfNode, parent: string): JSONContent | null => {
    const type = ADF_TO_TIPTAP_NODE[n.type];
    if (!type) {
      // Keep it exactly as Jira sent it; the editor shows a read-only placeholder.
      return {
        type: INLINE_PARENTS.has(parent) ? OPAQUE.inline : OPAQUE.block,
        attrs: { json: JSON.stringify(n) },
      };
    }
    const out: JSONContent = { type };
    if (n.type === 'heading') out.attrs = { level: Number(n.attrs?.level ?? 1) };
    if (n.type === 'orderedList' && n.attrs?.order) out.attrs = { start: Number(n.attrs.order) };
    if (n.type === 'codeBlock' && n.attrs?.language) out.attrs = { language: n.attrs.language };
    if (n.text !== undefined) out.text = n.text;
    const known = (n.marks ?? []).filter((m) => m.type in ADF_TO_TIPTAP_MARK);
    const unknown = (n.marks ?? []).filter((m) => !(m.type in ADF_TO_TIPTAP_MARK));
    const marks: JSONContent['marks'] = known.map((m) => ({
      type: ADF_TO_TIPTAP_MARK[m.type],
      ...(m.type === 'link' ? { attrs: { href: m.attrs?.href } } : {}),
    }));
    if (unknown.length) marks.push({ type: OPAQUE.marks, attrs: { json: JSON.stringify(unknown) } });
    if (marks.length) out.marks = marks;
    const content = (n.content ?? []).map((c) => conv(c, n.type)).filter((c): c is JSONContent => c !== null);
    if (content.length) out.content = content;
    return out;
  };
  return conv(doc, '') ?? empty;
}

/** TipTap JSON → ADF; returns null for an empty document (no description). */
export function tiptapToAdf(doc: JSONContent): AdfNode | null {
  const conv = (n: JSONContent): AdfNode | null => {
    if (n.type === OPAQUE.inline || n.type === OPAQUE.block) {
      try {
        return JSON.parse(String(n.attrs?.json)) as AdfNode;
      } catch {
        return null;
      }
    }
    const type = n.type && TIPTAP_TO_ADF_NODE[n.type];
    if (!type) return null;
    if (type === 'text') {
      if (!n.text) return null; // ADF forbids empty text nodes
      const marks: AdfMark[] = [];
      for (const m of n.marks ?? []) {
        if (m.type === OPAQUE.marks) {
          try {
            marks.push(...(JSON.parse(String(m.attrs?.json)) as AdfMark[]));
          } catch {
            /* drop a corrupted carrier rather than fail the save */
          }
        } else if (m.type in TIPTAP_TO_ADF_MARK) {
          marks.push({
            type: TIPTAP_TO_ADF_MARK[m.type],
            ...(m.type === 'link' ? { attrs: { href: String(m.attrs?.href ?? '') } } : {}),
          });
        }
      }
      return { type: 'text', text: n.text, ...(marks.length ? { marks } : {}) };
    }
    const out: AdfNode = { type };
    if (type === 'heading') out.attrs = { level: Number(n.attrs?.level ?? 1) };
    if (type === 'orderedList') out.attrs = { order: Number(n.attrs?.start ?? 1) };
    if (type === 'codeBlock' && n.attrs?.language) out.attrs = { language: String(n.attrs.language) };
    const content = (n.content ?? []).map(conv).filter((c): c is AdfNode => c !== null);
    if (content.length || ['doc', 'paragraph', 'codeBlock', 'heading'].includes(type)) out.content = content;
    return out;
  };
  const adf = conv(doc);
  if (!adf) return null;
  // Drop empty trailing paragraphs the editor keeps after lists/blocks.
  while (adf.content?.length && adf.content.at(-1)!.type === 'paragraph' && !adf.content.at(-1)!.content?.length) {
    adf.content.pop();
  }
  const meaningful = (n: AdfNode): boolean =>
    Boolean(n.text?.trim()) ||
    n.type === 'rule' ||
    !(n.type in ADF_TO_TIPTAP_NODE) || // any carried-through Jira content counts
    (n.content ?? []).some(meaningful);
  if (!meaningful(adf)) return null;
  return { ...adf, attrs: undefined, version: 1 } as AdfNode & { version: number };
}

/** Short human label for a carried-through ADF node (used by the editor placeholders). */
export function opaqueLabel(json: string): { label: string; title: string } {
  let n: AdfNode;
  try {
    n = JSON.parse(json);
  } catch {
    return { label: 'Jira content', title: '' };
  }
  const a = n.attrs ?? {};
  const textOf = (x: AdfNode): string => (x.text ?? '') + (x.content ?? []).map(textOf).join(' ');
  const preview = (x: AdfNode, max = 60) => {
    const t = textOf(x).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  switch (n.type) {
    case 'mention':
      return { label: String(a.text ?? '@someone'), title: 'Mention' };
    case 'emoji':
      return { label: String(a.text ?? a.shortName ?? '🙂'), title: String(a.shortName ?? 'Emoji') };
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return { label: `🔗 ${String(a.url ?? 'link')}`, title: 'Smart link' };
    case 'date':
      return { label: `📅 ${a.timestamp ? new Date(Number(a.timestamp)).toLocaleDateString() : 'date'}`, title: 'Date' };
    case 'status':
      return { label: String(a.text ?? 'status').toUpperCase(), title: 'Status' };
    case 'mediaInline':
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return { label: n.type === 'mediaGroup' ? '📎 Attachments' : '🖼 Image', title: 'Attachment (shown in Jira)' };
    case 'table':
      return { label: `▦ Table · ${n.content?.length ?? 0} rows`, title: preview(n, 200) };
    case 'panel':
      return { label: `ⓘ Panel: ${preview(n) || '(empty)'}`, title: preview(n, 400) };
    case 'expand':
    case 'nestedExpand':
      return { label: `▸ ${String(a.title || 'Expand')}`, title: preview(n, 400) };
    case 'taskList':
      return { label: `☑ Checklist · ${n.content?.length ?? 0} items`, title: preview(n, 400) };
    case 'decisionList':
      return { label: `◆ Decisions · ${n.content?.length ?? 0}`, title: preview(n, 400) };
    default:
      return { label: n.type, title: preview(n, 200) };
  }
}
