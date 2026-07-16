"use client";

/**
 * SECURITY NOTE: This component does NOT sanitise HTML. `onChange` emits
 * raw `editor.getHTML()` output straight from Tiptap/ProseMirror. Callers
 * MUST sanitise on the server (see lib/sanitize.ts) before persisting or
 * rendering this content elsewhere — never trust it as-is (architecture
 * decision, see CLAUDE.md "Security Requirements").
 *
 * Tiptap 3.28 specifics this component is written against:
 * - `@tiptap/starter-kit` v3 bundles `@tiptap/extension-link` (configurable
 *   via `StarterKit.configure({ link: {...} })`), so no separate link
 *   package/install is needed — link/unlink toolbar buttons are included.
 * - `Placeholder` is re-exported from `@tiptap/extensions` via
 *   `@tiptap/extension-placeholder`; empty state is marked with the
 *   `is-editor-empty` (whole doc) / `is-empty` (per-node) classes, styled
 *   in ./editor.css.
 * - `useEditor({ immediatelyRender: false, ... })` is required for SSR
 *   safety in `@tiptap/react` v3 (the editor is null on first render/mount
 *   and becomes available after the client effect runs).
 */

import { useCallback, useEffect, type CSSProperties } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
  Unlink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import "./editor.css";

/** `--flux-editor-min-height` is a custom property consumed by editor.css. */
type EditorContentStyle = CSSProperties & {
  "--flux-editor-min-height"?: string;
};

interface RichTextEditorProps {
  /** Current content as HTML. */
  value: string;
  /** Called with the new HTML on every editor update. */
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  minHeight?: string;
  autofocus?: boolean;
  className?: string;
}

interface ToolbarButtonConfig {
  label: string;
  icon: typeof Bold;
  isActive?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
}

function ToolbarButton({
  label,
  icon: Icon,
  isActive,
  isDisabled,
  onClick,
}: ToolbarButtonConfig) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={isActive}
      disabled={isDisabled}
      onMouseDown={(event) => {
        // Prevent the toolbar click from stealing focus/selection from the editor.
        event.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "text-muted-foreground transition-colors duration-150 motion-reduce:transition-none",
        "hover:bg-surface-raised hover:text-foreground",
        isActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </Button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  editable = true,
  minHeight = "120px",
  autofocus = false,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    autofocus: autofocus ? "end" : false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        // Padding lives on the actual contenteditable element (not just the
        // wrapper) so clicking anywhere in the padded area focuses the editor.
        class: "flux-prose px-3 py-2.5 focus:outline-none",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange(updatedEditor.getHTML());
    },
    // Deliberately created once: external `value` sync is handled by the
    // effect below, and `onChange`/`placeholder` are read fresh inside the
    // callbacks Tiptap invokes, so they don't need to be dependencies here.
  }, []);

  // Keep editable/placeholder in sync if they change after mount.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // Controlled-ish sync: only push external `value` changes into the editor
  // when they didn't originate from this editor's own onChange emission.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: ctxEditor }) => {
      if (!ctxEditor) return null;
      return {
        bold: ctxEditor.isActive("bold"),
        italic: ctxEditor.isActive("italic"),
        strike: ctxEditor.isActive("strike"),
        code: ctxEditor.isActive("code"),
        heading1: ctxEditor.isActive("heading", { level: 1 }),
        heading2: ctxEditor.isActive("heading", { level: 2 }),
        heading3: ctxEditor.isActive("heading", { level: 3 }),
        bulletList: ctxEditor.isActive("bulletList"),
        orderedList: ctxEditor.isActive("orderedList"),
        blockquote: ctxEditor.isActive("blockquote"),
        codeBlock: ctxEditor.isActive("codeBlock"),
        link: ctxEditor.isActive("link"),
        canUndo: ctxEditor.can().undo(),
        canRedo: ctxEditor.can().redo(),
      };
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as
      | string
      | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");

    if (url === null) return; // cancelled

    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const unsetLink = useCallback(() => {
    editor?.chain().focus().unsetLink().run();
  }, [editor]);

  if (!editable) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-surface",
          className
        )}
      >
        <EditorContent
          editor={editor}
          style={{ "--flux-editor-min-height": minHeight } as EditorContentStyle}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface",
        "focus-within:ring-2 focus-within:ring-ring/50",
        "transition-shadow duration-150 motion-reduce:transition-none",
        className
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
      >
        <ToolbarButton
          label="Bold"
          icon={Bold}
          isActive={toolbarState?.bold}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          icon={Italic}
          isActive={toolbarState?.italic}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Strikethrough"
          icon={Strikethrough}
          isActive={toolbarState?.strike}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          label="Inline code"
          icon={Code}
          isActive={toolbarState?.code}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        />

        <Separator />

        <ToolbarButton
          label="Heading 1"
          icon={Heading1}
          isActive={toolbarState?.heading1}
          isDisabled={!editor}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolbarButton
          label="Heading 2"
          icon={Heading2}
          isActive={toolbarState?.heading2}
          isDisabled={!editor}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarButton
          label="Heading 3"
          icon={Heading3}
          isActive={toolbarState?.heading3}
          isDisabled={!editor}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />

        <Separator />

        <ToolbarButton
          label="Bullet list"
          icon={List}
          isActive={toolbarState?.bulletList}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Ordered list"
          icon={ListOrdered}
          isActive={toolbarState?.orderedList}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Blockquote"
          icon={Quote}
          isActive={toolbarState?.blockquote}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Code block"
          icon={Code2}
          isActive={toolbarState?.codeBlock}
          isDisabled={!editor}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        />

        <Separator />

        <ToolbarButton
          label="Add link"
          icon={LinkIcon}
          isActive={toolbarState?.link}
          isDisabled={!editor}
          onClick={setLink}
        />
        <ToolbarButton
          label="Remove link"
          icon={Unlink}
          isDisabled={!editor || !toolbarState?.link}
          onClick={unsetLink}
        />

        <Separator />

        <ToolbarButton
          label="Undo"
          icon={Undo2}
          isDisabled={!editor || !toolbarState?.canUndo}
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Redo"
          icon={Redo2}
          isDisabled={!editor || !toolbarState?.canRedo}
          onClick={() => editor?.chain().focus().redo().run()}
        />
      </div>

      <EditorContent
        editor={editor}
        style={{ "--flux-editor-min-height": minHeight } as EditorContentStyle}
      />
    </div>
  );
}

function Separator() {
  return <div aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}
