'use client';

import React, { useState } from 'react';
import { Upload, Loader2, X } from 'lucide-react';
import Image from 'next/image';

interface AdditionalLogosDropzoneProps {
  logos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
  onUpload: (files: File[]) => void;
  onDelete: (index: number) => void;
  uploading: boolean;
}

export function AdditionalLogosDropzone({ logos, onUpload, onDelete, uploading }: AdditionalLogosDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (uploading) return;
    
    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp'
    );
    
    if (files.length > 0) {
      onUpload(files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onUpload(files);
    }
  };

  const inputId = `additional-logos-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && document.getElementById(inputId)?.click()}
        className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
          ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300'}
          ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-purple-400'}
        `}
      >
        <input
          type="file"
          id={inputId}
          className="hidden"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          onChange={handleFileInput}
          disabled={uploading}
        />
        
        <div className="flex flex-col items-center gap-2 text-center">
          {uploading ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-gray-400" />
              <p className="text-sm text-gray-500">Uploading...</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Drag & drop multiple logos here</p>
              <p className="text-xs text-gray-500">Supported: JPG, JPEG, PNG, WEBP</p>
            </>
          )}
        </div>
      </div>

      {/* Display uploaded logos */}
      {logos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {logos.map((logo, index) => (
            <div key={index} className="relative group">
              <div className="relative w-full aspect-square border-2 border-gray-200 rounded-lg overflow-hidden bg-white">
                <Image
                  src={logo.presignedUrl}
                  alt={`Additional logo ${index + 1}`}
                  fill
                  className="object-contain p-2"
                  unoptimized
                />
              </div>
              <button
                type="button"
                className="absolute top-1 right-1 h-6 w-6 bg-red-100 hover:bg-red-200 text-red-600 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(index);
                }}
              >
                <X className="w-3 h-3" />
              </button>
              {logo.timestamp && (
                <p className="text-xs text-gray-400 text-center mt-1">
                  {new Date(logo.timestamp).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

