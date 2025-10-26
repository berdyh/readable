# Editor Workspace Architecture

## Component Tree

```
EditorWorkspace (client component)
├─ useEditorWorkspaceState() ─ manages theme + inline dialogs
├─ EditorChrome
│  ├─ ToolbarRibbon
│  │  ├─ ToolbarGroup (text style)
│  │  ├─ ToolbarGroup (insertions / AI actions)
│  │  └─ ToolbarGroup (alignment & page links)
│  └─ PersonaToggle + CollaboratorAvatars
├─ EditorCanvas
│  ├─ <EditorContent /> from Tiptap
│  ├─ BubbleMenuContainer (selection actions)
│  └─ SlashCommandMenu (command palette)
└─ FloatingStatusToast (imperative feedback)
```

- `EditorWorkspace` owns the `Editor` instance, reacts to focus/selection
  changes, and passes canonical state to the chrome components.
- `ToolbarRibbon` is data-driven (arrays of button descriptors) so we can map
  AppFlowy toolbar items to React buttons without duplicating logic.
- The slash command menu listens to the `/` suggestion context and renders an
  accessible list (keyboard navigation + mouse support) for inserting blocks.

## State Diagram

```
            ┌────────────┐
            │ Idle (view │
            │ only)      │
            └─────┬──────┘
                  │ focus editor
                  ▼
           ┌──────────────┐
           │ Editing      │
           │ (caret mode) │
           └─────┬────────┘
        selection│ set
                  ▼
        ┌──────────────────┐
        │ Selection Active │◄───────────────────────┐
        └─────┬────────────┘                        │
   slash "/"  │ triggers                            │
              ▼                                      │
     ┌──────────────────┐ dismiss menu               │
     │ Slash Menu Open  │──────────┐                 │
     └──────────────────┘          │                 │
     insert block │                │selection change │
                  ▼                │                 │
           ┌──────────────┐        │                 │
           │ Editing      │────────┘                 │
           │ (caret mode) │                          │
           └──────────────┘                          │
                  ▲                                  │
          blur editor │                              │
                  └──────────────────────────────────┘
```

- Toolbar commands keep the finite state machine inside the _Editing_ region.
- Slash menu is nested in the Selection state and closes automatically when
  focus moves or a block is inserted.
- Persona toggle and AI helpers live outside the editor FSM but dispatch
  commands back into the editing state.

## AppFlowy Widget Audit

| Flutter Widget / Service                             | Purpose                                                               | React Analogue                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DesktopFloatingToolbar`                             | Renders inline formatting popover on selection.                       | `BubbleMenu` + Radix `Popover` anchored to DOM range.                                      |
| `custom_text_heading_item.dart`                      | Grouped heading/paragraph toggle with keyboard shortcuts.             | Toolbar button group invoking `editor.chain().toggleHeading({ level })`.                   |
| `custom_text_color_toolbar_item.dart` / highlight    | Provides palette pickers for text + highlight colors.                 | Color drop-down using tailwind palette & CSS vars in light/dark mode.                      |
| `InlineActionsService` (child page, reminders, etc.) | Injects contextual “@mention” widgets via command palette.            | Slash command definitions with handlers that open React modals or insert inline nodes.     |
| `commandShortcutEvents` / `characterShortcutEvents`  | Defines keyboard shortcuts (Cmd+B, Cmd+K, “## ” heading trigger…).    | Tiptap keymap extension hooking `onKeyDown` to mirror the same commands.                   |
| `MoreOptionToolbarItem`                              | Overflow menu for less-used actions, including export & clear styles. | Radix `DropdownMenu` fed from the same descriptor array that powers toolbar button groups. |

### Key Takeaways for React Implementation

1. **Data-driven toolbars** – AppFlowy models each toolbar item as a descriptor;
   mirroring that pattern lets us keep a single source of truth for buttons,
   shortcuts, and slash commands.
2. **Theming hooks** – Flutter relies on `EditorStyleCustomizer`; in React we
   expose a `useEditorTheme()` hook that reads CSS variables (supporting light
   and dark mode automatically).
3. **Inline action extensibility** – Build the slash command menu around an
   extension registry so later features (reminders, child pages) can register
   UI + handlers without modifying the core editor.
