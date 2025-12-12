'use client';

import React, { useState } from 'react';
import { Upload, Loader2, X, Play } from 'lucide-react';

interface MediaDropzoneProps {
  onUpload: (files: File[]) => void;
  uploading: boolean;
  pendingFiles: File[];
  onRemovePending: (index: number) => void;
  onUploadAll: () => void;
}

export function MediaDropzone({ 
  onUpload, 
  uploading, 
  pendingFiles, 
  onRemovePending,
  onUploadAll 
}: MediaDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (uploading) return;
    
    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.match(/^(image\/(jpeg|jpg|png|webp)|video\/mp4)$/)
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

  const inputId = `media-upload-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && document.getElementById(inputId)?.click()}
        className={`border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors text-center
          ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300'}
          ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-purple-400'}
        `}
      >
        <input
          type="file"
          id={inputId}
          className="hidden"
          accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4"
          multiple
          onChange={handleFileInput}
          disabled={uploading}
        />
        
        <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p className="text-sm font-medium text-gray-700 mb-1">
          Drag & drop images and videos here, or click to choose
        </p>
        <p className="text-xs text-gray-500">
          Supported: JPG, JPEG, PNG, WEBP, MP4
        </p>
      </div>

      {/* Pending Files Preview */}
      {pendingFiles.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Files to Upload ({pendingFiles.length})
          </h4>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
            {pendingFiles.map((file, idx) => (
              <div key={idx} className="relative aspect-square bg-gray-200 rounded-lg overflow-hidden">
                {file.type.startsWith('image/') ? (
                  <img 
                    src={URL.createObjectURL(file)} 
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <Play className="w-8 h-8 text-gray-300" />
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemovePending(idx);
                  }}
                  className="absolute top-1 right-1 p-1 bg-red-100 hover:bg-red-200 text-red-600 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={onUploadAll}
            disabled={uploading}
            className="w-full px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              `Upload All (${pendingFiles.length})`
            )}
          </button>
        </div>
      )}
    </div>
  );
}

