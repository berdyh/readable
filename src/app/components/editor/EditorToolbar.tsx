import type { Editor } from "@tiptap/react";

type EditorToolbarProps = {
  editor: Editor;
};

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const applyFormatting = () => {
    editor.chain().focus().toggleUnderline().run();
    editor.chain().focus().setFontFamily("Inter").run();
  };

  return (
    <button type="button" onClick={applyFormatting}>
      Format
    </button>
  );
}
