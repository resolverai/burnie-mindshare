"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '@/components/ui/button';
import { Bold, Italic, List, ListOrdered, Save, X, Heading1, Heading2, Heading3, Undo, Redo } from 'lucide-react';
import '@/styles/tiptap.css';

interface RichTextEditorProps {
  content: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

// Helper function to convert plain text with \n to HTML
function textToHtml(text: string): string {
  if (!text) return '';
  
  // Split by double newlines for paragraphs, then by single newlines for line breaks
  const paragraphs = text.split('\n\n');
  
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
        const headingMatch = line.match(/^(Core Identity|Market Positioning|Direct Competitors|Global Competitors|Competitive Advantages|Primary Customer Segments|The Hero's Journey|Mission Statement|Brand Personality):/i);
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

export function RichTextEditor({ content, onSave, onCancel, isSaving = false }: RichTextEditorProps) {
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
    content: textToHtml(content), // Convert plain text to HTML
    immediatelyRender: false, // Fix SSR hydration mismatch
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[200px] text-muted-foreground',
      },
    },
  });

  if (!editor) {
    return null;
  }

  const handleSave = () => {
    const html = editor.getHTML();
    const plainText = htmlToText(html); // Convert HTML back to plain text
    onSave(plainText);
  };

  return (
    <div className="w-full border rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="bg-muted/30 border-b p-2 flex items-center gap-1 flex-wrap">
        {/* Undo/Redo */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Headings */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor.isActive('heading', { level: 2 }) ? 'bg-muted' : ''}
          title="Heading 2"
        >
          <Heading1 className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={editor.isActive('heading', { level: 3 }) ? 'bg-muted' : ''}
          title="Heading 3"
        >
          <Heading2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Text Formatting */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'bg-muted' : ''}
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'bg-muted' : ''}
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        {/* Lists */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'bg-muted' : ''}
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'bg-muted' : ''}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </Button>

        <div className="flex-1" />

        {/* Actions */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSaving}
        >
          <X className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          size="sm"
          disabled={isSaving}
        >
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} className="bg-white" />
    </div>
  );
}

