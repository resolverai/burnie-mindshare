"use client";

import React, { useState, useEffect } from 'react';
import useMixpanel from '../../hooks/useMixpanel';

interface EditTextProps {
  text: string;
  onSave: (newText: string) => void;
  onCancel: () => void;
  maxLength: number;
  placeholder?: string;
  className?: string;
  isEditing: boolean;
  onStartEdit: () => void;
  editType: 'main_tweet' | 'thread_item';
  contentId: number;
  postType: string;
  localSaveOnly?: boolean; // New prop for local saving only
  onLocalSave?: (newText: string) => void; // New prop for local save callback
}

export const EditText: React.FC<EditTextProps> = ({
  text,
  onSave,
  onCancel,
  maxLength,
  placeholder = "Enter text...",
  className = "",
  isEditing,
  onStartEdit,
  editType,
  contentId,
  postType,
  localSaveOnly = false,
  onLocalSave
}) => {
  const [editText, setEditText] = useState(text);
  const [isSaving, setIsSaving] = useState(false);
  const mixpanel = useMixpanel();

  useEffect(() => {
    setEditText(text);
  }, [text]);

  const handleSave = async () => {
    if (editText.trim() === text.trim()) {
      onCancel();
      return;
    }

    if (localSaveOnly) {
      // Local save only - just call the local save callback
      if (onLocalSave) {
        onLocalSave(editText.trim());
      }
      onCancel(); // Exit editing mode
      return;
    }

    setIsSaving(true);
    
    try {
      // Track edit event
      mixpanel.tweetEditSaved({
        contentId,
        postType,
        editType,
        characterCount: editText.length,
        maxLength,
        screenName: 'EditText'
      });

      await onSave(editText.trim());
    } catch (error) {
      console.error('Error saving text:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditText(text);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const characterCount = editText.length;
  const isOverLimit = characterCount > maxLength;
  const remainingChars = maxLength - characterCount;

  if (!isEditing) {
    return (
      <div className={`relative group ${className}`}>
        <div className="text-white text-xs lg:text-sm leading-relaxed pr-10">
          {text}
        </div>
        <button
          onClick={onStartEdit}
          className="absolute top-0 right-0 opacity-100 transition-all duration-200 p-1 bg-black/20 hover:bg-white/10 rounded"
          aria-label="Edit text"
        >
          <svg className="w-4 h-4 text-white/80 hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <textarea
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-transparent text-white text-xs lg:text-sm leading-relaxed resize-none border border-white/20 rounded p-2 focus:outline-none focus:border-orange-500"
        rows={Math.max(2, Math.ceil(editText.length / 50))}
        maxLength={maxLength}
        autoFocus
      />
      
      {/* Character count and validation */}
      <div className="flex items-center justify-between mt-2">
        <div className={`text-xs ${isOverLimit ? 'text-red-400' : remainingChars < 20 ? 'text-yellow-400' : 'text-white/60'}`}>
          {characterCount}/{maxLength} characters
          {isOverLimit && <span className="ml-2 text-red-400">Over limit!</span>}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || isOverLimit || editText.trim() === text.trim()}
            className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ThreadItemEditorProps {
  threadItems: string[];
  onUpdate: (newThreadItems: string[]) => void;
  contentId: number;
  postType: string;
  className?: string;
  localSaveOnly?: boolean; // New prop for local saving only
}

export const ThreadItemEditor: React.FC<ThreadItemEditorProps> = ({
  threadItems,
  onUpdate,
  contentId,
  postType,
  className = "",
  localSaveOnly = false
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const mixpanel = useMixpanel();

  const handleEdit = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (index: number, newText: string) => {
    const updatedItems = [...threadItems];
    updatedItems[index] = newText;
    onUpdate(updatedItems);
    setEditingIndex(null);

    // Track edit event
    mixpanel.tweetEditSaved({
      contentId,
      postType,
      editType: 'thread_item',
      characterCount: newText.length,
      maxLength: 280,
      threadLength: updatedItems.length,
      screenName: 'ThreadItemEditor'
    });
  };

  const handleRemove = (index: number) => {
    if (threadItems.length <= 1) return; // Prevent removing all items
    
    const updatedItems = threadItems.filter((_, i) => i !== index);
    onUpdate(updatedItems);

    // Track remove event
    mixpanel.threadItemRemoved({
      contentId,
      postType,
      threadLength: updatedItems.length,
      screenName: 'ThreadItemEditor'
    });
  };

  const handleAddNew = () => {
    if (newItemText.trim()) {
      const updatedItems = [...threadItems, newItemText.trim()];
      onUpdate(updatedItems);
      setNewItemText('');
      setIsAddingNew(false);

      // Track add event
      mixpanel.threadItemAdded({
        contentId,
        postType,
        threadLength: updatedItems.length,
        screenName: 'ThreadItemEditor'
      });
    }
  };

  const handleCancelAdd = () => {
    setNewItemText('');
    setIsAddingNew(false);
  };

  const handleCancelEdit = (index: number) => {
    // If this is a newly added empty item, remove it from the thread
    if (threadItems[index] === '') {
      const updatedItems = threadItems.filter((_, i) => i !== index);
      onUpdate(updatedItems);
    }
    setEditingIndex(null);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {threadItems.map((item, index) => (
        <div key={index} className="relative">
          {editingIndex === index ? (
            <EditText
              text={item}
              onSave={(newText) => handleSaveEdit(index, newText)}
              onCancel={() => handleCancelEdit(index)}
              maxLength={280}
              placeholder="Enter thread item..."
              isEditing={true}
              onStartEdit={() => {}}
              editType="thread_item"
              contentId={contentId}
              postType={postType}
              localSaveOnly={localSaveOnly}
            />
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <EditText
                  text={item}
                  onSave={(newText) => handleSaveEdit(index, newText)}
                  onCancel={() => setEditingIndex(null)}
                  maxLength={280}
                  isEditing={false}
                  onStartEdit={() => setEditingIndex(index)}
                  editType="thread_item"
                  contentId={contentId}
                  postType={postType}
                  localSaveOnly={localSaveOnly}
                />
              </div>
              <button
                onClick={() => handleRemove(index)}
                disabled={threadItems.length <= 1}
                className="p-1 text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Remove thread item"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add new thread item */}
      {isAddingNew ? (
        <div className="border border-dashed border-white/20 rounded p-3">
          <textarea
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Enter new thread item..."
            className="w-full bg-transparent text-white text-xs lg:text-sm leading-relaxed resize-none border border-white/20 rounded p-2 focus:outline-none focus:border-orange-500"
            rows={2}
            maxLength={280}
            autoFocus
          />
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-white/60">
              {newItemText.length}/280 characters
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancelAdd}
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddNew}
                disabled={!newItemText.trim() || newItemText.length > 280}
                className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingNew(true)}
          className="w-full p-3 border border-dashed border-white/20 rounded text-white/60 hover:text-white hover:border-white/40 transition-colors text-xs"
        >
          + Add thread item
        </button>
      )}
    </div>
  );
};
