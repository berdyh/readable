# Markdown Format Support

The block-based editor now stores content in **Markdown format** instead of HTML, while still using TipTap internally for rich text editing.

## How It Works

1. **Storage Format**: All block content is stored as Markdown
2. **Editing Format**: TipTap uses HTML internally for editing (better cursor management, formatting, etc.)
3. **Conversion**: Automatic conversion between Markdown ↔ HTML happens transparently

### The one storage rule

**Content never carries the block-level marker its `type` already encodes.** A `heading_2`
stores `Introduction`, not `## Introduction`; a `bullet_list` stores `key point`, not
`- key point`. The marker is added when the block is rendered and dropped when it is read back.

Storing it twice means the two copies can disagree, and the round trip "corrects" the
difference — rewriting a block the reader never touched, which is exactly what unlocking a
generated heading used to do. Every producer (`parsers.ts`, `store.tsx`) already writes bare
content; the serializer is what drifted.

Markers that carry something the type does **not** encode stay in the content, because there is
nowhere else for them to live:

| Marker              | Stored? | Why                                                   |
| ------------------- | ------- | ----------------------------------------------------- |
| `#`, `-`, `1.`, `>` | No      | `heading_*` / `bullet_list` / `number_list` / `quote` |
| `[ ]` / `[x]`       | Yes     | carries the to-do's checked state                     |
| ` ```lang `         | Yes     | carries the code block's language                     |

Inline markdown (`**bold**`, `*italic*`, links, `` `code` ``) is stored in content for every
block type. The invariant that keeps this honest is pinned in `utils/markdown.test.ts`:
`htmlToMarkdown(markdownToHtml(content, type), type) === content`.

## Markdown Syntax Supported

### Text Blocks

- **Bold**: `**text**` or `__text__`
- **Italic**: `*text*` or `_text_`
- **Strikethrough**: `~~text~~`
- **Inline code**: `` `code` ``

### Headings

Stored bare — the level is the block type (`heading_1`, `heading_2`, `heading_3`), so
`Heading`, not `# Heading`. A leading `#` in incoming content is accepted and dropped.

### Lists

- **Bullet lists** (`bullet_list`): stored bare as `item`; rendered as `- item`
- **Numbered lists** (`number_list`): stored bare as `item`; numbered by position, so no
  start number is kept
- **Todo lists** (`to_do_list`): `[ ] unchecked` or `[x] checked` — the marker stays, it is
  the checked state

### Code Blocks

- **Code block with language**:
  ````
  ```javascript
  code here
  ```
  ````
- **Plain code block**:
  ````
  ```
  code here
  ```
  ````

### Quotes

Stored bare as `quoted text` — the `quote` block type is the `>`; a leading `>` in incoming
content is accepted and dropped.

### Images

- **Images**: `![alt text](image-url)`
- Figures are integrated seamlessly through the markdown format

## Technical Implementation

### Files Modified

1. **`utils/markdown.ts`**: Conversion utilities (HTML ↔ Markdown)
2. **`blocks/TipTapBlock.tsx`**: Updated to use Markdown for storage
3. **`blocks/TodoBlock.tsx`**: Handles `[ ]` and `[x]` syntax
4. **`store.tsx`**: Initializes todo blocks with `[ ] ` syntax

### Libraries Used

- **`turndown`**: HTML → Markdown conversion
- **`marked`**: Markdown → HTML parsing

## Lock/Unlock Functionality

The lock/unlock (edit permission) button continues to work seamlessly:

- Locked blocks are read-only (cannot be edited)
- Markdown content is preserved when locking/unlocking
- Slash commands still work in locked blocks (but insert after the block)

## Benefits

1. **Human-readable**: Content is stored in a readable Markdown format
2. **Portable**: Markdown can be easily exported or migrated
3. **Standard**: Uses common Markdown syntax familiar to developers
4. **Rich editing**: Still benefits from TipTap's rich text editing features
5. **Seamless images**: Images and figures work naturally with markdown syntax
