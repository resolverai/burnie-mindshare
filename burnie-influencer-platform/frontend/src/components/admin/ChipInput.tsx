'use client';

import React, { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface ChipInputProps {
  value: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function ChipInput({ value, onChange, placeholder, className = '' }: ChipInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        const newChips = inputValue
          .split(',')
          .map(chip => chip.trim())
          .filter(chip => chip && !value.includes(chip));
        
        if (newChips.length > 0) {
          onChange([...value, ...newChips]);
        }
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    
    if (pastedText.includes(',')) {
      e.preventDefault();
      
      const newChips = pastedText
        .split(',')
        .map(chip => chip.trim())
        .filter(chip => chip && !value.includes(chip));
      
      if (newChips.length > 0) {
        onChange([...value, ...newChips]);
      }
      setInputValue('');
    }
  };

  const removeChip = (indexToRemove: number) => {
    onChange(value.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div className={`border border-gray-300 rounded-lg p-3 min-h-[100px] bg-white ${className}`}>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((chip, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-purple-100 text-purple-800 rounded"
          >
            {chip}
            <button
              type="button"
              onClick={() => removeChip(index)}
              className="ml-1 hover:bg-purple-200 rounded-full p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder || 'Type and press Tab or Enter to add'}
        className="w-full border-0 focus:ring-0 focus:outline-none p-0 text-sm text-gray-900 bg-white placeholder-gray-400"
      />
    </div>
  );
}

