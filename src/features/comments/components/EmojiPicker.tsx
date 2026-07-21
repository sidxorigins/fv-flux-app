"use client";

import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

export interface EmojiPickerProps {
  onSelect: (native: string) => void;
}

/**
 * emoji-mart picker themed to the app's dark palette (see the `em-emoji-picker`
 * block in globals.css). Callers dynamic-import this (`next/dynamic`,
 * ssr:false) and render it inside a Popover so the ~large emoji dataset only
 * loads when the picker first opens — see RichTextEditor's `showEmoji` toolbar
 * button.
 *
 * React 19 note: `@emoji-mart/react`'s `Picker` wrapper is a thin
 * useRef/useEffect adapter around the vanilla `emoji-mart` package's own
 * (self-rendering) Picker class — it doesn't touch any React APIs removed or
 * changed in React 19. Verified to render under React 19.2.4 via the
 * @emoji-mart/react adapter. If that ever regresses, fall back to mounting
 * `emoji-mart`'s class `Picker` into a `ref`'d div in a `useEffect` directly
 * (documented in emoji-mart's README), keeping this same `{ onSelect }` prop
 * shape so callers don't change.
 */
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  return (
    <Picker
      data={data}
      theme="dark"
      previewPosition="none"
      skinTonePosition="search"
      navPosition="top"
      onEmojiSelect={(e: { native: string }) => onSelect(e.native)}
    />
  );
}
