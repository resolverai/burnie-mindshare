'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  Upload,
  Image as ImageIcon,
  Video,
  Music,
  Music2,
  Volume2,
  Mic,
  Sparkles,
  X,
  Trash2,
  Edit,
  Plus,
  Filter,
  Loader2,
  FileVideo,
  FileAudio,
  FileImage,
  Tag,
  FolderOpen,
  Check,
  ChevronDown,
} from 'lucide-react';

interface Asset {
  id: number;
  name: string;
  type: 'video' | 'image' | 'audio' | 'music' | 'voiceover' | 'effect' | 'overlay' | 'sticker' | 'transition';
  s3Key: string;
  thumbnailS3Key: string | null;
  duration: number | null;
  tags: string[];
  category: string | null;
  isAdminAsset: boolean;
  isActive: boolean;
  metadata: any;
  createdAt: string;
  updatedAt: string;
  publicUrl?: string | null;
  thumbnailUrl?: string | null;
}

interface ApiResponse {
  success: boolean;
  assets: Asset[];
}

// Asset type configuration
const ASSET_TYPES = [
  { value: 'video', label: 'Video', icon: Video, accept: 'video/*', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  { value: 'image', label: 'Image', icon: ImageIcon, accept: 'image/*', color: 'text-green-600', bgColor: 'bg-green-50' },
  { value: 'audio', label: 'Audio', icon: Volume2, accept: 'audio/*', color: 'text-orange-600', bgColor: 'bg-orange-50' },
  { value: 'music', label: 'Music', icon: Music2, accept: 'audio/*', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  { value: 'voiceover', label: 'Voiceover', icon: Mic, accept: 'audio/*', color: 'text-pink-600', bgColor: 'bg-pink-50' },
  { value: 'effect', label: 'Effect', icon: Sparkles, accept: 'video/*,image/*', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  { value: 'overlay', label: 'Overlay', icon: ImageIcon, accept: 'image/*,video/*', color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  { value: 'sticker', label: 'Sticker', icon: Sparkles, accept: 'image/*', color: 'text-red-600', bgColor: 'bg-red-50' },
  { value: 'transition', label: 'Transition', icon: Sparkles, accept: 'video/*', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
];

// Categories
const CATEGORIES = [
  { value: 'intro', label: 'Intro' },
  { value: 'outro', label: 'Outro' },
  { value: 'transition', label: 'Transition' },
  { value: 'music', label: 'Music' },
  { value: 'sfx', label: 'Sound Effects' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'effect', label: 'Effect' },
  { value: 'background', label: 'Background' },
  { value: 'other', label: 'Other' },
];

export default function DvybAssetsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFilePreview, setUploadFilePreview] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState('');
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadTags, setUploadTags] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch assets
  const fetchAssets = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (categoryFilter !== 'all') params.append('category', categoryFilter);
      params.append('includeInactive', 'true');

      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/dvyb/assets/admin?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data: ApiResponse = await response.json();
      if (data.success) {
        setAssets(data.assets);
      }
    } catch (error) {
      console.error('Error fetching assets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [searchTerm, typeFilter, categoryFilter]);

  // Handle file selection
  const handleFileSelect = (file: File) => {
    setUploadFile(file);
    setUploadName(file.name.replace(/\.[^/.]+$/, '')); // Remove extension

    // Auto-detect type
    if (file.type.startsWith('video/')) {
      setUploadType('video');
    } else if (file.type.startsWith('image/')) {
      setUploadType('image');
    } else if (file.type.startsWith('audio/')) {
      setUploadType('audio');
    }

    // Create preview for images/videos
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      setUploadFilePreview(url);
    } else {
      setUploadFilePreview(null);
    }
  };

  // Handle file drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  // Handle upload
  const handleUpload = async () => {
    if (!uploadFile || !uploadType) {
      alert('Please select a file and asset type');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(10);

      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('name', uploadName || uploadFile.name);
      formData.append('type', uploadType);
      formData.append('category', uploadCategory);
      formData.append('tags', JSON.stringify(uploadTags.split(',').map(t => t.trim()).filter(Boolean)));

      setUploadProgress(30);

      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/dvyb/assets/admin/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      setUploadProgress(80);

      const data = await response.json();
      if (data.success) {
        setUploadProgress(100);
        await fetchAssets();
        resetUploadForm();
        setShowUploadModal(false);
      } else {
        throw new Error(data.error || 'Failed to upload asset');
      }
    } catch (error: any) {
      console.error('Error uploading asset:', error);
      alert(`Failed to upload asset: ${error.message}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Reset upload form
  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadFilePreview(null);
    setUploadName('');
    setUploadType('');
    setUploadCategory('other');
    setUploadTags('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Open edit modal
  const openEditModal = (asset: Asset) => {
    setSelectedAsset(asset);
    setEditName(asset.name);
    setEditType(asset.type);
    setEditCategory(asset.category || 'other');
    setEditTags(asset.tags.join(', '));
    setEditIsActive(asset.isActive);
    setShowEditModal(true);
  };

  // Handle save edit
  const handleSaveEdit = async () => {
    if (!selectedAsset) return;

    try {
      setSaving(true);
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/dvyb/assets/admin/${selectedAsset.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editName,
          type: editType,
          category: editCategory,
          tags: editTags.split(',').map(t => t.trim()).filter(Boolean),
          isActive: editIsActive,
        }),
      });

      const data = await response.json();
      if (data.success) {
        await fetchAssets();
        setShowEditModal(false);
        setSelectedAsset(null);
      } else {
        alert('Failed to update asset');
      }
    } catch (error) {
      console.error('Error updating asset:', error);
      alert('Failed to update asset');
    } finally {
      setSaving(false);
    }
  };

  // Delete asset
  const handleDelete = async (assetId: number) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;

    try {
      setDeleting(assetId);
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/dvyb/assets/admin/${assetId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        await fetchAssets();
      } else {
        alert('Failed to delete asset');
      }
    } catch (error) {
      console.error('Error deleting asset:', error);
      alert('Failed to delete asset');
    } finally {
      setDeleting(null);
    }
  };

  // Group assets by type for stats
  const assetsByType = assets.reduce((acc, asset) => {
    if (!acc[asset.type]) acc[asset.type] = [];
    acc[asset.type].push(asset);
    return acc;
  }, {} as Record<string, Asset[]>);

  // Get icon for asset type
  const getTypeIcon = (type: string) => {
    const config = ASSET_TYPES.find(t => t.value === type);
    return config?.icon || Sparkles;
  };

  const getTypeColor = (type: string) => {
    const config = ASSET_TYPES.find(t => t.value === type);
    return config?.color || 'text-gray-600';
  };

  const getTypeBgColor = (type: string) => {
    const config = ASSET_TYPES.find(t => t.value === type);
    return config?.bgColor || 'bg-gray-50';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">DVYB Assets</h1>
                <p className="text-sm text-gray-500 mt-1">Manage assets for video editor</p>
              </div>
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Plus className="h-4 w-4" />
              Upload Asset
            </button>
          </div>
        </div>
      </div>

      {/* Filters & Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Search and Filters Row */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Search */}
          <div className="flex-1 min-w-[250px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 cursor-pointer min-w-[150px]"
            >
              <option value="all">All Types</option>
              {ASSET_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Category Filter */}
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 cursor-pointer min-w-[150px]"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Compact Stats Row */}
        <div className="flex flex-wrap gap-3 mb-6">
          {ASSET_TYPES.map(type => {
            const count = assetsByType[type.value]?.length || 0;
            const Icon = type.icon;
            return (
              <button
                key={type.value}
                onClick={() => setTypeFilter(typeFilter === type.value ? 'all' : type.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  typeFilter === type.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                }`}
              >
                <div className={`p-1 rounded ${type.bgColor}`}>
                  <Icon className={`h-4 w-4 ${type.color}`} />
                </div>
                <span className="text-sm font-medium">{type.label}</span>
                <span className={`text-sm font-bold ${typeFilter === type.value ? 'text-blue-600' : 'text-gray-900'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
            <p className="mt-4 text-gray-500">Loading assets...</p>
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-600 font-medium">No assets found</p>
            <p className="text-gray-400 text-sm mt-1">Upload your first asset to get started</p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Upload Asset
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Preview</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Duration</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tags</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {assets.map((asset) => {
                    const Icon = getTypeIcon(asset.type);
                    const isVisualType = ['video', 'image', 'overlay', 'sticker', 'effect'].includes(asset.type);
                    const isAudioType = ['audio', 'music', 'voiceover'].includes(asset.type);
                    const previewUrl = asset.thumbnailUrl || asset.publicUrl;
                    
                    return (
                      <tr key={asset.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center relative ${getTypeBgColor(asset.type)}`}>
                            {isVisualType && previewUrl ? (
                              <>
                                {asset.type === 'video' ? (
                                  <video 
                                    src={previewUrl} 
                                    className="w-full h-full object-cover"
                                    muted
                                    preload="metadata"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <img 
                                    src={previewUrl} 
                                    alt={asset.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                )}
                                {/* Video play indicator */}
                                {asset.type === 'video' && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                    <div className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
                                      <div className="w-0 h-0 border-l-[8px] border-l-gray-800 border-y-[5px] border-y-transparent ml-0.5" />
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              /* Icon for audio types or assets without preview */
                              <Icon className={`h-6 w-6 ${getTypeColor(asset.type)}`} />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900 max-w-[200px] truncate" title={asset.name}>
                            {asset.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${getTypeBgColor(asset.type)} ${getTypeColor(asset.type)}`}>
                            {asset.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {asset.category ? (
                            <span className="capitalize">{asset.category}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {asset.duration ? `${asset.duration.toFixed(1)}s` : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {asset.tags.length > 0 ? (
                              <>
                                {asset.tags.slice(0, 2).map((tag, idx) => (
                                  <span key={idx} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                                    {tag}
                                  </span>
                                ))}
                                {asset.tags.length > 2 && (
                                  <span className="px-2 py-0.5 text-xs text-gray-500">+{asset.tags.length - 2}</span>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {asset.isActive ? (
                            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                              Active
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                              Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditModal(asset)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(asset.id)}
                              disabled={deleting === asset.id}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              title="Delete"
                            >
                              {deleting === asset.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Upload Asset</h2>
                <p className="text-sm text-gray-500 mt-1">Add a new asset to the library</p>
              </div>
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  resetUploadForm();
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-5">
              {/* File Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50'
                    : uploadFile
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileInputChange}
                  accept="video/*,image/*,audio/*"
                  className="hidden"
                />
                {uploadFile ? (
                  <div className="space-y-2">
                    {uploadFilePreview && uploadFile.type.startsWith('image/') ? (
                      <img
                        src={uploadFilePreview}
                        alt="Preview"
                        className="w-24 h-24 object-cover rounded-lg mx-auto"
                      />
                    ) : uploadFilePreview && uploadFile.type.startsWith('video/') ? (
                      <video
                        src={uploadFilePreview}
                        className="w-32 h-20 object-cover rounded-lg mx-auto"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                        <Check className="h-8 w-8 text-green-600" />
                      </div>
                    )}
                    <p className="text-sm font-medium text-gray-900">{uploadFile.name}</p>
                    <p className="text-xs text-gray-500">
                      {(uploadFile.size / 1024 / 1024).toFixed(2)} MB • Click to change
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload className={`h-10 w-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                    <p className="text-sm font-medium text-gray-700">
                      Drag and drop your file here
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      or click to browse • Video, Image, or Audio
                    </p>
                  </>
                )}
              </div>

              {/* Asset Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ASSET_TYPES.map(type => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setUploadType(type.value)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                          uploadType === type.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300 text-gray-700'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${uploadType === type.value ? 'text-blue-600' : type.color}`} />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Asset Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset Name
                </label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Enter asset name..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category
                </label>
                <div className="relative">
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full appearance-none pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tags
                </label>
                <input
                  type="text"
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="Enter tags separated by commas..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400"
                />
                <p className="text-xs text-gray-500 mt-1">Separate multiple tags with commas</p>
              </div>

              {/* Upload Progress */}
              {uploading && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-600 text-center">
                    Uploading... {uploadProgress}%
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setShowUploadModal(false);
                  resetUploadForm();
                }}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadFile || !uploadType || uploading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload Asset
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && selectedAsset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Asset</h2>
                <p className="text-sm text-gray-500 mt-1">Update asset details</p>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedAsset(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-5">
              {/* Asset Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                />
              </div>

              {/* Asset Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Asset Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ASSET_TYPES.map(type => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setEditType(type.value)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                          editType === type.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300 text-gray-700'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${editType === type.value ? 'text-blue-600' : type.color}`} />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category
                </label>
                <div className="relative">
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full appearance-none pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tags
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="Enter tags separated by commas..."
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400"
                />
              </div>

              {/* Status Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <p className="text-xs text-gray-500">Active assets are visible in the editor</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditIsActive(!editIsActive)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    editIsActive ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      editIsActive ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedAsset(null);
                }}
                className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
