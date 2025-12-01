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
      onUpload([files[0]]); // Only take first file for logo
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onUpload([files[0]]);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && document.getElementById('logo-upload-input')?.click()}
      className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors
        ${isDragging ? 'border-primary bg-primary/5' : 'border-border'}
        ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary'}
      `}
    >
      <input
        type="file"
        id="logo-upload-input"
        className="hidden"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileInput}
        disabled={uploading}
      />
      
      {logoUrl && !uploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-32 h-32 border-2 border-border rounded-lg overflow-hidden">
            <Image
              src={logoUrl}
              alt="Logo"
              fill
              className="object-contain p-2"
            />
          </div>
          <p className="text-xs text-muted-foreground">Drag & drop to replace</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          {uploading ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm font-medium">Drag & drop logo here, or click to choose</p>
              <p className="text-xs text-muted-foreground">Supported: JPG, JPEG, PNG, WEBP</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

