import { Mark, Node, mergeAttributes } from '@tiptap/core';
import { OPAQUE, opaqueLabel } from '@/lib/adf';

/** A JSON-string attribute stored on the DOM as data-adf so copy/paste keeps it. */
const jsonAttr = {
  json: {
    default: '{}',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-adf') ?? '{}',
    renderHTML: (attrs: { json: string }) => ({ 'data-adf': attrs.json }),
  },
};

/** Inline Jira content the editor can't edit (mention, emoji, smart link, date, status…): a read-only chip. */
export const AdfInline = Node.create({
  name: OPAQUE.inline,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => jsonAttr,
  parseHTML: () => [{ tag: 'span[data-adf-inline]' }],
  renderHTML({ node, HTMLAttributes }) {
    const { label, title } = opaqueLabel(node.attrs.json);
    return ['span', mergeAttributes(HTMLAttributes, { 'data-adf-inline': '', class: 'adf-chip', title, contenteditable: 'false' }), label];
  },
});

/** Block Jira content the editor can't edit (image, table, panel, expand, checklist…): a placeholder card. */
export const AdfBlock = Node.create({
  name: OPAQUE.block,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => jsonAttr,
  parseHTML: () => [{ tag: 'div[data-adf-block]' }],
  renderHTML({ node, HTMLAttributes }) {
    const { label, title } = opaqueLabel(node.attrs.json);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-adf-block': '', class: 'adf-block', title, contenteditable: 'false' }),
      ['span', { class: 'adf-block-label' }, label],
      ['span', { class: 'adf-block-hint' }, 'kept as-is · edit in Jira'],
    ];
  },
});

/** Text formatting the editor doesn't support (text colour, sub/superscript, comments…), kept on the text. */
export const AdfMarks = Mark.create({
  name: OPAQUE.marks,
  addAttributes: () => jsonAttr,
  parseHTML: () => [{ tag: 'span[data-adf-marks]' }],
  renderHTML({ mark, HTMLAttributes }) {
    let color: string | undefined;
    try {
      const marks = JSON.parse(mark.attrs.json) as { type: string; attrs?: { color?: string } }[];
      color = marks.find((m) => m.type === 'textColor')?.attrs?.color;
    } catch {
      /* no styling */
    }
    return ['span', mergeAttributes(HTMLAttributes, { 'data-adf-marks': '', ...(color ? { style: `color:${color}` } : {}) }), 0];
  },
});
