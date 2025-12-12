'use client';

import React, { useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import Image from 'next/image';

interface LogoDropzoneProps {
  logoUrl?: string;
  onUpload: (files: File[]) => void;
  uploading: boolean;
}

export function LogoDropzone({ logoUrl, onUpload, uploading }: LogoDropzoneProps) {
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
      onUpload([files[0]]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onUpload([files[0]]);
    }
  };

  const inputId = `logo-upload-${Math.random().toString(36).substr(2, 9)}`;

  return (
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
        onChange={handleFileInput}
        disabled={uploading}
      />
      
      {logoUrl && !uploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-32 h-32 border-2 border-gray-200 rounded-lg overflow-hidden bg-white">
            <Image
              src={logoUrl}
              alt="Logo"
              fill
              className="object-contain p-2"
              unoptimized
            />
          </div>
          <p className="text-xs text-gray-500">Drag & drop to replace</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          {uploading ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-gray-400" />
              <p className="text-sm text-gray-500">Uploading...</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Drag & drop logo here, or click to choose</p>
              <p className="text-xs text-gray-500">Supported: JPG, JPEG, PNG, WEBP</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

