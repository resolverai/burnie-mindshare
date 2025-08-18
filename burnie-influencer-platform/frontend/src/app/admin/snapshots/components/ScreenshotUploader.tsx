'use client'

import React, { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, FileImage, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface ScreenshotUploaderProps {
  onFileUpload: (files: File[]) => void
  uploadedFiles: File[]
  maxFiles?: number
}

export default function ScreenshotUploader({ 
  onFileUpload, 
  uploadedFiles, 
  maxFiles = 10 
}: ScreenshotUploaderProps) {
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([])

  const onDrop = useCallback((acceptedFiles: File[], fileRejections: any[]) => {
    // Handle rejected files
    if (fileRejections.length > 0) {
      const rejected = fileRejections.map(rejection => rejection.file)
      setRejectedFiles(rejected)
      
      fileRejections.forEach((rejection) => {
        rejection.errors.forEach((error: any) => {
          if (error.code === 'file-too-large') {
            toast.error(`${rejection.file.name} is too large. Max size is 10MB.`)
          } else if (error.code === 'file-invalid-type') {
            toast.error(`${rejection.file.name} is not a valid image file.`)
          } else if (error.code === 'too-many-files') {
            toast.error(`Too many files. Maximum ${maxFiles} files allowed.`)
          } else {
            toast.error(`${rejection.file.name}: ${error.message}`)
          }
        })
      })
    }

    // Handle accepted files
    if (acceptedFiles.length > 0) {
      const newFiles = [...uploadedFiles, ...acceptedFiles].slice(0, maxFiles)
      onFileUpload(newFiles)
      setRejectedFiles([])
    }
  }, [uploadedFiles, onFileUpload, maxFiles])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']
    },
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: maxFiles - uploadedFiles.length,
    multiple: true
  })

  const removeFile = (index: number) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== index)
    onFileUpload(newFiles)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-4">
      {/* 24H Data Requirement Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-blue-900">📊 24H Data Requirement</h4>
            <p className="text-sm text-blue-700 mt-1">
              Upload screenshots showing <strong>"Last 24 Hours"</strong> data only. 
              This ensures the most granular data for accurate ML model training and time series analysis.
            </p>
          </div>
        </div>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
          ${uploadedFiles.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
        
        {isDragActive ? (
          <p className="text-blue-600 font-medium">Drop the screenshots here...</p>
        ) : (
          <div>
            <p className="text-gray-600 font-medium mb-2">
              {uploadedFiles.length >= maxFiles 
                ? `Maximum ${maxFiles} files reached` 
                : 'Drop screenshots here, or click to select'
              }
            </p>
            <p className="text-sm text-gray-500">
              PNG, JPG, GIF up to 10MB • Maximum {maxFiles} files
            </p>
          </div>
        )}
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">
            Uploaded Files ({uploadedFiles.length}/{maxFiles})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {uploadedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <FileImage className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 truncate max-w-xs">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => removeFile(index)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Files */}
      {rejectedFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Rejected Files
          </h4>
          <div className="space-y-2">
            {rejectedFiles.map((file, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-red-900">{file.name}</p>
                  <p className="text-xs text-red-600">Invalid file type or size</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Guidelines */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>Upload Guidelines:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Clear, high-resolution screenshots of leaderboards</li>
          <li>Include campaign banners and platform branding when visible</li>
          <li>Ensure usernames and metrics are clearly readable</li>
          <li>Capture trending content and algorithm signals when available</li>
        </ul>
      </div>
    </div>
  )
}
