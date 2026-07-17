"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

export interface MentionItem {
  /** Username — what gets inserted as `@username` and matched server-side. */
  id: string;
  name: string;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: { id: string; label: string }) => void;
}

/**
 * The @-mention autocomplete dropdown. Rendered by the Tiptap suggestion
 * plugin (see RichTextEditor). Keyboard-driven: ↑/↓ move, Enter/Tab select,
 * exposed to the plugin via the imperative `onKeyDown` handle.
 */
export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    function select(index: number) {
      const item = items[index];
      // Insert `@username`: the mention node's id IS the username, so the
      // rendered text is `@username`, which the server-side parser matches.
      if (item) command({ id: item.id, label: item.id });
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="glass min-w-44 rounded-lg p-1 text-sm text-muted-foreground">
          <div className="px-2 py-1.5">No members match</div>
        </div>
      );
    }

    return (
      <div className="glass min-w-44 max-w-64 overflow-hidden rounded-lg p-1">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              select(index);
            }}
            onMouseEnter={() => setSelected(index)}
            className={
              "flex w-full flex-col items-start gap-0 rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
              (index === selected
                ? "bg-primary/15 text-foreground"
                : "text-foreground hover:bg-surface-raised")
            }
          >
            <span className="truncate font-medium">{item.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              @{item.id}
            </span>
          </button>
        ))}
      </div>
    );
  },
);
