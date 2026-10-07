import type { JSONContent } from '@tiptap/react';

/**
 * Converters between Atlassian Document Format (Jira's rich text) and TipTap's JSON.
 * Only the subset the editor supports round-trips; `adfIsEditable` reports whether a document
 * contains anything else (images, tables, panels, mentions…) so callers can avoid lossy edits.
 */

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
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

/** True when every node and mark in the document is one the editor can round-trip. */
export function adfIsEditable(doc: AdfNode | null | undefined): boolean {
  if (!doc) return true;
  const ok = (n: AdfNode): boolean =>
    n.type in ADF_TO_TIPTAP_NODE &&
    (n.marks ?? []).every((m) => m.type in ADF_TO_TIPTAP_MARK) &&
    (n.content ?? []).every(ok);
  return ok(doc);
}

export function adfToTiptap(doc: AdfNode | null | undefined): JSONContent {
  if (!doc) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const conv = (n: AdfNode): JSONContent | null => {
    const type = ADF_TO_TIPTAP_NODE[n.type];
    if (!type) return n.text ? { type: 'text', text: n.text } : null;
    const out: JSONContent = { type };
    if (n.type === 'heading') out.attrs = { level: Number(n.attrs?.level ?? 1) };
    if (n.type === 'orderedList' && n.attrs?.order) out.attrs = { start: Number(n.attrs.order) };
    if (n.type === 'codeBlock' && n.attrs?.language) out.attrs = { language: n.attrs.language };
    if (n.text !== undefined) out.text = n.text;
    const marks = (n.marks ?? [])
      .filter((m) => m.type in ADF_TO_TIPTAP_MARK)
      .map((m) => ({
        type: ADF_TO_TIPTAP_MARK[m.type],
        ...(m.type === 'link' ? { attrs: { href: m.attrs?.href } } : {}),
      }));
    if (marks.length) out.marks = marks;
    const content = (n.content ?? []).map(conv).filter((c): c is JSONContent => c !== null);
    if (content.length) out.content = content;
    return out;
  };
  return conv(doc) ?? { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** TipTap JSON → ADF; returns null for an empty document (no description). */
export function tiptapToAdf(doc: JSONContent): AdfNode | null {
  const conv = (n: JSONContent): AdfNode | null => {
    const type = n.type && TIPTAP_TO_ADF_NODE[n.type];
    if (!type) return null;
    if (type === 'text') {
      if (!n.text) return null; // ADF forbids empty text nodes
      const marks = (n.marks ?? [])
        .filter((m) => m.type in TIPTAP_TO_ADF_MARK)
        .map((m) => ({
          type: TIPTAP_TO_ADF_MARK[m.type],
          ...(m.type === 'link' ? { attrs: { href: String(m.attrs?.href ?? '') } } : {}),
        }));
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
  const hasText = (n: AdfNode): boolean =>
    Boolean(n.text?.trim()) || n.type === 'rule' || (n.content ?? []).some(hasText);
  if (!hasText(adf)) return null;
  return { ...adf, attrs: undefined, version: 1 } as AdfNode & { version: number };
}
