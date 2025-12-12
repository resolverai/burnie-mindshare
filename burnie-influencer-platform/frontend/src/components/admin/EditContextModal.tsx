'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  X,
  Loader2,
  Globe,
  Trash2,
  Play,
  Save,
  Plus,
  Image as ImageIcon,
  FileText,
  Edit,
} from 'lucide-react';
import Image from 'next/image';
import { ChipInput } from './ChipInput';
import { LogoDropzone } from './LogoDropzone';
import { AdditionalLogosDropzone } from './AdditionalLogosDropzone';
import { MediaDropzone } from './MediaDropzone';
import { DocumentDropzone } from './DocumentDropzone';
import { RichTextEditor } from './RichTextEditor';

interface DvybAccount {
  id: number;
  accountName: string;
  primaryEmail: string;
}

interface LinkData {
  url: string;
  timestamp?: string;
}

interface DocumentData {
  name: string;
  url: string;
  text: string;
  timestamp?: string;
}

interface EditContextModalProps {
  account: DvybAccount;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type TabId = 'source-materials' | 'images-video' | 'brand-profile' | 'styles-voice' | 'content-preferences';

const TABS: { id: TabId; label: string }[] = [
  { id: 'source-materials', label: 'Source Materials' },
  { id: 'images-video', label: 'Images & Video' },
  { id: 'brand-profile', label: 'Brand Profile' },
  { id: 'styles-voice', label: 'Styles & Voice' },
  { id: 'content-preferences', label: 'Content Preferences' },
];

// Helper function to format text with line breaks and bold sections (same as BrandKitPage)
const FormattedText = ({ text }: { text: string | string[] | any }) => {
  if (!text) return null;

  // Convert to string if it's an array or other type
  let textStr: string;
  if (Array.isArray(text)) {
    textStr = text.join('\n');
  } else if (typeof text === 'object') {
    textStr = JSON.stringify(text, null, 2);
  } else if (typeof text !== 'string') {
    textStr = String(text);
  } else {
    textStr = text;
  }

  // Split by lines and process each line
  const lines = textStr.split('\n');
  
  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        // Skip empty lines
        if (!line.trim()) return <div key={index} className="h-2" />;
        
        // Check for section headers (lines ending with colon and starting with capital or bullet)
        const isSectionHeader = line.match(/^(•\s*)?([A-Z][^:]+):/) || 
                               line.match(/^(Core Identity|Market Positioning|Direct Competitors|Global Competitors|Competitive Advantages|Primary Customer Segments|Key need|Pain points|Key interest|Top Revenue Generators|Primary Value Drivers|Emotional Benefits|The Hero's Journey|Mission Statement|Brand Personality|Archetype|Voice|Values|Business Overview|Why Customers Choose|Customer Demographics|Psychographics):/i);
        
        if (isSectionHeader) {
          // Split at the colon to bold the header part
          const colonIndex = line.indexOf(':');
          const header = line.substring(0, colonIndex + 1);
          const content = line.substring(colonIndex + 1);
          
          return (
            <p key={index} className="text-gray-600 leading-relaxed">
              <span className="font-semibold text-gray-900">{header}</span>
              {content}
            </p>
          );
        }
        
        // Check for numbered or bulleted lists
        if (line.match(/^(\d+\.\s|•\s)/)) {
          // Check if the line contains a colon or dash to bold the prefix
          const colonMatch = line.match(/^(\d+\.\s|•\s)(.+?)(:|–|—)(.*)$/);
          
          if (colonMatch) {
            const [, bullet, boldText, separator, rest] = colonMatch;
            return (
              <p key={index} className="text-gray-600 leading-relaxed ml-0">
                {bullet}<span className="font-semibold text-gray-900">{boldText}{separator}</span>{rest}
              </p>
            );
          }
          
          return (
            <p key={index} className="text-gray-600 leading-relaxed ml-0">
              {line}
            </p>
          );
        }
        
        // Regular paragraph
        return (
          <p key={index} className="text-gray-600 leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
};

export default function EditContextModal({
  account,
  open,
  onClose,
  onSaved,
}: EditContextModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('source-materials');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [contextData, setContextData] = useState<any>(null);

  // Upload states
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingAdditionalLogos, setUploadingAdditionalLogos] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  const [pendingDocumentFiles, setPendingDocumentFiles] = useState<File[]>([]);

  // Edit states
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>({});

  // Form state
  const [links, setLinks] = useState<LinkData[]>([]);
  const [uploadedDocuments, setUploadedDocuments] = useState<DocumentData[]>([]);
  const [connections, setConnections] = useState<Record<string, string>>({});
  const [uploadedMedia, setUploadedMedia] = useState<{
    images: Array<{ url: string; presignedUrl: string; timestamp: string }>;
    videos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
  }>({ images: [], videos: [] });
  const [additionalLogos, setAdditionalLogos] = useState<Array<{ url: string; presignedUrl: string; timestamp: string }>>([]);
  const [brandStyles, setBrandStyles] = useState<{
    visual_identity_description: string[];
    visual_identity_keywords: string[];
  }>({ visual_identity_description: [], visual_identity_keywords: [] });
  const [brandVoices, setBrandVoices] = useState<{
    purpose: string;
    audience: string;
    tone: string[];
    emotions: string[];
    character: string[];
    syntax: string[];
    language: string;
  }>({ purpose: '', audience: '', tone: [], emotions: [], character: [], syntax: [], language: '' });
  const [contentPreferences, setContentPreferences] = useState<any>({
    featuredMedia: { text: true, image: true, video: true },
    brandKitMediaPriority: 'brand_kit_first',
    brandKitMediaReuse: 'reuse_after_3_weeks',
    alwaysIncludeBlogImages: true,
    contentLanguage: 'en-us',
    topicsToAvoid: [],
    wordsToAvoid: [],
    blogKeywords: [],
    alwaysIncludeExternalLinks: true,
    externalUrlsToAvoid: [],
    hashtags: { avoid: [], include: [] },
    hashtagFrequency: 'sometimes',
    logoFrequency: 'sometimes',
    ctaLinks: [],
    ctaCopy: '',
    ctaFrequency: 'sometimes',
  });
  const [colorPalette, setColorPalette] = useState<{ primary: string; secondary: string; accent: string }>({
    primary: '#220808',
    secondary: '#f97316',
    accent: '#368405',
  });
  const [brandFonts, setBrandFonts] = useState<{ title: string; body: string }>({
    title: 'Inter',
    body: 'Inter',
  });

  // Fetch context data
  const fetchContextData = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/context`);
      const data = await response.json();

      if (data.success && data.data) {
        setContextData(data.data);

        // Load links
        const allLinks: LinkData[] = [];
        if (data.data.website) {
          allLinks.push({
            url: data.data.website,
            timestamp: data.data.createdAt || new Date().toISOString(),
          });
        }
        if (data.data.linksJson && Array.isArray(data.data.linksJson)) {
          if (typeof data.data.linksJson[0] === 'string') {
            allLinks.push(...data.data.linksJson.map((url: string) => ({ url, timestamp: new Date().toISOString() })));
          } else {
            allLinks.push(...data.data.linksJson);
          }
        }
        setLinks(allLinks);

        // Load documents
        if (data.data.documentsText && Array.isArray(data.data.documentsText)) {
          setUploadedDocuments(data.data.documentsText);
        }

        // Load images and videos
        setUploadedMedia({
          images: data.data.brandImagesWithUrls || [],
          videos: data.data.brandAssetsWithUrls || [],
        });

        // Load additional logos
        if (data.data.additionalLogosWithUrls) {
          setAdditionalLogos(data.data.additionalLogosWithUrls);
        }

        // Load brand styles
        if (data.data.brandStyles) {
          setBrandStyles({
            visual_identity_description: data.data.brandStyles.visual_identity_description || [],
            visual_identity_keywords: data.data.brandStyles.visual_identity_keywords || [],
          });
        }

        // Load color palette
        if (data.data.colorPalette) {
          setColorPalette({
            primary: data.data.colorPalette.primary || '#220808',
            secondary: data.data.colorPalette.secondary || '#f97316',
            accent: data.data.colorPalette.accent || '#368405',
          });
        }

        // Load fonts
        if (data.data.brandFonts) {
          setBrandFonts({
            title: data.data.brandFonts.title || 'Inter',
            body: data.data.brandFonts.body || 'Inter',
          });
        }

        // Load brand voices
        if (data.data.brandVoices) {
          setBrandVoices({
            purpose: Array.isArray(data.data.brandVoices.purpose) 
              ? data.data.brandVoices.purpose.join('\n') 
              : (data.data.brandVoices.purpose || ''),
            audience: Array.isArray(data.data.brandVoices.audience)
              ? data.data.brandVoices.audience.join('\n')
              : (data.data.brandVoices.audience || ''),
            tone: data.data.brandVoices.tone || [],
            emotions: data.data.brandVoices.emotions || [],
            character: data.data.brandVoices.character || [],
            syntax: data.data.brandVoices.syntax || [],
            language: Array.isArray(data.data.brandVoices.language)
              ? data.data.brandVoices.language.join('\n')
              : (data.data.brandVoices.language || ''),
          });
        }

        // Load content preferences
        if (data.data.contentPreferences) {
          setContentPreferences({
            ...contentPreferences,
            ...data.data.contentPreferences,
          });
        }
      }

      // Fetch connections
      const connResponse = await fetch(`/api/admin/dvyb-accounts/${account.id}/connections`);
      const connData = await connResponse.json();
      if (connData.success) {
        setConnections(connData.data);
      }
    } catch (error) {
      console.error('Failed to fetch context:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open && account) {
      fetchContextData();
    }
  }, [open, account]);

  // Upload handlers
  const handleLogoUpload = async (files: File[]) => {
    if (files.length === 0) return;
    
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', files[0]!);

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/upload/logo`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setContextData((prev: any) => ({
          ...prev,
          logoPresignedUrl: data.data.presignedUrl,
          logoUrl: data.data.s3_key,
        }));
      }
    } catch (error) {
      console.error('Failed to upload logo:', error);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleAdditionalLogosUpload = async (files: File[]) => {
    if (files.length === 0) return;
    
    setUploadingAdditionalLogos(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('logos', file));

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/upload/additional-logos`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setAdditionalLogos((prev) => [...prev, ...data.data.logos]);
      }
    } catch (error) {
      console.error('Failed to upload additional logos:', error);
    } finally {
      setUploadingAdditionalLogos(false);
    }
  };

  const handleMediaUpload = async () => {
    if (pendingMediaFiles.length === 0) return;
    
    setUploadingMedia(true);
    try {
      const formData = new FormData();
      pendingMediaFiles.forEach((file) => formData.append('media', file));

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/upload/media`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setUploadedMedia((prev) => ({
          images: [...prev.images, ...data.data.images],
          videos: [...prev.videos, ...data.data.videos],
        }));
        setPendingMediaFiles([]);
      }
    } catch (error) {
      console.error('Failed to upload media:', error);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleDocumentsUpload = async () => {
    if (pendingDocumentFiles.length === 0) return;
    
    setUploadingDocuments(true);
    try {
      const formData = new FormData();
      pendingDocumentFiles.forEach((file) => formData.append('documents', file));

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/upload/documents`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setUploadedDocuments((prev) => [...prev, ...data.data.documents_text]);
        setPendingDocumentFiles([]);
      }
    } catch (error) {
      console.error('Failed to upload documents:', error);
    } finally {
      setUploadingDocuments(false);
    }
  };

  const handleSingleDocumentUpload = async (file: File) => {
    setUploadingDocuments(true);
    try {
      const formData = new FormData();
      formData.append('documents', file);

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/upload/documents`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setUploadedDocuments((prev) => [...prev, ...data.data.documents_text]);
        setPendingDocumentFiles((prev) => prev.filter((f) => f !== file));
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
    } finally {
      setUploadingDocuments(false);
    }
  };

  // Delete handlers
  const deleteAdditionalLogo = async (index: number) => {
    const newLogos = additionalLogos.filter((_, i) => i !== index);
    setAdditionalLogos(newLogos);
    
    // Save immediately
    await saveContext({ additionalLogoUrls: newLogos });
  };

  const deleteMedia = async (type: 'image' | 'video', index: number) => {
    const newMedia = {
      images: type === 'image' 
        ? uploadedMedia.images.filter((_, i) => i !== index)
        : uploadedMedia.images,
      videos: type === 'video'
        ? uploadedMedia.videos.filter((_, i) => i !== index)
        : uploadedMedia.videos,
    };
    setUploadedMedia(newMedia);
    
    // Save immediately
    await saveContext({
      brandImages: newMedia.images,
      brandAssets: newMedia.videos,
    });
  };

  const deleteDocument = async (index: number) => {
    const newDocs = uploadedDocuments.filter((_, i) => i !== index);
    setUploadedDocuments(newDocs);
    
    // Save immediately
    await saveContext({ documentsText: newDocs });
  };

  // Save context
  const saveContext = async (updates: any) => {
    try {
      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to save context:', error);
      return { success: false };
    }
  };

  // Save all changes
  const handleSaveAll = async () => {
    try {
      setIsSaving(true);

      const updates: any = {
        linksJson: links.filter(l => l.url?.trim()),
        documentsText: uploadedDocuments,
        brandImages: uploadedMedia.images,
        brandAssets: uploadedMedia.videos,
        additionalLogoUrls: additionalLogos,
        brandStyles,
        colorPalette,
        brandFonts,
        brandVoices: {
          ...brandVoices,
          purpose: brandVoices.purpose,
          audience: brandVoices.audience,
          language: brandVoices.language,
        },
        contentPreferences,
        // Include editable text fields
        businessOverview: contextData?.businessOverview,
        whyCustomersChoose: contextData?.whyCustomersChoose,
        competitors: contextData?.competitors,
        customerDemographics: contextData?.customerDemographics,
        popularProducts: contextData?.popularProducts,
      };

      const response = await fetch(`/api/admin/dvyb-accounts/${account.id}/context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (data.success) {
        alert('Context saved successfully');
        onSaved?.();
      } else {
        alert(data.error || 'Failed to save context');
      }
    } catch (error) {
      console.error('Failed to save context:', error);
      alert('Failed to save context');
    } finally {
      setIsSaving(false);
    }
  };

  // Edit handlers
  const handleEdit = (section: string, data: any) => {
    setEditingSection(section);
    setEditData(data);
  };

  const handleCancelEdit = () => {
    setEditingSection(null);
    setEditData({});
  };

  const handleSaveEdit = async (updates: any) => {
    setIsSaving(true);
    try {
      const result = await saveContext(updates);
      if (result.success) {
        // Update local state
        setContextData((prev: any) => ({ ...prev, ...updates }));
        setEditingSection(null);
        setEditData({});
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Edit Context</h2>
            <p className="text-sm text-gray-500">{account.accountName} ({account.primaryEmail})</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="bg-purple-100 hover:bg-purple-200 text-purple-700 font-medium"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save All Changes
                </>
              )}
            </Button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="flex border-b border-gray-200 overflow-x-auto flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
          ) : (
            <>
              {/* Source Materials Tab */}
              {activeTab === 'source-materials' && (
                <div className="space-y-6">
                  {/* Webpages Section */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Webpages <span className="text-sm font-normal text-gray-500">({links.length})</span>
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Add webpage URLs for context and inspiration</p>

                    <div className="space-y-3">
                      {links.map((link, i) => (
                        <div key={i} className="flex items-center gap-3 bg-white p-3 rounded-lg border">
                          <Globe className="w-5 h-5 text-gray-400 flex-shrink-0" />
                          <input
                            type="url"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            value={link.url || ''}
                            onChange={(e) => {
                              const next = [...links];
                              next[i] = { ...next[i], url: e.target.value };
                              setLinks(next);
                            }}
                            placeholder="https://example.com"
                          />
                          {link.timestamp && (
                            <span className="text-xs text-gray-400">{new Date(link.timestamp).toLocaleDateString()}</span>
                          )}
                          <button
                            onClick={() => setLinks(links.filter((_, idx) => idx !== i))}
                            className="p-1 hover:bg-red-100 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setLinks([...links, { url: '', timestamp: new Date().toISOString() }])}
                        className="flex items-center gap-2 text-purple-600 hover:text-purple-700 text-sm font-medium"
                      >
                        <Plus className="w-4 h-4" />
                        Add More
                      </button>
                    </div>
                  </div>

                  {/* Social Connections (Read-only) */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Social Connections <span className="text-sm font-normal text-gray-500">(Read-only)</span>
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Connected social media accounts</p>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {['google', 'twitter', 'instagram', 'linkedin', 'tiktok'].map((platform) => (
                        <div
                          key={platform}
                          className={`p-3 rounded-lg border text-center ${
                            connections[platform] === 'connected'
                              ? 'bg-green-50 border-green-200'
                              : connections[platform] === 'expired'
                              ? 'bg-orange-50 border-orange-200'
                              : 'bg-gray-100 border-gray-200'
                          }`}
                        >
                          <p className="font-medium capitalize text-gray-900">{platform}</p>
                          <p className={`text-xs ${
                            connections[platform] === 'connected'
                              ? 'text-green-600'
                              : connections[platform] === 'expired'
                              ? 'text-orange-600'
                              : 'text-gray-500'
                          }`}>
                            {connections[platform] === 'connected' ? '✓ Connected' : 
                             connections[platform] === 'expired' ? '⚠ Expired' : 'Not connected'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Documents Section */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Files <span className="text-sm font-normal text-gray-500">({uploadedDocuments.length})</span>
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Upload PDF or DOCX files. Text will be automatically extracted.</p>

                    <DocumentDropzone
                      documents={uploadedDocuments}
                      onUpload={(files) => setPendingDocumentFiles([...pendingDocumentFiles, ...files])}
                      onDelete={deleteDocument}
                      uploading={uploadingDocuments}
                      pendingFiles={pendingDocumentFiles}
                      onRemovePending={(idx) => setPendingDocumentFiles(pendingDocumentFiles.filter((_, i) => i !== idx))}
                      onUploadSingle={handleSingleDocumentUpload}
                      onUploadAll={handleDocumentsUpload}
                    />
                  </div>
                </div>
              )}

              {/* Images & Video Tab */}
              {activeTab === 'images-video' && (
                <div className="space-y-6">
                  {/* Upload Area */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Media</h3>
                    <MediaDropzone
                      onUpload={(files) => setPendingMediaFiles([...pendingMediaFiles, ...files])}
                      uploading={uploadingMedia}
                      pendingFiles={pendingMediaFiles}
                      onRemovePending={(idx) => setPendingMediaFiles(pendingMediaFiles.filter((_, i) => i !== idx))}
                      onUploadAll={handleMediaUpload}
                    />
                  </div>

                  {/* Primary Logo */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Primary Logo</h3>
                    <LogoDropzone
                      logoUrl={contextData?.logoPresignedUrl}
                      onUpload={handleLogoUpload}
                      uploading={uploadingLogo}
                    />
                  </div>

                  {/* Additional Logos */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Additional Logos <span className="text-sm font-normal text-gray-500">({additionalLogos.length})</span>
                    </h3>
                    <AdditionalLogosDropzone
                      logos={additionalLogos}
                      onUpload={handleAdditionalLogosUpload}
                      onDelete={deleteAdditionalLogo}
                      uploading={uploadingAdditionalLogos}
                    />
                  </div>

                  {/* Brand Images */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Brand Images <span className="text-sm font-normal text-gray-500">({uploadedMedia.images.length})</span>
                    </h3>
                    {uploadedMedia.images.length > 0 ? (
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                        {uploadedMedia.images.map((img, idx) => (
                          <div key={idx} className="relative group aspect-square bg-white rounded-lg border overflow-hidden">
                            <Image
                              src={img.presignedUrl}
                              alt={`Image ${idx + 1}`}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                            <button
                              onClick={() => deleteMedia('image', idx)}
                              className="absolute top-1 right-1 p-1 bg-red-100 hover:bg-red-200 text-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            {img.timestamp && (
                              <div className="absolute bottom-0 left-0 right-0 bg-gray-100 text-gray-600 text-xs p-1 text-center">
                                {new Date(img.timestamp).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-white rounded-lg border">
                        <div className="text-center">
                          <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">No images uploaded yet</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Brand Videos */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                      Brand Videos <span className="text-sm font-normal text-gray-500">({uploadedMedia.videos.length})</span>
                    </h3>
                    {uploadedMedia.videos.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {uploadedMedia.videos.map((vid, idx) => (
                          <div key={idx} className="relative group bg-gray-900 rounded-lg overflow-hidden">
                            <video
                              src={vid.presignedUrl}
                              controls
                              className="w-full"
                            />
                            <button
                              onClick={() => deleteMedia('video', idx)}
                              className="absolute top-2 right-2 p-1 bg-red-100 hover:bg-red-200 text-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            {vid.timestamp && (
                              <div className="absolute bottom-0 left-0 right-0 bg-gray-100 text-gray-600 text-xs p-2">
                                {new Date(vid.timestamp).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-32 bg-white rounded-lg border">
                        <div className="text-center">
                          <Play className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">No videos uploaded yet</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Brand Profile Tab */}
              {activeTab === 'brand-profile' && (
                <div className="space-y-6">
                  {/* Business Overview */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Business Overview & Positioning</h3>
                      {editingSection !== 'business-overview' && (
                        <button
                          onClick={() => handleEdit('business-overview', {
                            businessOverview: contextData?.businessOverview || '',
                            whyCustomersChoose: contextData?.whyCustomersChoose || '',
                            competitors: contextData?.competitors || '',
                          })}
                          className="flex items-center gap-1 text-purple-600 hover:text-purple-700 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                      )}
                    </div>
                    
                    {editingSection === 'business-overview' ? (
                      <div className="space-y-6">
                        <div>
                          <label className="text-sm font-semibold text-gray-900 block mb-3">Business Overview</label>
                          <RichTextEditor
                            content={editData.businessOverview}
                            onSave={() => {}}
                            onCancel={() => {}}
                            onChange={(content) => setEditData((prev: any) => ({ ...prev, businessOverview: content }))}
                            hideButtons={true}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold text-gray-900 block mb-3">Why Customers Choose</label>
                          <RichTextEditor
                            content={editData.whyCustomersChoose}
                            onSave={() => {}}
                            onCancel={() => {}}
                            onChange={(content) => setEditData((prev: any) => ({ ...prev, whyCustomersChoose: content }))}
                            hideButtons={true}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-semibold text-gray-900 block mb-3">Competitors</label>
                          <RichTextEditor
                            content={editData.competitors}
                            onSave={() => {}}
                            onCancel={() => {}}
                            onChange={(content) => setEditData((prev: any) => ({ ...prev, competitors: content }))}
                            hideButtons={true}
                          />
                        </div>
                        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
                          <button
                            onClick={handleCancelEdit}
                            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 bg-white"
                          >
                            Cancel All
                          </button>
                          <button
                            onClick={() => {
                              setContextData((prev: any) => ({
                                ...prev,
                                businessOverview: editData.businessOverview,
                                whyCustomersChoose: editData.whyCustomersChoose,
                                competitors: editData.competitors,
                              }));
                              handleSaveEdit({
                                businessOverview: editData.businessOverview,
                                whyCustomersChoose: editData.whyCustomersChoose,
                                competitors: editData.competitors,
                              });
                            }}
                            disabled={isSaving}
                            className="px-4 py-2 text-sm bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50 font-medium"
                          >
                            {isSaving ? 'Saving...' : 'Save All Changes'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-white p-4 rounded-lg border">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Business Overview:</h4>
                          {contextData?.businessOverview ? (
                            <FormattedText text={contextData.businessOverview} />
                          ) : (
                            <p className="text-sm text-gray-500">No business overview added yet.</p>
                          )}
                        </div>
                        {contextData?.whyCustomersChoose && (
                          <div className="bg-white p-4 rounded-lg border">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Why Customers Choose:</h4>
                            <FormattedText text={contextData.whyCustomersChoose} />
                          </div>
                        )}
                        {contextData?.competitors && (
                          <div className="bg-white p-4 rounded-lg border">
                            <h4 className="text-sm font-semibold text-gray-900 mb-3">Competitors:</h4>
                            <FormattedText text={contextData.competitors} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Customer Demographics */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Customer Demographics</h3>
                      {editingSection !== 'demographics' && (
                        <button
                          onClick={() => handleEdit('demographics', {
                            customerDemographics: contextData?.customerDemographics || '',
                          })}
                          className="flex items-center gap-1 text-purple-600 hover:text-purple-700 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                      )}
                    </div>
                    
                    {editingSection === 'demographics' ? (
                      <div className="space-y-4">
                        <RichTextEditor
                          content={editData.customerDemographics}
                          onSave={(content) => {
                            setContextData((prev: any) => ({ ...prev, customerDemographics: content }));
                            handleSaveEdit({ customerDemographics: content });
                          }}
                          onCancel={handleCancelEdit}
                          isSaving={isSaving}
                        />
                      </div>
                    ) : (
                      <div className="bg-white p-4 rounded-lg border">
                        {contextData?.customerDemographics ? (
                          <FormattedText text={contextData.customerDemographics} />
                        ) : (
                          <p className="text-sm text-gray-500">No demographics data available.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Popular Products */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Popular Products & Services</h3>
                      {editingSection !== 'products' && (
                        <button
                          onClick={() => handleEdit('products', {
                            popularProducts: contextData?.popularProducts || '',
                          })}
                          className="flex items-center gap-1 text-purple-600 hover:text-purple-700 text-sm"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                      )}
                    </div>
                    
                    {editingSection === 'products' ? (
                      <div className="space-y-4">
                        <RichTextEditor
                          content={editData.popularProducts}
                          onSave={(content) => {
                            setContextData((prev: any) => ({ ...prev, popularProducts: content }));
                            handleSaveEdit({ popularProducts: content });
                          }}
                          onCancel={handleCancelEdit}
                          isSaving={isSaving}
                        />
                      </div>
                    ) : (
                      <div className="bg-white p-4 rounded-lg border">
                        {contextData?.popularProducts ? (
                          <FormattedText text={contextData.popularProducts} />
                        ) : (
                          <p className="text-sm text-gray-500">No products data available.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Styles & Voice Tab */}
              {activeTab === 'styles-voice' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Brand Styles */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Brand Styles</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Visual Identity Description</h4>
                        <ChipInput
                          value={brandStyles.visual_identity_description}
                          onChange={(chips) => setBrandStyles({ ...brandStyles, visual_identity_description: chips })}
                          placeholder="Type and press Enter to add..."
                        />
                      </div>
                      
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Visual Identity Keywords</h4>
                        <ChipInput
                          value={brandStyles.visual_identity_keywords}
                          onChange={(chips) => setBrandStyles({ ...brandStyles, visual_identity_keywords: chips })}
                          placeholder="Type and press Enter to add keywords..."
                        />
                      </div>

                      {/* Colors */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Colors</h4>
                        <div className="space-y-2">
                          {['primary', 'secondary', 'accent'].map((colorType) => (
                            <div key={colorType} className="flex items-center gap-3">
                              <label className="text-sm capitalize w-24">{colorType}:</label>
                              <input
                                type="color"
                                value={(colorPalette as any)[colorType] || '#000000'}
                                onChange={(e) => setColorPalette({ ...colorPalette, [colorType]: e.target.value })}
                                className="w-12 h-8 rounded border cursor-pointer"
                              />
                              <span className="text-xs text-gray-500">{(colorPalette as any)[colorType]}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Fonts */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Fonts</h4>
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs text-gray-500">Title Font:</label>
                            <select
                              value={brandFonts.title}
                              onChange={(e) => setBrandFonts({ ...brandFonts, title: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1 text-gray-900 bg-white"
                            >
                              {['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato', 'Playfair Display', 'Merriweather'].map((font) => (
                                <option key={font} value={font}>{font}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Body Font:</label>
                            <select
                              value={brandFonts.body}
                              onChange={(e) => setBrandFonts({ ...brandFonts, body: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1 text-gray-900 bg-white"
                            >
                              {['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato', 'Playfair Display', 'Merriweather'].map((font) => (
                                <option key={font} value={font}>{font}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Brand Voice */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Brand Voice</h3>
                    
                    <div className="space-y-4 max-h-[600px] overflow-y-auto">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Purpose</h4>
                        <textarea
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px] text-gray-900 bg-white"
                          value={brandVoices.purpose}
                          onChange={(e) => setBrandVoices({ ...brandVoices, purpose: e.target.value })}
                          placeholder="Describe your brand's purpose..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Audience</h4>
                        <textarea
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px] text-gray-900 bg-white"
                          value={brandVoices.audience}
                          onChange={(e) => setBrandVoices({ ...brandVoices, audience: e.target.value })}
                          placeholder="Describe your target audience..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Tone</h4>
                        <ChipInput
                          value={brandVoices.tone}
                          onChange={(chips) => setBrandVoices({ ...brandVoices, tone: chips })}
                          placeholder="e.g., Professional, Friendly, Authoritative..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Emotions</h4>
                        <ChipInput
                          value={brandVoices.emotions}
                          onChange={(chips) => setBrandVoices({ ...brandVoices, emotions: chips })}
                          placeholder="e.g., Inspiring, Trustworthy, Exciting..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Character</h4>
                        <ChipInput
                          value={brandVoices.character}
                          onChange={(chips) => setBrandVoices({ ...brandVoices, character: chips })}
                          placeholder="Brand character traits..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Syntax</h4>
                        <ChipInput
                          value={brandVoices.syntax}
                          onChange={(chips) => setBrandVoices({ ...brandVoices, syntax: chips })}
                          placeholder="Syntax preferences..."
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Language</h4>
                        <textarea
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[80px] text-gray-900 bg-white"
                          value={brandVoices.language}
                          onChange={(e) => setBrandVoices({ ...brandVoices, language: e.target.value })}
                          placeholder="Language preferences..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Content Preferences Tab */}
              {activeTab === 'content-preferences' && (
                <div className="space-y-6">
                  {/* Design Preferences */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Design Preferences</h3>
                    
                    <div className="space-y-6">
                      {/* Featured Media */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Featured Media</h4>
                        <p className="text-xs text-gray-500 mb-3">Select the type of media you prefer to spotlight in your social posts.</p>
                        <div className="flex gap-4">
                          {['text', 'image', 'video'].map((type) => (
                            <label key={type} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={contentPreferences.featuredMedia?.[type] || false}
                                onChange={(e) => setContentPreferences({
                                  ...contentPreferences,
                                  featuredMedia: { ...contentPreferences.featuredMedia, [type]: e.target.checked },
                                })}
                                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                              />
                              <span className="capitalize text-sm text-gray-700">{type}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Brand Kit Media Priority */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Brand Kit Media Priority</h4>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: 'only_brand_kit', label: 'Only my Brand Kit' },
                            { value: 'brand_kit_first', label: 'Brand Kit first' },
                            { value: 'only_stock', label: 'Only stock' },
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaPriority: option.value })}
                              className={`px-3 py-1.5 text-sm rounded-lg border ${
                                contentPreferences.brandKitMediaPriority === option.value
                                  ? 'bg-purple-100 text-purple-700 border-purple-300 font-medium'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Media Reuse */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Reusing Brand Kit Media</h4>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: 'never_reuse', label: 'Never re-use' },
                            { value: 'reuse_after_3_weeks', label: 'Re-use after 3 weeks' },
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaReuse: option.value })}
                              className={`px-3 py-1.5 text-sm rounded-lg border ${
                                contentPreferences.brandKitMediaReuse === option.value
                                  ? 'bg-purple-100 text-purple-700 border-purple-300 font-medium'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Content Preferences */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Content Preferences</h3>
                    
                    <div className="space-y-6">
                      {/* Content Language */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Content Language</h4>
                        <select
                          value={contentPreferences.contentLanguage || 'en-us'}
                          onChange={(e) => setContentPreferences({ ...contentPreferences, contentLanguage: e.target.value })}
                          className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                        >
                          <option value="en-us">English (US)</option>
                          <option value="en-gb">English (UK)</option>
                          <option value="es">Spanish</option>
                          <option value="fr">French</option>
                          <option value="de">German</option>
                          <option value="hi">Hindi</option>
                          <option value="pa">Punjabi</option>
                          <option value="mr">Marathi</option>
                          <option value="gu">Gujarati</option>
                          <option value="ml">Malayalam</option>
                          <option value="ta">Tamil</option>
                          <option value="te">Telugu</option>
                          <option value="kn">Kannada</option>
                          <option value="bn">Bengali</option>
                          <option value="or">Odia</option>
                        </select>
                      </div>

                      {/* Topics to Avoid */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Topics to Avoid</h4>
                        <ChipInput
                          value={contentPreferences.topicsToAvoid || []}
                          onChange={(chips) => setContentPreferences({ ...contentPreferences, topicsToAvoid: chips })}
                          placeholder="Type topic and press Enter to add..."
                        />
                      </div>

                      {/* Words to Avoid */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Words and Phrases to Avoid</h4>
                        <ChipInput
                          value={contentPreferences.wordsToAvoid || []}
                          onChange={(chips) => setContentPreferences({ ...contentPreferences, wordsToAvoid: chips })}
                          placeholder="Type word/phrase and press Enter to add..."
                        />
                      </div>

                      {/* Hashtags to Include */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Hashtags to Include</h4>
                        <ChipInput
                          value={contentPreferences.hashtags?.include || []}
                          onChange={(chips) => setContentPreferences({
                            ...contentPreferences,
                            hashtags: { ...contentPreferences.hashtags, include: chips },
                          })}
                          placeholder="#branding, #marketing, ..."
                        />
                      </div>

                      {/* Hashtags to Avoid */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Hashtags to Avoid</h4>
                        <ChipInput
                          value={contentPreferences.hashtags?.avoid || []}
                          onChange={(chips) => setContentPreferences({
                            ...contentPreferences,
                            hashtags: { ...contentPreferences.hashtags, avoid: chips },
                          })}
                          placeholder="Hashtags to avoid..."
                        />
                      </div>

                      {/* CTA Settings */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">CTA Copy</h4>
                        <textarea
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                          rows={2}
                          value={contentPreferences.ctaCopy || ''}
                          onChange={(e) => setContentPreferences({ ...contentPreferences, ctaCopy: e.target.value })}
                          placeholder="e.g., Learn more at our website!"
                        />
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">CTA Links</h4>
                        <ChipInput
                          value={contentPreferences.ctaLinks || []}
                          onChange={(chips) => setContentPreferences({ ...contentPreferences, ctaLinks: chips })}
                          placeholder="https://example.com, https://landing.com"
                        />
                      </div>

                      {/* CTA Frequency */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">CTA Frequency</h4>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { value: 'never', label: 'Never' },
                            { value: 'sometimes', label: 'Sometimes' },
                            { value: 'always', label: 'Always' },
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => setContentPreferences({ ...contentPreferences, ctaFrequency: option.value })}
                              className={`px-3 py-1.5 text-sm rounded-lg border ${
                                contentPreferences.ctaFrequency === option.value
                                  ? 'bg-purple-100 text-purple-700 border-purple-300 font-medium'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
