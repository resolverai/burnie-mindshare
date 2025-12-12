"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Save, X, Heading1, Heading2, Undo, Redo } from 'lucide-react';
import '@/styles/tiptap.css';

interface RichTextEditorProps {
  content: string | string[] | any;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
  onChange?: (content: string) => void;
  hideButtons?: boolean;
}

// Normalize content to string
function normalizeContent(content: any): string {
  if (!content) return '';
  if (Array.isArray(content)) {
    return content.join('\n');
  }
  if (typeof content === 'object') {
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

// Helper function to convert plain text with \n to HTML
function textToHtml(text: string): string {
  if (!text) return '';
  
  const normalizedText = normalizeContent(text);
  
  // Split by double newlines for paragraphs, then by single newlines for line breaks
  const paragraphs = normalizedText.split('\n\n');
  
  return paragraphs
    .map(para => {
      if (!para.trim()) return '';
      
      // Split paragraph by single newlines
      const lines = para.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) return '';
      
      // Process each line to detect headings, bold text, etc.
      const processedLines = lines.map(line => {
        let processedLine = line;
        
        // Detect headings (lines that end with colon and look like section headers)
        const headingMatch = line.match(/^(Core Identity|Market Positioning|Direct Competitors|Global Competitors|Competitive Advantages|Primary Customer Segments|The Hero's Journey|Mission Statement|Brand Personality|Business Overview|Why Customers Choose|Customer Demographics|Psychographics|Primary Value Drivers|Emotional Benefits|Top Revenue Generators|Key need|Pain points|Key interest):/i);
        if (headingMatch) {
          return `<h3><strong>${line}</strong></h3>`;
        }
        
        // Detect and preserve bold for section labels (text before colon or dash)
        // Pattern: "• Label:" or "Label:" or "1. Label:" at the start
        const boldLabelMatch = line.match(/^(\d+\.\s|•\s)?(.+?)(:|–|—)(.*)$/);
        if (boldLabelMatch) {
          const [, prefix = '', label, separator, rest] = boldLabelMatch;
          processedLine = `${prefix}<strong>${label}${separator}</strong>${rest}`;
        }
        
        // Convert **bold** markdown syntax to <strong>
        processedLine = processedLine.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // Convert *italic* markdown syntax to <em>
        processedLine = processedLine.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        return processedLine;
      });
      
      if (processedLines.length === 1) {
        const line = processedLines[0];
        // If it's already a heading, return as-is
        if (line.startsWith('<h')) return line;
        return `<p>${line}</p>`;
      }
      
      // Multiple lines in same paragraph - join with <br>
      return `<p>${processedLines.join('<br>')}</p>`;
    })
    .filter(p => p)
    .join('');
}

// Helper function to convert HTML back to plain text with \n (preserving formatting)
function htmlToText(html: string): string {
  if (!html) return '';
  
  // Convert HTML to plain text while preserving structure
  let text = html
    // Handle headings - preserve them as plain text with newlines
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/g, '$1\n')
    // Convert paragraphs to double newlines
    .replace(/<\/p><p>/g, '\n\n')
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n')
    // Convert line breaks to newlines
    .replace(/<br\s*\/?>/g, '\n')
    // Handle lists
    .replace(/<\/li><li>/g, '\n')
    .replace(/<li>/g, '')
    .replace(/<\/li>/g, '\n')
    .replace(/<\/?ul>/g, '')
    .replace(/<\/?ol>/g, '')
    // Keep bold and italic as-is (strip tags but keep content)
    .replace(/<strong>/g, '')
    .replace(/<\/strong>/g, '')
    .replace(/<em>/g, '')
    .replace(/<\/em>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  
  // Remove excessive newlines (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text;
}

export function RichTextEditor({ 
  content, 
  onSave, 
  onCancel, 
  isSaving = false,
  onChange,
  hideButtons = false,
}: RichTextEditorProps) {
  const normalizedContent = normalizeContent(content);
  
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
      }),
    ],
    content: textToHtml(normalizedContent),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[200px] text-gray-600',
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        const html = editor.getHTML();
        const plainText = htmlToText(html);
        onChange(plainText);
      }
    },
  });

  if (!editor) {
    return null;
  }

  const handleSave = () => {
    const html = editor.getHTML();
    const plainText = htmlToText(html);
    onSave(plainText);
  };

  return (
    <div className="w-full border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 p-2 flex items-center gap-1 flex-wrap">
        {/* Undo/Redo */}
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-2 hover:bg-gray-200 rounded text-gray-600 disabled:opacity-40"
          title="Undo"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-2 hover:bg-gray-200 rounded text-gray-600 disabled:opacity-40"
          title="Redo"
        >
          <Redo className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Headings */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-200' : ''}`}
          title="Heading 2"
        >
          <Heading1 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('heading', { level: 3 }) ? 'bg-gray-200' : ''}`}
          title="Heading 3"
        >
          <Heading2 className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Text Formatting */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('bold') ? 'bg-gray-200' : ''}`}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('italic') ? 'bg-gray-200' : ''}`}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Lists */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('bulletList') ? 'bg-gray-200' : ''}`}
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 hover:bg-gray-200 rounded text-gray-600 ${editor.isActive('orderedList') ? 'bg-gray-200' : ''}`}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        {/* Actions */}
        {!hideButtons && (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 bg-white flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium flex items-center gap-1 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} className="bg-white" />
    </div>
  );
}

