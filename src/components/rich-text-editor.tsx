import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { AdfBlock, AdfInline, AdfMarks } from '@/components/adf-extensions';
import {
  BoldIcon,
  CodeIcon,
  CodeSquareIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

interface Props {
  /** Initial content (TipTap JSON). Changing it after mount resets the editor. */
  content: JSONContent;
  onChange: (doc: JSONContent) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Jira-style WYSIWYG editor (TipTap) used for issue descriptions. */
export function RichTextEditor({ content, onChange, placeholder = 'Add a description…', className, autoFocus }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder }),
      // Carry Jira content the editor can't edit through untouched (see lib/adf.ts).
      AdfInline,
      AdfBlock,
      AdfMarks,
    ],
    content,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'jira-prose min-h-32 max-h-[50vh] overflow-y-auto px-3 py-2 outline-none',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON()),
  });

  // Reset only when the caller provides a document with different *content* (e.g. another issue).
  // Comparing by value matters: parents re-render on every keystroke and may pass an equal but new
  // object, which must not wipe what the user is typing.
  const contentKey = JSON.stringify(content);
  const lastKey = useRef(contentKey);
  useEffect(() => {
    if (!editor || contentKey === lastKey.current) return;
    lastKey.current = contentKey;
    editor.commands.setContent(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, contentKey]);

  return (
    <div
      className={cn(
        'rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        className,
      )}
    >
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

const TEXT_STYLES = [
  { id: 'p', label: 'Normal text' },
  { id: '1', label: 'Heading 1' },
  { id: '2', label: 'Heading 2' },
  { id: '3', label: 'Heading 3' },
];

function Toolbar({ editor }: { editor: Editor }) {
  // Re-render the toolbar when the selection's formatting changes.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 1 }) ? '1' : e.isActive('heading', { level: 2 }) ? '2' : e.isActive('heading', { level: 3 }) ? '3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const mark = (pressed: boolean, label: string, Icon: typeof BoldIcon, run: () => void) => (
    <Toggle size="sm" pressed={pressed} onPressedChange={run} aria-label={label} title={label} className="size-7 min-w-7 px-0">
      <Icon />
    </Toggle>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      <Select
        value={s.style}
        onValueChange={(v) =>
          v === 'p'
            ? editor.chain().focus().setParagraph().run()
            : editor.chain().focus().setHeading({ level: Number(v) as 1 | 2 | 3 }).run()
        }
      >
        <SelectTrigger size="sm" className="h-7 w-34 border-0 shadow-none" aria-label="Text style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEXT_STYLES.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Separator orientation="vertical" className="mx-1 h-5!" />
      {mark(s.bold, 'Bold (⌘B)', BoldIcon, () => editor.chain().focus().toggleBold().run())}
      {mark(s.italic, 'Italic (⌘I)', ItalicIcon, () => editor.chain().focus().toggleItalic().run())}
      {mark(s.underline, 'Underline (⌘U)', UnderlineIcon, () => editor.chain().focus().toggleUnderline().run())}
      {mark(s.strike, 'Strikethrough', StrikethroughIcon, () => editor.chain().focus().toggleStrike().run())}
      {mark(s.code, 'Inline code', CodeIcon, () => editor.chain().focus().toggleCode().run())}
      <LinkButton editor={editor} active={s.link} />
      <Separator orientation="vertical" className="mx-1 h-5!" />
      {mark(s.bullet, 'Bullet list', ListIcon, () => editor.chain().focus().toggleBulletList().run())}
      {mark(s.ordered, 'Numbered list', ListOrderedIcon, () => editor.chain().focus().toggleOrderedList().run())}
      {mark(s.quote, 'Quote', QuoteIcon, () => editor.chain().focus().toggleBlockquote().run())}
      {mark(s.codeBlock, 'Code block', CodeSquareIcon, () => editor.chain().focus().toggleCodeBlock().run())}
      {mark(false, 'Divider', MinusIcon, () => editor.chain().focus().setHorizontalRule().run())}
      <div className="ml-auto flex">
        <Button type="button" variant="ghost" size="icon-sm" className="size-7" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()} aria-label="Undo">
          <Undo2Icon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="size-7" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()} aria-label="Redo">
          <Redo2Icon />
        </Button>
      </div>
    </div>
  );
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setUrl(String(editor.getAttributes('link').href ?? ''));
      }}
    >
      <PopoverTrigger asChild>
        <Toggle size="sm" pressed={active} aria-label="Link" title="Link" className="size-7 min-w-7 px-0">
          <LinkIcon />
        </Toggle>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation(); // don't submit an enclosing form
            const href = url.trim();
            if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            else editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setOpen(false);
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-7" autoFocus />
          <Button type="submit" size="sm">{url.trim() ? 'Apply' : 'Remove'}</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
