'use client';

import React, { useState } from 'react';
import { Upload, Loader2, Trash2, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface DocumentData {
  name: string;
  url: string;
  text: string;
  timestamp?: string;
}

interface DocumentDropzoneProps {
  documents: DocumentData[];
  onUpload: (files: File[]) => void;
  onDelete: (index: number) => void;
  uploading: boolean;
  pendingFiles: File[];
  onRemovePending: (index: number) => void;
  onUploadSingle: (file: File) => void;
  onUploadAll: () => void;
}

export function DocumentDropzone({ 
  documents,
  onUpload, 
  onDelete,
  uploading, 
  pendingFiles, 
  onRemovePending,
  onUploadSingle,
  onUploadAll,
}: DocumentDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<number | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (uploading) return;
    
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type === 'application/pdf' ||
      f.type === 'application/msword' ||
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      f.name.toLowerCase().endsWith('.pdf') ||
      f.name.toLowerCase().endsWith('.docx') ||
      f.name.toLowerCase().endsWith('.doc')
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

  const inputId = `doc-upload-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="space-y-4">
      {/* Drag and Drop Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300'}
          ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-purple-400'}
        `}
      >
        <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p className="text-sm font-medium text-gray-700 mb-1">
          Drag & drop PDF or DOCX files here, or click to choose
        </p>
        <p className="text-xs text-gray-500 mb-3">Supported: PDF, DOCX</p>
        <input
          type="file"
          accept=".pdf,.docx,.doc"
          multiple
          id={inputId}
          className="hidden"
          onChange={handleFileInput}
        />
        <label htmlFor={inputId}>
          <span className="inline-block px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
            Choose Files
          </span>
        </label>
      </div>

      {/* Pending Files */}
      {pendingFiles.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Files to Upload ({pendingFiles.length})
          </h4>
          <div className="space-y-2">
            {pendingFiles.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border">
                <span className="text-sm text-gray-900 truncate flex-1 mr-3">{file.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onRemovePending(idx)}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => onUploadSingle(file)}
                    disabled={uploading}
                    className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 font-medium"
                  >
                    Upload
                  </button>
                </div>
              </div>
            ))}
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
        </div>
      )}

      {/* Uploaded Documents */}
      {documents.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Uploaded Documents ({documents.length})
          </h4>
          <div className="space-y-2">
            {documents.map((doc, idx) => (
              <div key={idx} className="bg-white rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                      <div className="flex items-center gap-2">
                        {doc.timestamp && (
                          <span className="text-xs text-gray-500">
                            {new Date(doc.timestamp).toLocaleDateString()}
                          </span>
                        )}
                        {doc.text && (
                          <span className="text-xs text-green-600">✓ Text extracted</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {doc.text && (
                      <button
                        onClick={() => setExpandedDoc(expandedDoc === idx ? null : idx)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                      >
                        {expandedDoc === idx ? (
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(idx)}
                      className="p-1 hover:bg-red-100 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
                
                {/* Expanded Text Content */}
                {expandedDoc === idx && doc.text && (
                  <div className="px-4 pb-4">
                    <div className="bg-gray-50 border rounded-lg p-3 max-h-48 overflow-y-auto">
                      <p className="text-xs text-gray-600 whitespace-pre-wrap font-mono">
                        {doc.text.substring(0, 2000)}
                        {doc.text.length > 2000 && '...'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

