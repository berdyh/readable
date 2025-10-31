# Markdown Format Support

The block-based editor now stores content in **Markdown format** instead of HTML, while still using TipTap internally for rich text editing.

## How It Works

1. **Storage Format**: All block content is stored as Markdown
2. **Editing Format**: TipTap uses HTML internally for editing (better cursor management, formatting, etc.)
3. **Conversion**: Automatic conversion between Markdown ↔ HTML happens transparently

## Markdown Syntax Supported

### Text Blocks

- **Bold**: `**text**` or `__text__`
- **Italic**: `*text*` or `_text_`
- **Strikethrough**: `~~text~~`
- **Inline code**: `` `code` ``

### Headings

- **Heading 1**: `# Heading`
- **Heading 2**: `## Heading`
- **Heading 3**: `### Heading`

### Lists

- **Bullet lists**: `* item` or `- item`
- **Numbered lists**: `1. item` (automatically numbered)
- **Todo lists**: `[ ] unchecked` or `[x] checked`

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

- **Blockquote**: `> quoted text`

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
