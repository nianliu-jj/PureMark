import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const AUTO_PAIR_INSERT_PAIRS = {
  "(": ")",
  "{": "}",
  '"': '"',
  "'": "'",
} as const;

const WRAP_ONLY_PAIRS = {
  "[": "]",
  "`": "`",
} as const;

const AUTO_PAIR_PAIRS = {
  ...AUTO_PAIR_INSERT_PAIRS,
  ...WRAP_ONLY_PAIRS,
} as const;

const CLOSING_CHARS = new Set<string>(Object.values(AUTO_PAIR_PAIRS));

function getCharBefore(doc: ProseMirrorNode, pos: number): string {
  if (pos <= 0) return "";
  return doc.textBetween(Math.max(0, pos - 1), pos, "", "");
}

function getCharAfter(doc: ProseMirrorNode, pos: number): string {
  const maxPos = doc.content.size;
  if (pos >= maxPos) return "";
  return doc.textBetween(pos, Math.min(maxPos, pos + 1), "", "");
}

function isWordChar(char: string): boolean {
  return /^[A-Za-z0-9_]$/.test(char);
}

function isBoundaryChar(char: string): boolean {
  return char === "" || /[\s)\]}>.,;:!?"'`，。；：！？、】【）】》]/.test(char);
}

function shouldWrapSelection(view: EditorView, char: string): boolean {
  const { selection } = view.state;
  return (
    !selection.empty &&
    selection.$from.sameParent(selection.$to) &&
    selection.$from.parent.inlineContent &&
    char in AUTO_PAIR_PAIRS
  );
}

function shouldAutoInsert(char: string, prevChar: string, nextChar: string): boolean {
  if (!(char in AUTO_PAIR_INSERT_PAIRS) || prevChar === "\\") {
    return false;
  }

  if (char === "(") {
    return prevChar !== "]";
  }

  if (char === '"') {
    return isBoundaryChar(nextChar);
  }

  if (char === "'") {
    return !isWordChar(prevChar) && isBoundaryChar(nextChar);
  }

  return true;
}

function shouldSkipClosing(char: string, prevChar: string, nextChar: string): boolean {
  if (!CLOSING_CHARS.has(char) || nextChar !== char) {
    return false;
  }

  if (char === "'" && isWordChar(prevChar)) {
    return false;
  }

  return true;
}

function wrapSelection(view: EditorView, char: keyof typeof AUTO_PAIR_PAIRS): boolean {
  const { state } = view;
  const { from, to } = state.selection;
  const selectedText = state.doc.textBetween(from, to, "", "");
  const closing = AUTO_PAIR_PAIRS[char];
  const tr = state.tr.insertText(`${char}${selectedText}${closing}`, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + selectedText.length));
  view.dispatch(tr);
  return true;
}

export function createAutoPairPlugin(isEnabled: () => boolean): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (!isEnabled() || text.length !== 1) {
          return false;
        }

        const char = text as keyof typeof AUTO_PAIR_PAIRS;
        if (!(char in AUTO_PAIR_PAIRS)) {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        if (!selection.$from.parent.inlineContent) {
          return false;
        }

        if (shouldWrapSelection(view, char)) {
          return wrapSelection(view, char);
        }

        const prevChar = getCharBefore(state.doc, from);
        const nextChar = getCharAfter(state.doc, to);

        if (shouldSkipClosing(char, prevChar, nextChar)) {
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, to + 1)));
          return true;
        }

        if (!shouldAutoInsert(char, prevChar, nextChar)) {
          return false;
        }

        const closing = AUTO_PAIR_INSERT_PAIRS[char as keyof typeof AUTO_PAIR_INSERT_PAIRS];
        if (!closing) {
          return false;
        }

        const tr = state.tr.insertText(`${char}${closing}`, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        view.dispatch(tr);
        return true;
      },

      handleKeyDown(view, event) {
        if (!isEnabled() || event.key !== "Backspace") {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        if (!selection.empty) {
          return false;
        }

        const pos = selection.from;
        const prevChar = getCharBefore(state.doc, pos);
        const nextChar = getCharAfter(state.doc, pos);
        const expectedClosing = AUTO_PAIR_PAIRS[prevChar as keyof typeof AUTO_PAIR_PAIRS];
        if (!expectedClosing || expectedClosing !== nextChar) {
          return false;
        }

        event.preventDefault();
        view.dispatch(state.tr.delete(pos - 1, pos + 1));
        return true;
      },
    },
  });
}
