'use client';

import React, { useState, useEffect } from 'react';
import { Save, X, Bold, List, Undo } from 'lucide-react';

interface SimpleRichTextEditorProps {
  content: string | string[] | any;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
  onChange?: (content: string) => void;
  hideButtons?: boolean;
}

// Convert any input to a proper string
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

export function SimpleRichTextEditor({
  content,
  onSave,
  onCancel,
  isSaving = false,
  onChange,
  hideButtons = false,
}: SimpleRichTextEditorProps) {
  const [text, setText] = useState(() => normalizeContent(content));
  const [originalText] = useState(() => normalizeContent(content));

  useEffect(() => {
    setText(normalizeContent(content));
  }, [content]);

  const handleTextChange = (newText: string) => {
    setText(newText);
    if (onChange) {
      onChange(newText);
    }
  };

  const handleSave = () => {
    onSave(text);
  };

  const handleReset = () => {
    setText(originalText);
  };

  // Helper to insert text at cursor
  const insertAtCursor = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('rich-text-area') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = text.substring(start, end);
    const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
    setText(newText);

    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
    }, 0);
  };

  const addBulletPoint = () => {
    const textarea = document.getElementById('rich-text-area') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const newText = text.substring(0, lineStart) + '• ' + text.substring(lineStart);
    setText(newText);
  };

  const addNumberedItem = () => {
    const textarea = document.getElementById('rich-text-area') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    
    // Count existing numbered items
    const lines = text.substring(0, lineStart).split('\n');
    let lastNumber = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^(\d+)\./);
      if (match) {
        lastNumber = parseInt(match[1]);
        break;
      }
    }
    
    const newText = text.substring(0, lineStart) + `${lastNumber + 1}. ` + text.substring(lineStart);
    setText(newText);
  };

  const addSectionHeader = () => {
    const textarea = document.getElementById('rich-text-area') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = text.substring(start, end);
    
    if (selectedText && !selectedText.endsWith(':')) {
      const newText = text.substring(0, start) + selectedText + ':' + text.substring(end);
      setText(newText);
    }
  };

  return (
    <div className="w-full border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 p-2 flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={handleReset}
          className="p-2 hover:bg-gray-200 rounded text-gray-600"
          title="Reset to original"
        >
          <Undo className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-gray-300 mx-1" />

        <button
          type="button"
          onClick={addSectionHeader}
          className="px-2 py-1 hover:bg-gray-200 rounded text-gray-600 text-sm font-medium"
          title="Make selection a header (add colon)"
        >
          H:
        </button>

        <button
          type="button"
          onClick={addBulletPoint}
          className="p-2 hover:bg-gray-200 rounded text-gray-600"
          title="Add bullet point"
        >
          <List className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={addNumberedItem}
          className="px-2 py-1 hover:bg-gray-200 rounded text-gray-600 text-sm font-medium"
          title="Add numbered item"
        >
          1.
        </button>

        <div className="flex-1" />

        {!hideButtons && (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 bg-white flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium flex items-center gap-1 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Text Area */}
      <textarea
        id="rich-text-area"
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        className="w-full min-h-[250px] p-4 text-sm text-gray-900 bg-white resize-y focus:outline-none focus:ring-0 border-0"
        placeholder="Enter text here..."
        style={{ fontFamily: 'inherit', lineHeight: '1.6' }}
      />

      {/* Preview hint */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-2">
        <p className="text-xs text-gray-500">
          <strong>Formatting tips:</strong> Lines ending with <code className="bg-gray-200 px-1 rounded">:</code> become headers. 
          Lines starting with <code className="bg-gray-200 px-1 rounded">•</code> or <code className="bg-gray-200 px-1 rounded">1.</code> become lists.
        </p>
      </div>
    </div>
  );
}

