"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit, Trash2, Upload, HelpCircle, Image as ImageIcon, Loader2, Save, X, CloudUpload, Globe, Twitter, Instagram as InstagramIcon, Linkedin, Play } from "lucide-react";
import { contextApi, uploadApi, socialConnectionsApi, authApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { ChipInput } from "@/components/ui/ChipInput";
import { LogoDropzone } from "@/components/ui/LogoDropzone";
import { AdditionalLogosDropzone } from "@/components/ui/AdditionalLogosDropzone";
import { TikTokIcon } from "@/components/icons/TikTokIcon";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { trackBrandKitViewed, trackBrandKitTabViewed, trackBrandKitSaved, trackBrandKitSaveAllClicked } from "@/lib/mixpanel";

// Helper function to format text with line breaks and bold sections
const FormattedText = ({ text }: { text: string }) => {
  if (!text) return null;

  // Split by lines and process each line
  const lines = text.split('\n');
  
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
            <p key={index} className="text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{header}</span>
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
              <p key={index} className="text-muted-foreground leading-relaxed ml-0">
                {bullet}<span className="font-semibold text-foreground">{boldText}{separator}</span>{rest}
              </p>
            );
          }
          
          return (
            <p key={index} className="text-muted-foreground leading-relaxed ml-0">
              {line}
            </p>
          );
        }
        
        // Regular paragraph
        return (
          <p key={index} className="text-muted-foreground leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
};

// Types
interface LinkData {
  url: string;
  timestamp?: string;
}

interface DocumentData {
  name: string;
  url: string; // S3 key
  text: string;
  timestamp?: string;
}

type ConnectionState = 'connected' | 'expired' | 'not_connected';

interface ConnectionStatus {
  google: ConnectionState;
  twitter: ConnectionState;
  instagram: ConnectionState;
  linkedin: ConnectionState;
  tiktok: ConnectionState;
}

interface ConnectionData {
  profilePicture?: string;
  name?: string;
  email?: string;
  handle?: string;
  username?: string;
}

export const BrandKitPage = () => {
  const [activeTab, setActiveTab] = useState("source-materials");
  const [contextData, setContextData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  
  // Edit states for different sections
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>({});
  
  // Source Materials states
  const [links, setLinks] = useState<LinkData[]>([]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [uploadedDocuments, setUploadedDocuments] = useState<DocumentData[]>([]);
  
  // Images & Video states
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<{
    images: Array<{ url: string; presignedUrl: string; timestamp: string }>;
    videos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
  }>({ images: [], videos: [] });
  
  // Connection states
  const [connections, setConnections] = useState<ConnectionStatus>({
    google: 'not_connected',
    twitter: 'not_connected',
    instagram: 'not_connected',
    linkedin: 'not_connected',
    tiktok: 'not_connected',
  });
  const [connectionData, setConnectionData] = useState<Record<string, ConnectionData>>({});
  
  // Additional Logos states
  const [uploadingAdditionalLogos, setUploadingAdditionalLogos] = useState(false);
  const [additionalLogos, setAdditionalLogos] = useState<Array<{ url: string; presignedUrl: string; timestamp: string }>>([]);
  
  // Brand Styles states
  const [brandStyles, setBrandStyles] = useState<{
    visual_identity_description: string[];
    visual_identity_keywords: string[];
  }>({ visual_identity_description: [], visual_identity_keywords: [] });
  
  // Brand Voices states
  const [brandVoices, setBrandVoices] = useState<{
    purpose: string;
    audience: string;
    tone: string[];
    emotions: string[];
    character: string[];
    syntax: string[];
    language: string;
  }>({ purpose: '', audience: '', tone: [], emotions: [], character: [], syntax: [], language: '' });
  
  // Content Preferences states
  const [contentPreferences, setContentPreferences] = useState<{
    featuredMedia: { text: boolean; image: boolean; video: boolean };
    brandKitMediaPriority: 'only_brand_kit' | 'brand_kit_first' | 'only_stock';
    brandKitMediaReuse: 'never_reuse' | 'reuse_after_3_weeks';
    alwaysIncludeBlogImages: boolean;
    contentLanguage: string;
    topicsToAvoid: string[];
    wordsToAvoid: string[];
    blogKeywords: string[];
    alwaysIncludeExternalLinks: boolean;
    externalUrlsToAvoid: string[];
    hashtags: { avoid: string[]; include: string[] };
    hashtagFrequency: 'never' | 'sometimes' | 'always';
    logoFrequency: 'never' | 'sometimes' | 'always';
    ctaLinks: string[];
    ctaCopy: string;
    ctaFrequency: 'never' | 'sometimes' | 'always';
  }>({
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
  
  const { toast } = useToast();
  const { accountId, logout } = useAuth();
  const router = useRouter();

  // Check for OAuth success (from redirect flow callbacks)
  useEffect(() => {
    const oauthSuccessStr = localStorage.getItem('dvyb_oauth_success');
    if (oauthSuccessStr) {
      try {
        const oauthSuccess = JSON.parse(oauthSuccessStr);
        // Check if it's recent (within last 30 seconds)
        if (Date.now() - oauthSuccess.timestamp < 30000) {
          toast({
            title: "Connected!",
            description: oauthSuccess.message || `${oauthSuccess.platform} connected successfully`,
          });
          
          // Refresh connections
          fetchConnections();
        }
      } catch (e) {
        console.error('Error parsing OAuth success:', e);
      }
      // Clean up
      localStorage.removeItem('dvyb_oauth_success');
    }
  }, []);

  // Track page view on mount
  useEffect(() => {
    trackBrandKitViewed();
  }, []);

  // Track tab changes
  useEffect(() => {
    trackBrandKitTabViewed(activeTab);
  }, [activeTab]);

  // Fetch context data on mount
  useEffect(() => {
    if (accountId) {
      fetchContextData();
      fetchConnections();
    }
  }, [accountId]);

  const fetchContextData = async () => {
    try {
      setIsLoading(true);
      const response = await contextApi.getContext();
      if (response.success && response.data) {
        setContextData(response.data);
        
        // Load links (webpages) - include website from context AND linksJson
        const allLinks: LinkData[] = [];
        
        // Add website if it exists
        if (response.data.website) {
          allLinks.push({
            url: response.data.website,
            timestamp: response.data.createdAt || new Date().toISOString(),
          });
        }
        
        // Add links from linksJson
        if (response.data.linksJson) {
          if (Array.isArray(response.data.linksJson) && response.data.linksJson.length > 0) {
            if (typeof response.data.linksJson[0] === 'string') {
              // Old format: array of strings - convert to new format
              allLinks.push(...response.data.linksJson.map((url: string) => ({ 
                url, 
                timestamp: new Date().toISOString() 
              })));
            } else {
              // New format: array of objects with timestamps
              allLinks.push(...response.data.linksJson);
            }
          }
        }
        
        setLinks(allLinks);
        
        // Load documents
        if (response.data.documentsText && Array.isArray(response.data.documentsText)) {
          setUploadedDocuments(response.data.documentsText);
        }
        
        // Load images and videos with presigned URLs
        const images: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
        const videos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
        
        if (response.data.brandImages && Array.isArray(response.data.brandImages)) {
          for (const item of response.data.brandImages) {
            if (typeof item === 'string') {
              // Old format: just S3 key
              const presignedUrl = await uploadApi.getPresignedUrl(item);
              images.push({ url: item, presignedUrl: presignedUrl || item, timestamp: new Date().toISOString() });
            } else if (item.url) {
              // New format: object with url and timestamp
              const presignedUrl = await uploadApi.getPresignedUrl(item.url);
              images.push({ url: item.url, presignedUrl: presignedUrl || item.url, timestamp: item.timestamp || new Date().toISOString() });
            }
          }
        }
        
        if (response.data.brandAssets && Array.isArray(response.data.brandAssets)) {
          for (const item of response.data.brandAssets) {
            if (typeof item === 'string') {
              // Old format: just S3 key
              const presignedUrl = await uploadApi.getPresignedUrl(item);
              videos.push({ url: item, presignedUrl: presignedUrl || item, timestamp: new Date().toISOString() });
            } else if (item.url) {
              // New format: object with url and timestamp
              const presignedUrl = await uploadApi.getPresignedUrl(item.url);
              videos.push({ url: item.url, presignedUrl: presignedUrl || item.url, timestamp: item.timestamp || new Date().toISOString() });
            }
          }
        }
        
        setUploadedMedia({ images, videos });
        
        // Load additional logos
        if (response.data.additionalLogoUrls && Array.isArray(response.data.additionalLogoUrls)) {
          const logos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
          for (const item of response.data.additionalLogoUrls) {
            if (item.url) {
              try {
                const presignedResponse = await uploadApi.getPresignedUrlFromKey(item.url);
                logos.push({
                  url: item.url,
                  presignedUrl: presignedResponse.presigned_url || item.url,
                  timestamp: item.timestamp || new Date().toISOString(),
                });
              } catch (error) {
                console.error('Failed to get presigned URL for additional logo:', error);
                // Use the URL as-is if presigned URL generation fails
                logos.push({
                  url: item.url,
                  presignedUrl: item.url,
                  timestamp: item.timestamp || new Date().toISOString(),
                });
              }
            }
          }
          setAdditionalLogos(logos);
        }
        
        // Load brand styles
        if (response.data.brandStyles) {
          setBrandStyles({
            visual_identity_description: response.data.brandStyles.visual_identity_description || [],
            visual_identity_keywords: response.data.brandStyles.visual_identity_keywords || [],
          });
        }
        
        // Load brand voices
        if (response.data.brandVoices) {
          setBrandVoices({
            purpose: Array.isArray(response.data.brandVoices.purpose) 
              ? response.data.brandVoices.purpose.join('\n') 
              : (response.data.brandVoices.purpose || ''),
            audience: Array.isArray(response.data.brandVoices.audience)
              ? response.data.brandVoices.audience.join('\n')
              : (response.data.brandVoices.audience || ''),
            tone: response.data.brandVoices.tone || [],
            emotions: response.data.brandVoices.emotions || [],
            character: response.data.brandVoices.character || [],
            syntax: response.data.brandVoices.syntax || [],
            language: Array.isArray(response.data.brandVoices.language)
              ? response.data.brandVoices.language.join('\n')
              : (response.data.brandVoices.language || ''),
          });
        }
        
        // Load content preferences
        if (response.data.contentPreferences) {
          setContentPreferences({
            featuredMedia: response.data.contentPreferences.featuredMedia || { text: true, image: true, video: true },
            brandKitMediaPriority: response.data.contentPreferences.brandKitMediaPriority || 'brand_kit_first',
            brandKitMediaReuse: response.data.contentPreferences.brandKitMediaReuse || 'reuse_after_3_weeks',
            alwaysIncludeBlogImages: response.data.contentPreferences.alwaysIncludeBlogImages ?? true,
            contentLanguage: response.data.contentPreferences.contentLanguage || 'en-us',
            topicsToAvoid: response.data.contentPreferences.topicsToAvoid || [],
            wordsToAvoid: response.data.contentPreferences.wordsToAvoid || [],
            blogKeywords: response.data.contentPreferences.blogKeywords || [],
            alwaysIncludeExternalLinks: response.data.contentPreferences.alwaysIncludeExternalLinks ?? true,
            externalUrlsToAvoid: response.data.contentPreferences.externalUrlsToAvoid || [],
            hashtags: response.data.contentPreferences.hashtags || { avoid: [], include: [] },
            hashtagFrequency: response.data.contentPreferences.hashtagFrequency || 'sometimes',
            logoFrequency: response.data.contentPreferences.logoFrequency || 'sometimes',
            ctaLinks: response.data.contentPreferences.ctaLinks || [],
            ctaCopy: response.data.contentPreferences.ctaCopy || '',
            ctaFrequency: response.data.contentPreferences.ctaFrequency || 'sometimes',
          });
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch context:", error);
      toast({
        title: "Error",
        description: "Failed to load Brand Kit data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchConnections = async () => {
    try {
      // Fetch all connection statuses
      const response = await socialConnectionsApi.getAllConnectionStatuses();
      if (response.success && response.data) {
        setConnections({
          google: response.data.google || 'not_connected',
          twitter: response.data.twitter || 'not_connected',
          instagram: response.data.instagram || 'not_connected',
          linkedin: response.data.linkedin || 'not_connected',
          tiktok: response.data.tiktok || 'not_connected',
        });
      }
      
      // TODO: Fetch connection details (profile pics, handles) from backend
      // This would require new endpoints to get connection details
    } catch (error) {
      console.error("Failed to fetch connections:", error);
    }
  };

  const handleEdit = (section: string, initialData: any) => {
    setEditingSection(section);
    setEditData(initialData);
  };

  const handleCancelEdit = () => {
    setEditingSection(null);
    setEditData({});
  };

  const handleSave = async (updates: any) => {
    try {
      setIsSaving(true);
      console.log('💾 Saving updates:', updates);
      
      // Track what fields are being updated
      const fieldsUpdated = Object.keys(updates);
      trackBrandKitSaved(activeTab, fieldsUpdated);
      
      const response = await contextApi.updateContext(updates);
      console.log('✅ Save response:', response);
      
      if (response.success && response.data) {
        setContextData(response.data);
        
        // Reload brand styles from saved data
        if (response.data.brandStyles) {
          setBrandStyles({
            visual_identity_description: response.data.brandStyles.visual_identity_description || [],
            visual_identity_keywords: response.data.brandStyles.visual_identity_keywords || [],
          });
          console.log('✅ Reloaded brandStyles from response:', response.data.brandStyles);
        }
        
        // Reload brand voices from saved data
        if (response.data.brandVoices) {
          setBrandVoices({
            purpose: Array.isArray(response.data.brandVoices.purpose) 
              ? response.data.brandVoices.purpose.join('\n') 
              : (response.data.brandVoices.purpose || ''),
            audience: Array.isArray(response.data.brandVoices.audience)
              ? response.data.brandVoices.audience.join('\n')
              : (response.data.brandVoices.audience || ''),
            tone: response.data.brandVoices.tone || [],
            emotions: response.data.brandVoices.emotions || [],
            character: response.data.brandVoices.character || [],
            syntax: response.data.brandVoices.syntax || [],
            language: Array.isArray(response.data.brandVoices.language)
              ? response.data.brandVoices.language.join('\n')
              : (response.data.brandVoices.language || ''),
          });
          console.log('✅ Reloaded brandVoices from response:', response.data.brandVoices);
        }
        
        // Reload content preferences from saved data
        if (response.data.contentPreferences) {
          setContentPreferences({
            featuredMedia: response.data.contentPreferences.featuredMedia || { text: true, image: true, video: true },
            brandKitMediaPriority: response.data.contentPreferences.brandKitMediaPriority || 'brand_kit_first',
            brandKitMediaReuse: response.data.contentPreferences.brandKitMediaReuse || 'reuse_after_3_weeks',
            alwaysIncludeBlogImages: response.data.contentPreferences.alwaysIncludeBlogImages ?? true,
            contentLanguage: response.data.contentPreferences.contentLanguage || 'en-us',
            topicsToAvoid: response.data.contentPreferences.topicsToAvoid || [],
            wordsToAvoid: response.data.contentPreferences.wordsToAvoid || [],
            blogKeywords: response.data.contentPreferences.blogKeywords || [],
            alwaysIncludeExternalLinks: response.data.contentPreferences.alwaysIncludeExternalLinks ?? true,
            externalUrlsToAvoid: response.data.contentPreferences.externalUrlsToAvoid || [],
            hashtags: response.data.contentPreferences.hashtags || { avoid: [], include: [] },
            hashtagFrequency: response.data.contentPreferences.hashtagFrequency || 'sometimes',
            logoFrequency: response.data.contentPreferences.logoFrequency || 'sometimes',
            ctaLinks: response.data.contentPreferences.ctaLinks || [],
            ctaCopy: response.data.contentPreferences.ctaCopy || '',
            ctaFrequency: response.data.contentPreferences.ctaFrequency || 'sometimes',
          });
          console.log('✅ Reloaded contentPreferences from response:', response.data.contentPreferences);
        }
        
        setEditingSection(null);
        setEditData({});
        toast({
          title: "Success",
          description: "Changes saved successfully",
        });
      }
    } catch (error: any) {
      console.error("❌ Failed to save changes:", error);
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    try {
      setUploadingLogo(true);
      const response = await uploadApi.uploadLogo(file);
      if (response.success && response.data) {
        // Store S3 key in database, display presigned URL in UI
        await handleSave({ logoUrl: response.data.s3_key });
        
        // Update context data to trigger re-render with presigned URL
        setContextData((prev: any) => ({
          ...prev,
          logoUrl: response.data.s3_key,
          logoPresignedUrl: response.data.presignedUrl,
        }));
        
        toast({
          title: "Success",
          description: "Logo uploaded successfully",
        });
      }
    } catch (error: any) {
      console.error("Failed to upload logo:", error);
      toast({
        title: "Error",
        description: "Failed to upload logo",
        variant: "destructive",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleAdditionalLogosUpload = async (files: File[]) => {
    if (files.length === 0) return;

    try {
      setUploadingAdditionalLogos(true);
      const response = await uploadApi.uploadAdditionalLogos(files);
      if (response.success && response.data?.logos) {
        const newLogos = [...additionalLogos, ...response.data.logos];
        setAdditionalLogos(newLogos);
        
        // Save to backend immediately
        await handleSave({
          additionalLogoUrls: newLogos,
        });
        
        toast({
          title: "Success",
          description: `${files.length} logo(s) uploaded successfully`,
        });
      }
    } catch (error: any) {
      console.error("Failed to upload additional logos:", error);
      toast({
        title: "Error",
        description: "Failed to upload additional logos",
        variant: "destructive",
      });
    } finally {
      setUploadingAdditionalLogos(false);
    }
  };

  const deleteAdditionalLogo = async (index: number) => {
    try {
      const newLogos = additionalLogos.filter((_, i) => i !== index);
      setAdditionalLogos(newLogos);
      
      // Save immediately when deleting
      await handleSave({
        additionalLogoUrls: newLogos,
      });
      
      toast({
        title: "Deleted",
        description: "Logo removed successfully",
      });
    } catch (error: any) {
      console.error("Failed to delete logo:", error);
      toast({
        title: "Error",
        description: "Failed to delete logo",
        variant: "destructive",
      });
    }
  };

  const saveContentPreferences = async (section?: 'design' | 'content' | 'cta') => {
    try {
      setIsSaving(true);
      
      // If saving a specific section, merge with existing preferences
      let preferencesToSave = { ...contentPreferences };
      
      if (section === 'design') {
        // Only save design-related preferences
        preferencesToSave = {
          ...contextData?.contentPreferences, // Keep existing data
          featuredMedia: contentPreferences.featuredMedia,
          brandKitMediaPriority: contentPreferences.brandKitMediaPriority,
          brandKitMediaReuse: contentPreferences.brandKitMediaReuse,
          alwaysIncludeBlogImages: contentPreferences.alwaysIncludeBlogImages,
        } as any;
        console.log('💾 Saving Design Preferences:', preferencesToSave);
      } else if (section === 'content') {
        // Only save content-related preferences
        preferencesToSave = {
          ...contextData?.contentPreferences, // Keep existing data
          contentLanguage: contentPreferences.contentLanguage,
          topicsToAvoid: contentPreferences.topicsToAvoid,
          wordsToAvoid: contentPreferences.wordsToAvoid,
          blogKeywords: contentPreferences.blogKeywords,
          alwaysIncludeExternalLinks: contentPreferences.alwaysIncludeExternalLinks,
          externalUrlsToAvoid: contentPreferences.externalUrlsToAvoid,
          hashtags: contentPreferences.hashtags,
          hashtagFrequency: contentPreferences.hashtagFrequency,
          logoFrequency: contentPreferences.logoFrequency,
        } as any;
        console.log('💾 Saving Content Preferences:', preferencesToSave);
      } else if (section === 'cta') {
        // Only save CTA-related preferences
        preferencesToSave = {
          ...contextData?.contentPreferences, // Keep existing data
          ctaLinks: contentPreferences.ctaLinks,
          ctaCopy: contentPreferences.ctaCopy,
          ctaFrequency: contentPreferences.ctaFrequency,
        } as any;
        console.log('💾 Saving CTA Preferences:', preferencesToSave);
      } else {
        // Save all preferences
        console.log('💾 Saving All Content Preferences:', preferencesToSave);
      }
      
      await handleSave({ contentPreferences: preferencesToSave });
      
      toast({
        title: "Success",
        description: section 
          ? `${section === 'design' ? 'Design' : section === 'content' ? 'Content' : 'CTA'} preferences saved successfully`
          : "Content preferences saved successfully",
      });
    } catch (error: any) {
      console.error("Failed to save content preferences:", error);
      toast({
        title: "Error",
        description: "Failed to save content preferences",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAll = async () => {
    try {
      setIsSaving(true);
      
      const updates: any = {};
      
      // Collect all editable data from state
      
      // Source Materials - Links
      const linksToSave = links.map(link => {
        if (contextData?.website && link.url === contextData.website) {
          return link;
        }
        return link;
      }).filter(link => link.url && link.url.trim());
      
      updates.linksJson = linksToSave;
      
      // Note: Documents are saved immediately on upload/delete, not via "Save Changes"
      
      // Brand Profile Tab (if edited)
      if (editData.businessOverview !== undefined) {
        updates.businessOverview = editData.businessOverview;
      }
      if (editData.whyCustomersChoose !== undefined) {
        updates.whyCustomersChoose = editData.whyCustomersChoose;
      }
      if (editData.competitors !== undefined) {
        updates.competitors = editData.competitors;
      }
      if (editData.customerDemographics !== undefined) {
        updates.customerDemographics = editData.customerDemographics;
      }
      if (editData.popularProducts !== undefined) {
        updates.popularProducts = editData.popularProducts;
      }
      
      // Styles & Voice Tab
      // Brand Styles and Brand Voices are saved individually via their own Save buttons
      // But include them if changed via editData
      if (editData.brandStyles !== undefined) {
        updates.brandStyles = editData.brandStyles;
      }
      if (editData.brandVoices !== undefined) {
        updates.brandVoices = editData.brandVoices;
      }
      
      // Content Preferences - Save all current state
      updates.contentPreferences = contentPreferences;
      
      console.log('💾 Saving all changes:', updates);
      
      // Track Save All button clicked with fields being updated
      const fieldsUpdated = Object.keys(updates);
      trackBrandKitSaveAllClicked(fieldsUpdated);
      
      await handleSave(updates);
      
      toast({
        title: "Success",
        description: "All changes saved successfully",
      });
    } catch (error: any) {
      console.error("Failed to save all changes:", error);
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleImagesUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    try {
      setUploadingImages(true);
      const response = await uploadApi.uploadBrandImages(files);
      if (response.success && response.data?.urls) {
        const currentImages = contextData?.brandImages || [];
        const newImages = [...currentImages, ...response.data.urls];
        await handleSave({ brandImages: newImages });
      }
    } catch (error: any) {
      console.error("Failed to upload images:", error);
      toast({
        title: "Error",
        description: "Failed to upload images",
        variant: "destructive",
      });
    } finally {
      setUploadingImages(false);
    }
  };

  const uploadDocuments = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;

    try {
      setUploadingDocuments(true);
      
      // Upload documents and extract text
      const response = await uploadApi.uploadDocuments(filesToUpload);
      
      if (response.success && response.data) {
        // Response contains documents_text array with timestamps
        const newDocs = response.data.documents_text || [];
        
        // Merge with existing documents
        const allDocs = [...uploadedDocuments, ...newDocs];
        setUploadedDocuments(allDocs);
        
        // Extract S3 keys for document_urls
        const allDocumentUrls = allDocs.map(doc => doc.url).filter(url => url);
        
        // Save to backend
        await handleSave({
          documentsText: allDocs,
          documentUrls: allDocumentUrls,
        });
        
        // Clear the files to upload list after successful upload
        setDocumentFiles([]);
        
        toast({
          title: "Success",
          description: `${filesToUpload.length} document(s) uploaded successfully`,
        });
      }
    } catch (error: any) {
      console.error("Failed to upload documents:", error);
      toast({
        title: "Error",
        description: "Failed to upload documents",
        variant: "destructive",
      });
    } finally {
      setUploadingDocuments(false);
    }
  };

  const uploadMedia = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;

    try {
      setUploadingImages(true);
      
      // Upload media files (images and videos)
      const response = await uploadApi.uploadMedia(filesToUpload);
      
      if (response.success && response.data) {
        // Merge with existing media
        const allImages = [...uploadedMedia.images, ...response.data.images];
        const allVideos = [...uploadedMedia.videos, ...response.data.videos];
        
        setUploadedMedia({ images: allImages, videos: allVideos });
        
        // Save to backend immediately
        await handleSave({
          brandImages: allImages,
          brandAssets: allVideos,
        });
        
        // Clear the files to upload list after successful upload
        setMediaFiles([]);
        
        toast({
          title: "Success",
          description: `${filesToUpload.length} file(s) uploaded successfully`,
        });
      }
    } catch (error: any) {
      console.error("Failed to upload media:", error);
      toast({
        title: "Error",
        description: "Failed to upload media files",
        variant: "destructive",
      });
    } finally {
      setUploadingImages(false);
    }
  };

  const deleteMedia = async (type: 'image' | 'video', index: number) => {
    try {
      let newImages = [...uploadedMedia.images];
      let newVideos = [...uploadedMedia.videos];
      
      if (type === 'image') {
        newImages = newImages.filter((_, i) => i !== index);
      } else {
        newVideos = newVideos.filter((_, i) => i !== index);
      }
      
      setUploadedMedia({ images: newImages, videos: newVideos });
      
      // Save immediately when deleting
      await handleSave({
        brandImages: newImages,
        brandAssets: newVideos,
      });
      
      toast({
        title: "Deleted",
        description: `${type === 'image' ? 'Image' : 'Video'} removed successfully`,
      });
    } catch (error: any) {
      console.error("Failed to delete media:", error);
      toast({
        title: "Error",
        description: `Failed to delete ${type}`,
        variant: "destructive",
      });
    }
  };

  /**
   * Comprehensive save function that saves all changes across all tabs
   */
  // OAuth handlers for platforms (redirect flow)
  const handleGoogleConnect = async () => {
    try {
      const response = await authApi.getGoogleLoginUrl();
      if (!response.success || !response.data.oauth_url) {
        throw new Error('Failed to get Google auth URL');
      }

      // Store return URL for callback redirect
      localStorage.setItem('dvyb_oauth_return_url', '/brand-kit');
      localStorage.setItem('dvyb_oauth_platform', 'google');

      // Redirect to Google OAuth
      console.log('🚀 Redirecting to Google OAuth...');
      window.location.href = response.data.oauth_url;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect Google",
        variant: "destructive",
      });
    }
  };

  const handleTwitterConnect = async () => {
    try {
      const response = await authApi.getTwitterLoginUrl();
      if (!response.success || !response.data.oauth_url) {
        throw new Error('Failed to get Twitter auth URL');
      }

      // Store return URL for callback redirect
      localStorage.setItem('dvyb_oauth_return_url', '/brand-kit');
      localStorage.setItem('dvyb_oauth_platform', 'twitter');

      // Redirect to Twitter OAuth
      console.log('🚀 Redirecting to Twitter OAuth...');
      window.location.href = response.data.oauth_url;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect Twitter",
        variant: "destructive",
      });
    }
  };

  const handleInstagramConnect = async () => {
    try {
      const response = await socialConnectionsApi.getInstagramAuthUrl();
      if (!response.success || !response.data.authUrl) {
        throw new Error('Failed to get Instagram auth URL');
      }

      // Store return URL for callback redirect
      localStorage.setItem('dvyb_oauth_return_url', '/brand-kit');
      localStorage.setItem('dvyb_oauth_platform', 'instagram');

      // Redirect to Instagram OAuth
      console.log('🚀 Redirecting to Instagram OAuth...');
      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect Instagram",
        variant: "destructive",
      });
    }
  };

  const handleLinkedInConnect = async () => {
    try {
      const response = await socialConnectionsApi.getLinkedInAuthUrl();
      if (!response.success || !response.data.authUrl) {
        throw new Error('Failed to get LinkedIn auth URL');
      }

      // Store return URL for callback redirect
      localStorage.setItem('dvyb_oauth_return_url', '/brand-kit');
      localStorage.setItem('dvyb_oauth_platform', 'linkedin');

      // Redirect to LinkedIn OAuth
      console.log('🚀 Redirecting to LinkedIn OAuth...');
      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect LinkedIn",
        variant: "destructive",
      });
    }
  };

  const handleTikTokConnect = async () => {
    try {
      const response = await socialConnectionsApi.getTikTokAuthUrl();
      if (!response.success || !response.data.authUrl) {
        throw new Error('Failed to get TikTok auth URL');
      }

      // Store return URL for callback redirect
      localStorage.setItem('dvyb_oauth_return_url', '/brand-kit');
      localStorage.setItem('dvyb_oauth_platform', 'tiktok');

      // Redirect to TikTok OAuth
      console.log('🚀 Redirecting to TikTok OAuth...');
      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to connect TikTok",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading Brand Kit...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Sticky Header with Tabs and Save Button */}
        <div className="sticky top-0 z-50 bg-background border-b border-border">
          <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-3 md:py-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
              <div className="w-full md:w-auto overflow-x-auto">
                <TabsList className="inline-flex w-max">
                  <TabsTrigger value="source-materials" className="text-xs md:text-sm whitespace-nowrap">Source Materials</TabsTrigger>
                  <TabsTrigger value="images-video" className="text-xs md:text-sm whitespace-nowrap">Images & Video</TabsTrigger>
                  <TabsTrigger value="brand-profile" className="text-xs md:text-sm whitespace-nowrap">Brand Profile</TabsTrigger>
                  <TabsTrigger value="styles-voice" className="text-xs md:text-sm whitespace-nowrap">Styles & Voice</TabsTrigger>
                  <TabsTrigger value="content-preferences" className="text-xs md:text-sm whitespace-nowrap">Content Preferences</TabsTrigger>
                </TabsList>
              </div>
              
              <Button 
                onClick={handleSaveAll}
                disabled={isSaving || !hasUnsavedChanges}
                size="sm"
                className="w-full md:w-auto flex-shrink-0"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 lg:py-8">

          {/* Source Materials Tab */}
          <TabsContent value="source-materials">
            <div className="space-y-6 md:space-y-8">
              {/* Webpages Section */}
              <Card className="p-4 md:p-6">
                <div className="mb-4">
                  <h3 className="text-base md:text-lg font-semibold text-foreground">
                    Webpages <Badge variant="secondary" className="ml-2">{links.length}</Badge>
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">Add webpage URLs for context and inspiration</p>
                </div>
                
                <div className="space-y-2 md:space-y-3">
                  {links.map((link, i) => {
                    const isWebsite = contextData?.website && link.url === contextData.website;
                    
                    return (
                      <div key={i} className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-3 p-3 bg-muted/30 rounded-lg">
                        {/* Icon and Input Row */}
                        <div className="flex items-center gap-3 w-full md:flex-1">
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            {isWebsite && contextData?.logoPresignedUrl ? (
                              <Image
                                src={contextData.logoPresignedUrl}
                                alt="Logo"
                                width={20}
                                height={20}
                                className="rounded md:w-6 md:h-6"
                              />
                            ) : (
                              <Globe className="w-5 h-5 md:w-6 md:h-6 text-muted-foreground" />
                            )}
                          </div>
                          
                          {/* URL Input */}
                          <Input
                            className="flex-1 text-sm"
                            value={link.url || ''}
                            onChange={(e) => {
                              const next = [...links];
                              next[i] = { 
                                ...next[i], 
                                url: e.target.value,
                                timestamp: next[i].timestamp || new Date().toISOString()
                              };
                              setLinks(next);
                              setHasUnsavedChanges(true);
                            }}
                            placeholder="https://yourwebsite.com"
                            disabled={isWebsite} // Website URL is managed in Brand Profile tab
                          />
                        </div>
                        
                        {/* Timestamp and Delete Row */}
                        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
                          {/* Timestamp */}
                          {link.timestamp && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(link.timestamp).toLocaleDateString()}
                            </span>
                          )}
                          
                          {/* Delete Button (only for non-website links) */}
                          {!isWebsite && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setLinks(links.filter((_, idx) => idx !== i));
                                setHasUnsavedChanges(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      setLinks([...links, { url: '', timestamp: new Date().toISOString() }]);
                      setHasUnsavedChanges(true);
                    }}
                    className="text-primary gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add More
                  </Button>
                </div>
              </Card>

              {/* Integrations Section */}
              <Card className="p-4 md:p-6">
                <div className="mb-4">
                  <h3 className="text-base md:text-lg font-semibold text-foreground">
                    Integrations{" "}
                    <Badge variant="secondary" className="ml-2">
                      {Object.values(connections).filter(status => status === 'connected').length}
                    </Badge>
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">Connected social media accounts</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  {/* Google Connection */}
                  <div className={`p-4 rounded-lg border ${
                    connections.google === 'connected' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                      : connections.google === 'expired'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-muted/30 border-border'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center">
                          <GoogleIcon className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Google</p>
                          <p className="text-xs text-muted-foreground">
                            {connections.google === 'connected' ? 'Connected' : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {connections.google === 'connected' ? (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={async () => {
                            try {
                              await socialConnectionsApi.disconnectGoogle?.();
                              toast({ title: "Disconnected", description: "Google disconnected. Logging out..." });
                              
                              // Since Google is primary auth, log out the user
                              await logout();
                              
                              // Redirect to landing page
                              router.push('/');
                            } catch (error: any) {
                              toast({ 
                                title: "Error", 
                                description: error.message || "Failed to disconnect Google",
                                variant: "destructive"
                              });
                            }
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : connections.google === 'expired' ? (
                        <Button variant="default" size="sm" onClick={handleGoogleConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={handleGoogleConnect}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Twitter Connection */}
                  <div className={`p-4 rounded-lg border ${
                    connections.twitter === 'connected' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                      : connections.twitter === 'expired'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-muted/30 border-border'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
                          <Twitter className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Twitter</p>
                          <p className="text-xs text-muted-foreground">
                            {connections.twitter === 'connected' ? 'Connected' : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {connections.twitter === 'connected' ? (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={async () => {
                            await socialConnectionsApi.disconnectTwitter?.();
                            fetchConnections();
                            toast({ title: "Disconnected", description: "Twitter disconnected successfully" });
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : connections.twitter === 'expired' ? (
                        <Button variant="default" size="sm" onClick={handleTwitterConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={handleTwitterConnect}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Instagram Connection */}
                  <div className={`p-4 rounded-lg border ${
                    connections.instagram === 'connected' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                      : connections.instagram === 'expired'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-muted/30 border-border'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500 flex items-center justify-center">
                          <InstagramIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Instagram</p>
                          <p className="text-xs text-muted-foreground">
                            {connections.instagram === 'connected' ? 'Connected' : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {connections.instagram === 'connected' ? (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={async () => {
                            await socialConnectionsApi.disconnectInstagram();
                            fetchConnections();
                            toast({ title: "Disconnected", description: "Instagram disconnected successfully" });
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : connections.instagram === 'expired' ? (
                        <Button variant="default" size="sm" onClick={handleInstagramConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={handleInstagramConnect}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* LinkedIn Connection */}
                  <div className={`p-4 rounded-lg border ${
                    connections.linkedin === 'connected' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                      : connections.linkedin === 'expired'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-muted/30 border-border'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                          <Linkedin className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">LinkedIn</p>
                          <p className="text-xs text-muted-foreground">
                            {connections.linkedin === 'connected' ? 'Connected' : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {connections.linkedin === 'connected' ? (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={async () => {
                            await socialConnectionsApi.disconnectLinkedIn();
                            fetchConnections();
                            toast({ title: "Disconnected", description: "LinkedIn disconnected successfully" });
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : connections.linkedin === 'expired' ? (
                        <Button variant="default" size="sm" onClick={handleLinkedInConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={handleLinkedInConnect}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* TikTok Connection */}
                  <div className={`p-4 rounded-lg border ${
                    connections.tiktok === 'connected' 
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' 
                      : connections.tiktok === 'expired'
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                      : 'bg-muted/30 border-border'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center">
                          <TikTokIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">TikTok</p>
                          <p className="text-xs text-muted-foreground">
                            {connections.tiktok === 'connected' ? 'Connected' : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {connections.tiktok === 'connected' ? (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={async () => {
                            await socialConnectionsApi.disconnectTikTok();
                            fetchConnections();
                            toast({ title: "Disconnected", description: "TikTok disconnected successfully" });
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : connections.tiktok === 'expired' ? (
                        <Button variant="default" size="sm" onClick={handleTikTokConnect}>
                          Reconnect
                        </Button>
                      ) : (
                        <Button variant="default" size="sm" onClick={handleTikTokConnect}>
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Files Section */}
              <Card className="p-4 md:p-6">
                <div className="mb-4">
                  <h3 className="text-base md:text-lg font-semibold text-foreground">
                    Files <Badge variant="secondary" className="ml-2">{uploadedDocuments.length}</Badge>
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground mt-1">Upload PDF or DOCX files. Text will be automatically extracted.</p>
                </div>
                
                {/* Drag and Drop Area */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files).filter(f =>
                      f.type === 'application/pdf' ||
                      f.type === 'application/msword' ||
                      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                      f.name.toLowerCase().endsWith('.pdf') ||
                      f.name.toLowerCase().endsWith('.docx') ||
                      f.name.toLowerCase().endsWith('.doc')
                    );
                    if (files.length > 0) {
                      setDocumentFiles(prev => [...prev, ...files]);
                    }
                  }}
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <CloudUpload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-foreground mb-2">Drag & drop PDF or DOCX files here, or click to choose</p>
                  <p className="text-xs text-muted-foreground mb-3">Supported: PDF, DOCX</p>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc"
                    multiple
                    id="docUpload"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length > 0) {
                        setDocumentFiles(prev => [...prev, ...files]);
                      }
                    }}
                  />
                  <label htmlFor="docUpload">
                    <Button variant="outline" asChild>
                      <span>Choose Files</span>
                    </Button>
                  </label>
                </div>

                {/* Files to Upload */}
                {documentFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-sm font-medium text-foreground">Files to Upload ({documentFiles.length})</h4>
                    {documentFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-2">
                        <span className="text-sm text-foreground truncate flex-1 mr-3">{file.name}</span>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDocumentFiles(documentFiles.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={async () => {
                              await uploadDocuments([file]);
                              setDocumentFiles(documentFiles.filter((_, i) => i !== idx));
                            }}
                            disabled={uploadingDocuments}
                          >
                            Upload
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      onClick={async () => {
                        await uploadDocuments(documentFiles);
                        setDocumentFiles([]);
                      }}
                      disabled={uploadingDocuments}
                      className="w-full"
                    >
                      {uploadingDocuments ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        `Upload All (${documentFiles.length})`
                      )}
                    </Button>
                  </div>
                )}

                {/* Uploaded Documents */}
                {uploadedDocuments.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium text-foreground mb-3">Uploaded Documents ({uploadedDocuments.length})</h4>
                    <div className="space-y-2">
                      {uploadedDocuments.map((doc, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-2">
                          <div className="flex-1">
                            <span className="text-sm font-medium text-foreground">{doc.name}</span>
                            {doc.timestamp && (
                              <span className="text-xs text-muted-foreground ml-2">
                                ({new Date(doc.timestamp).toLocaleDateString()})
                              </span>
                            )}
                            {doc.text && (
                              <span className="text-xs text-green-600 ml-2">✓ Text extracted</span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const newDocs = uploadedDocuments.filter((_, i) => i !== idx);
                              setUploadedDocuments(newDocs);
                              
                              // Save immediately when deleting
                              const newUrls = newDocs.map(d => d.url).filter(url => url);
                              await handleSave({
                                documentsText: newDocs,
                                documentUrls: newUrls,
                              });
                              
                              toast({
                                title: "Deleted",
                                description: "Document removed successfully",
                              });
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Images & Video Tab */}
          <TabsContent value="images-video">
            <div className="space-y-6 md:space-y-8">
              {/* Upload Area */}
              <Card className="p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">Upload Media</h3>
                
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 md:p-8 text-center cursor-pointer hover:border-primary transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files).filter(file => 
                      file.type.match(/^(image\/(jpeg|jpg|png|webp)|video\/mp4)$/)
                    );
                    if (files.length > 0) {
                      setMediaFiles([...mediaFiles, ...files]);
                      setHasUnsavedChanges(true);
                    }
                  }}
                  onClick={() => document.getElementById('media-upload-input')?.click()}
                >
                  <CloudUpload className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 md:mb-3 text-muted-foreground" />
                  <p className="text-xs md:text-sm text-foreground mb-1">Drag & drop images and videos here, or click to choose</p>
                  <p className="text-xs text-muted-foreground">Supported: JPG, JPEG, PNG, WEBP, MP4</p>
                </div>
                
                <input
                  type="file"
                  id="media-upload-input"
                  className="hidden"
                  accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) {
                      setMediaFiles([...mediaFiles, ...files]);
                      setHasUnsavedChanges(true);
                    }
                  }}
                />

                {/* Files to Upload */}
                {mediaFiles.length > 0 && (
                  <div className="mt-3 md:mt-4">
                    <h4 className="text-xs md:text-sm font-medium text-foreground mb-2">Files to Upload ({mediaFiles.length})</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-3 mb-3">
                      {mediaFiles.map((file, idx) => (
                        <div key={idx} className="relative aspect-square bg-muted rounded-lg overflow-hidden">
                          <div className="absolute inset-0 flex items-center justify-center">
                            {file.type.startsWith('image/') ? (
                              <img 
                                src={URL.createObjectURL(file)} 
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="text-center">
                                <Play className="w-8 h-8 mx-auto text-muted-foreground" />
                                <p className="text-xs text-muted-foreground mt-1">Video</p>
                              </div>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMediaFiles(mediaFiles.filter((_, i) => i !== idx));
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={() => uploadMedia(mediaFiles)}
                      disabled={uploadingImages}
                      className="w-full"
                    >
                      {uploadingImages ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        `Upload All (${mediaFiles.length})`
                      )}
                    </Button>
                  </div>
                )}
              </Card>

              {/* Uploaded Images */}
              <Card className="p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Brand Images <Badge variant="secondary" className="ml-2">{uploadedMedia.images.length}</Badge>
                </h3>
                
                {uploadedMedia.images.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-3">
                    {uploadedMedia.images.map((item, idx) => (
                      <div key={idx} className="relative aspect-square bg-muted rounded-lg overflow-hidden group">
                        <img
                          src={item.presignedUrl}
                          alt={`Brand image ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-white hover:bg-white/20"
                            onClick={() => deleteMedia('image', idx)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        {item.timestamp && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 text-center">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
                    <div className="text-center">
                      <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No images uploaded yet</p>
                    </div>
                  </div>
                )}
              </Card>

              {/* Uploaded Videos */}
              <Card className="p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Brand Videos <Badge variant="secondary" className="ml-2">{uploadedMedia.videos.length}</Badge>
                </h3>
                
                {uploadedMedia.videos.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                    {uploadedMedia.videos.map((item, idx) => (
                      <div key={idx} className="relative bg-muted rounded-lg overflow-hidden group">
                        <video
                          src={item.presignedUrl}
                          controls
                          className="w-full"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white"
                          onClick={() => deleteMedia('video', idx)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        {item.timestamp && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-2">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
                    <div className="text-center">
                      <Play className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No videos uploaded yet</p>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Brand Profile Tab */}
          <TabsContent value="brand-profile">
            <div className="space-y-6 md:space-y-8">
              {/* Business Overview & Positioning */}
              <Card className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg md:text-xl font-semibold text-foreground">Business Overview & Positioning</h3>
                  {editingSection !== 'business-overview' && (
                    <Button 
                      variant="link" 
                      className="gap-2"
                      onClick={() => handleEdit('business-overview', {
                        businessOverview: contextData?.businessOverview || '',
                        competitors: contextData?.competitors || '',
                        whyCustomersChoose: contextData?.whyCustomersChoose || ''
                      })}
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </Button>
                  )}
                </div>
                <div className="space-y-4 md:space-y-6">
                  <div>
                    <h4 className="text-sm md:text-base font-semibold text-foreground mb-2">Business Overview:</h4>
                    {editingSection === 'business-overview' ? (
                      <RichTextEditor
                        content={editData.businessOverview || ''}
                        onSave={(content: string) => handleSave({ businessOverview: content, competitors: editData.competitors, whyCustomersChoose: editData.whyCustomersChoose })}
                        onCancel={handleCancelEdit}
                        isSaving={isSaving}
                      />
                    ) : (
                      contextData?.businessOverview ? (
                        <FormattedText text={contextData.businessOverview} />
                      ) : (
                        <p className="text-muted-foreground text-sm">No business overview added yet. Click Edit to add your business identity.</p>
                      )
                    )}
                  </div>

                  {contextData?.whyCustomersChoose && editingSection !== 'business-overview' && (
                    <div>
                      <h4 className="text-sm md:text-base font-semibold text-foreground mb-2">Why Customers Choose {contextData.accountName || 'Us'}:</h4>
                      <FormattedText text={contextData.whyCustomersChoose} />
                    </div>
                  )}

                  {contextData?.competitors && editingSection !== 'business-overview' && (
                    <div>
                      <h4 className="text-sm md:text-base font-semibold text-foreground mb-2">Direct Competitors</h4>
                      <FormattedText text={contextData.competitors} />
                    </div>
                  )}
                </div>
              </Card>

              {/* Customer Demographics */}
              {contextData?.customerDemographics && (
                <Card className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg md:text-xl font-semibold text-foreground">Customer Demographics & Psychographics</h3>
                    {editingSection !== 'customer-demographics' && (
                      <Button 
                        variant="link" 
                        className="gap-2"
                        onClick={() => handleEdit('customer-demographics', {
                          customerDemographics: contextData?.customerDemographics || ''
                        })}
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </Button>
                    )}
                  </div>
                  <div>
                    {editingSection === 'customer-demographics' ? (
                      <RichTextEditor
                        content={editData.customerDemographics || ''}
                        onSave={(content: string) => handleSave({ customerDemographics: content })}
                        onCancel={handleCancelEdit}
                        isSaving={isSaving}
                      />
                    ) : (
                      <FormattedText text={contextData.customerDemographics} />
                    )}
                  </div>
                </Card>
              )}

              {/* Popular Products */}
              {contextData?.popularProducts && (
                <Card className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg md:text-xl font-semibold text-foreground">Most Popular Products & Services</h3>
                  </div>
                  {Array.isArray(contextData.popularProducts) && contextData.popularProducts.length > 0 ? (
                    <FormattedText text={contextData.popularProducts.join("\n")} />
                  ) : typeof contextData.popularProducts === 'string' ? (
                    <FormattedText text={contextData.popularProducts} />
                  ) : (
                    <p className="text-muted-foreground text-sm">No products or services data available.</p>
                  )}
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Styles & Voice Tab */}
          <TabsContent value="styles-voice">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              {/* Brand Styles */}
              <Card className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                  <h3 className="text-lg md:text-xl font-semibold text-foreground">Brand Styles</h3>
                  {editingSection !== 'brand-styles' && (
                    <Button
                      variant="link"
                      className="gap-2"
                      onClick={() => handleEdit('brand-styles', {
                        brandStyles: {
                          visual_identity_description: brandStyles.visual_identity_description,
                          visual_identity_keywords: brandStyles.visual_identity_keywords
                        }
                      })}
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </Button>
                  )}
                </div>

                <div className="space-y-6">
                  {editingSection === 'brand-styles' ? (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">Visual Identity Description</h4>
                        <ChipInput
                          value={editData.brandStyles?.visual_identity_description || []}
                          onChange={(chips) => setEditData({
                            ...editData,
                            brandStyles: {
                              ...editData.brandStyles,
                              visual_identity_description: chips
                            }
                          })}
                          placeholder="Type and press Tab or Enter to add..."
                        />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">Visual Identity Keywords</h4>
                        <ChipInput
                          value={editData.brandStyles?.visual_identity_keywords || []}
                          onChange={(chips) => setEditData({
                            ...editData,
                            brandStyles: {
                              ...editData.brandStyles,
                              visual_identity_keywords: chips
                            }
                          })}
                          placeholder="Type and press Tab or Enter to add keywords..."
                        />
                      </div>
                      <div className="flex gap-2 justify-end pt-2">
                        <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                          <X className="w-3 h-3 mr-1" />Cancel
                        </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={async () => {
                          // Ensure both keys are always included, even if one is empty
                          const updatedBrandStyles = {
                            visual_identity_description: editData.brandStyles?.visual_identity_description || [],
                            visual_identity_keywords: editData.brandStyles?.visual_identity_keywords || [],
                          };
                          
                          console.log('💾 Saving brandStyles:', updatedBrandStyles);
                          
                          setBrandStyles(updatedBrandStyles);
                          
                          // Save immediately to database
                          await handleSave({ brandStyles: updatedBrandStyles });
                          
                          setEditingSection(null);
                        }}
                        disabled={isSaving}
                      >
                        <Save className="w-3 h-3 mr-1" />Save
                      </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {brandStyles.visual_identity_description.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-foreground mb-2">Visual Identity Description</h4>
                          <p className="text-sm text-muted-foreground">
                            {brandStyles.visual_identity_description.join(', ')}
                          </p>
                        </div>
                      )}
                      {brandStyles.visual_identity_keywords.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-foreground mb-2">Visual Identity Keywords</h4>
                          <div className="flex flex-wrap gap-2">
                            {brandStyles.visual_identity_keywords.map((keyword, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{keyword}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {brandStyles.visual_identity_description.length === 0 && brandStyles.visual_identity_keywords.length === 0 && (
                        <p className="text-sm text-muted-foreground">No brand styles defined yet. Click Edit to add.</p>
                      )}
                    </div>
                  )}

                  {/* Primary Logo */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-3">Primary Logo</h4>
                    <LogoDropzone
                      logoUrl={contextData?.logoPresignedUrl}
                      onUpload={handleLogoUpload}
                      uploading={uploadingLogo}
                    />
                  </div>

                  {/* Additional Logos */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-3">Additional Logos</h4>
                    <AdditionalLogosDropzone
                      logos={additionalLogos}
                      onUpload={handleAdditionalLogosUpload}
                      onDelete={deleteAdditionalLogo}
                      uploading={uploadingAdditionalLogos}
                    />
                  </div>

                  {/* Colors */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-foreground">Colors</h4>
                      {editingSection !== 'colors' ? (
                        <Button 
                          variant="link" 
                          className="text-xs gap-1"
                          onClick={() => {
                            const palette = contextData?.colorPalette || { primary: '#220808', secondary: '#f97316', accent: '#368405' };
                            handleEdit('colors', { colorPalette: palette });
                          }}
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                            <X className="w-3 h-3 mr-1" />Cancel
                          </Button>
                          <Button 
                            variant="default" 
                            size="sm"
                            onClick={async () => {
                              // Save immediately to database
                              await handleSave({ colorPalette: editData.colorPalette });
                              setEditingSection(null);
                            }}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingSection === 'colors' ? (
                      <div className="space-y-3">
                        {['primary', 'secondary', 'accent'].map((colorType) => (
                          <div key={colorType} className="flex items-center gap-3">
                            <label className="text-sm font-medium capitalize w-24">{colorType}:</label>
                            <input
                              type="color"
                              value={editData.colorPalette?.[colorType] || '#000000'}
                              onChange={(e) => setEditData({
                                ...editData,
                                colorPalette: { ...editData.colorPalette, [colorType]: e.target.value }
                              })}
                              className="w-16 h-10 rounded border-2 border-border cursor-pointer"
                            />
                            <span className="text-xs text-muted-foreground">
                              {editData.colorPalette?.[colorType] || '#000000'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        {contextData?.colorPalette ? (
                          <div className="flex flex-wrap gap-3">
                            {Object.entries(contextData.colorPalette)
                              .filter(([key, value]) => {
                                // Only show colors that have valid hex values
                                if (!value || typeof value !== 'string') return false;
                                const hex = value.toLowerCase().trim();
                                // Filter out white, empty, and invalid colors
                                if (hex === '#ffffff' || hex === '#fff' || hex === 'white' || hex === '') return false;
                                // Filter out very light colors (optional)
                                return hex.startsWith('#');
                              })
                              .map(([key, value]) => (
                                <div key={key}>
                                  <div
                                    className="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-border mb-1"
                                    style={{ backgroundColor: value as string }}
                                  />
                                  <p className="text-xs text-center truncate max-w-[2.5rem] md:max-w-[3rem]">{value as string}</p>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No colors defined yet</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Fonts */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-foreground">Fonts</h4>
                      {editingSection !== 'fonts' ? (
                        <Button 
                          variant="link" 
                          className="text-xs gap-1"
                          onClick={() => {
                            const fonts = contextData?.brandFonts || { title: 'Inter', body: 'Inter' };
                            handleEdit('fonts', { brandFonts: fonts });
                          }}
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                            <X className="w-3 h-3 mr-1" />Cancel
                          </Button>
                          <Button 
                            variant="default" 
                            size="sm"
                            onClick={async () => {
                              // Save immediately to database
                              await handleSave({ brandFonts: editData.brandFonts });
                              setEditingSection(null);
                            }}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingSection === 'fonts' ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium mb-2 block">Title Font:</label>
                          <Select
                            value={editData.brandFonts?.title || 'Inter'}
                            onValueChange={(value) => setEditData({
                              ...editData,
                              brandFonts: { ...editData.brandFonts, title: value }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Inter">Inter</SelectItem>
                              <SelectItem value="Roboto">Roboto</SelectItem>
                              <SelectItem value="Poppins">Poppins</SelectItem>
                              <SelectItem value="Montserrat">Montserrat</SelectItem>
                              <SelectItem value="Open Sans">Open Sans</SelectItem>
                              <SelectItem value="Lato">Lato</SelectItem>
                              <SelectItem value="Playfair Display">Playfair Display</SelectItem>
                              <SelectItem value="Merriweather">Merriweather</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-2 block">Body Font:</label>
                          <Select
                            value={editData.brandFonts?.body || 'Inter'}
                            onValueChange={(value) => setEditData({
                              ...editData,
                              brandFonts: { ...editData.brandFonts, body: value }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Inter">Inter</SelectItem>
                              <SelectItem value="Roboto">Roboto</SelectItem>
                              <SelectItem value="Poppins">Poppins</SelectItem>
                              <SelectItem value="Montserrat">Montserrat</SelectItem>
                              <SelectItem value="Open Sans">Open Sans</SelectItem>
                              <SelectItem value="Lato">Lato</SelectItem>
                              <SelectItem value="Playfair Display">Playfair Display</SelectItem>
                              <SelectItem value="Merriweather">Merriweather</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : (
                      <>
                        {contextData?.brandFonts ? (
                          <div className="space-y-2 text-sm">
                            {contextData.brandFonts.title && (
                              <div>
                                <span className="text-muted-foreground">Title: </span>
                                <span className="font-medium">{contextData.brandFonts.title}</span>
                              </div>
                            )}
                            {contextData.brandFonts.body && (
                              <div>
                                <span className="text-muted-foreground">Body: </span>
                                <span className="font-medium">{contextData.brandFonts.body}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No fonts configured yet</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>

              {/* Brand Voice */}
              <Card className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                  <h3 className="text-lg md:text-xl font-semibold text-foreground">Brand Voice</h3>
                  {editingSection !== 'brand-voices' && (
                    <Button
                      variant="link"
                      className="gap-2"
                      onClick={() => handleEdit('brand-voices', {
                        brandVoices: brandVoices
                      })}
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </Button>
                  )}
                </div>

                {editingSection === 'brand-voices' ? (
                  <div className="space-y-4 max-h-[600px] overflow-y-auto">
                    {/* Purpose - Textarea */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Purpose</h4>
                      <textarea
                        className="w-full min-h-[80px] p-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        value={editData.brandVoices?.purpose || ''}
                        onChange={(e) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            purpose: e.target.value
                          }
                        })}
                        placeholder="Describe your brand's purpose..."
                      />
                    </div>

                    {/* Audience - Textarea */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Audience</h4>
                      <textarea
                        className="w-full min-h-[80px] p-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        value={editData.brandVoices?.audience || ''}
                        onChange={(e) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            audience: e.target.value
                          }
                        })}
                        placeholder="Describe your target audience..."
                      />
                    </div>

                    {/* Tone - Chips */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Tone</h4>
                      <ChipInput
                        value={editData.brandVoices?.tone || []}
                        onChange={(chips) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            tone: chips
                          }
                        })}
                        placeholder="Type and press Tab or Enter to add tone..."
                      />
                    </div>

                    {/* Emotions - Chips */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Emotions</h4>
                      <ChipInput
                        value={editData.brandVoices?.emotions || []}
                        onChange={(chips) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            emotions: chips
                          }
                        })}
                        placeholder="Type and press Tab or Enter to add emotions..."
                      />
                    </div>

                    {/* Character - Chips */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Character</h4>
                      <ChipInput
                        value={editData.brandVoices?.character || []}
                        onChange={(chips) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            character: chips
                          }
                        })}
                        placeholder="Type and press Tab or Enter to add character..."
                      />
                    </div>

                    {/* Syntax - Chips */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Syntax</h4>
                      <ChipInput
                        value={editData.brandVoices?.syntax || []}
                        onChange={(chips) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            syntax: chips
                          }
                        })}
                        placeholder="Type and press Tab or Enter to add syntax..."
                      />
                    </div>

                    {/* Language - Textarea */}
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-2">Language</h4>
                      <textarea
                        className="w-full min-h-[80px] p-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        value={editData.brandVoices?.language || ''}
                        onChange={(e) => setEditData({
                          ...editData,
                          brandVoices: {
                            ...editData.brandVoices,
                            language: e.target.value
                          }
                        })}
                        placeholder="Describe language preferences..."
                      />
                    </div>

                    <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-background">
                      <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isSaving}>
                        <X className="w-3 h-3 mr-1" />Cancel
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={async () => {
                          // Ensure all keys are always included
                          const updatedBrandVoices = {
                            purpose: editData.brandVoices?.purpose || '',
                            audience: editData.brandVoices?.audience || '',
                            tone: editData.brandVoices?.tone || [],
                            emotions: editData.brandVoices?.emotions || [],
                            character: editData.brandVoices?.character || [],
                            syntax: editData.brandVoices?.syntax || [],
                            language: editData.brandVoices?.language || '',
                          };
                          
                          console.log('💾 Saving brandVoices:', updatedBrandVoices);
                          
                          setBrandVoices(updatedBrandVoices);
                          
                          // Save immediately to database
                          await handleSave({ brandVoices: updatedBrandVoices });
                          
                          setEditingSection(null);
                        }}
                        disabled={isSaving}
                      >
                        <Save className="w-3 h-3 mr-1" />Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 max-h-[600px] overflow-y-auto">
                    {/* Purpose */}
                    {brandVoices.purpose && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Purpose</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{brandVoices.purpose}</p>
                      </div>
                    )}

                    {/* Audience */}
                    {brandVoices.audience && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Audience</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{brandVoices.audience}</p>
                      </div>
                    )}

                    {/* Tone */}
                    {brandVoices.tone.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Tone</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {brandVoices.tone.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Emotions */}
                    {brandVoices.emotions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Emotions</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {brandVoices.emotions.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Character */}
                    {brandVoices.character.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Character</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {brandVoices.character.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Syntax */}
                    {brandVoices.syntax.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Syntax</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {brandVoices.syntax.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Language */}
                    {brandVoices.language && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-foreground">Language</h4>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{brandVoices.language}</p>
                      </div>
                    )}

                    {!brandVoices.purpose && !brandVoices.audience && brandVoices.tone.length === 0 && 
                     brandVoices.emotions.length === 0 && brandVoices.character.length === 0 && 
                     brandVoices.syntax.length === 0 && !brandVoices.language && (
                      <p className="text-sm text-muted-foreground">No brand voice defined yet. Click Edit to add.</p>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Content Preferences Tab */}
          <TabsContent value="content-preferences">
            <div className="space-y-6 md:space-y-8">
              {/* Design Preferences */}
              <Card className="p-4 md:p-6">
                <h3 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Design Preferences</h3>

                <div className="space-y-4 md:space-y-6">
                  {/* Featured Media */}
                  <div>
                    <h4 className="text-xs md:text-sm font-medium text-foreground mb-2">Featured Media</h4>
                    <p className="text-xs text-muted-foreground mb-3">Select the type of media you prefer to spotlight in your social posts.</p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          id="text" 
                          checked={contentPreferences.featuredMedia.text}
                          onCheckedChange={(checked) => setContentPreferences({
                            ...contentPreferences,
                            featuredMedia: { ...contentPreferences.featuredMedia, text: !!checked }
                          })}
                        />
                        <label htmlFor="text" className="text-xs md:text-sm cursor-pointer">Text</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          id="image" 
                          checked={contentPreferences.featuredMedia.image}
                          onCheckedChange={(checked) => setContentPreferences({
                            ...contentPreferences,
                            featuredMedia: { ...contentPreferences.featuredMedia, image: !!checked }
                          })}
                        />
                        <label htmlFor="image" className="text-xs md:text-sm cursor-pointer">Image</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          id="video" 
                          checked={contentPreferences.featuredMedia.video}
                          onCheckedChange={(checked) => setContentPreferences({
                            ...contentPreferences,
                            featuredMedia: { ...contentPreferences.featuredMedia, video: !!checked }
                          })}
                        />
                        <label htmlFor="video" className="text-xs md:text-sm cursor-pointer">Video</label>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">By default, we generate a mix of social posts featuring text-only, an image, or a video.</p>
                    </div>
                  </div>

                  {/* Brand Kit Media Priority */}
                  <div>
                    <h4 className="text-xs md:text-sm font-medium text-foreground mb-2">Brand Kit Media Priority</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set your preferred priority for using your Brand Kit media versus stock media (images, videos) in content.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant={contentPreferences.brandKitMediaPriority === 'only_brand_kit' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaPriority: 'only_brand_kit' })}
                      >
                        Only my Brand Kit
                      </Button>
                      <Button 
                        variant={contentPreferences.brandKitMediaPriority === 'brand_kit_first' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaPriority: 'brand_kit_first' })}
                      >
                        Brand Kit first
                      </Button>
                      <Button 
                        variant={contentPreferences.brandKitMediaPriority === 'only_stock' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaPriority: 'only_stock' })}
                      >
                        Only stock
                      </Button>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">We pick the most relevant images/videos for your content and only use each Brand Kit media once per batch. We'll send you email reminders to upload more media when running low. When uploading new media, please wait 1-2 minutes before regenerating content.</p>
                    </div>
                  </div>

                  {/* Reusing Brand Kit Media */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Reusing Brand Kit Media</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      When generating content, Dvyb will search for relevant images and video in your Brand Kit. Brand kit media will be re-used when no other media are available. 
                      You currently have {uploadedMedia.images.length} images, {uploadedMedia.videos.length} videos available.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button 
                        variant={contentPreferences.brandKitMediaReuse === 'never_reuse' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaReuse: 'never_reuse' })}
                      >
                        Never re-use
                      </Button>
                      <Button 
                        variant={contentPreferences.brandKitMediaReuse === 'reuse_after_3_weeks' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setContentPreferences({ ...contentPreferences, brandKitMediaReuse: 'reuse_after_3_weeks' })}
                      >
                        Re-use after 3 weeks
                      </Button>
                    </div>
                  </div>

                  {/* Always include images on blog posts */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Checkbox 
                        id="blog-images" 
                        checked={contentPreferences.alwaysIncludeBlogImages}
                        onCheckedChange={(checked) => setContentPreferences({
                          ...contentPreferences,
                          alwaysIncludeBlogImages: !!checked
                        })}
                      />
                      <label htmlFor="blog-images" className="text-sm font-medium cursor-pointer">Always include images on blog posts</label>
                    </div>
                  </div>
                </div>

                {/* Save Button for Design Preferences */}
                <div className="flex justify-end mt-6">
                  <Button 
                    onClick={() => saveContentPreferences('design')}
                    disabled={isSaving}
                    size="sm"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Preferences
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              {/* Content Preferences */}
              <Card className="p-4 md:p-6">
                <h3 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Content Preferences</h3>

                <div className="space-y-4 md:space-y-6">
                  {/* Content Language */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Content Language</h4>
                    <p className="text-xs text-muted-foreground mb-3">Select the language for your content.</p>
                    <Select 
                      value={contentPreferences.contentLanguage}
                      onValueChange={(value) => setContentPreferences({ ...contentPreferences, contentLanguage: value })}
                    >
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-us">English (US)</SelectItem>
                        <SelectItem value="en-gb">English (UK)</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                        <SelectItem value="de">German</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Topics to Avoid */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Topics to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude these topics from your Brand Plan when generating content.</p>
                    <ChipInput
                      value={contentPreferences.topicsToAvoid}
                      onChange={(chips) => setContentPreferences({ ...contentPreferences, topicsToAvoid: chips })}
                      placeholder="Type topic and press Tab or Enter to add..."
                    />
                  </div>

                  {/* Words and Phrases to Avoid */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Words and Phrases to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll avoid using any of these words or phrases in your content.</p>
                    <ChipInput
                      value={contentPreferences.wordsToAvoid}
                      onChange={(chips) => setContentPreferences({ ...contentPreferences, wordsToAvoid: chips })}
                      placeholder="Type word/phrase and press Tab or Enter to add..."
                    />
                  </div>

                  {/* Blog Keywords */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Blog Keywords</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll use these target keywords when generating content for SEO.</p>
                    <ChipInput
                      value={contentPreferences.blogKeywords}
                      onChange={(chips) => setContentPreferences({ ...contentPreferences, blogKeywords: chips })}
                      placeholder="Type keyword and press Tab or Enter to add..."
                    />
                  </div>

                  {/* Blog External Links */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Blog External Links</h4>
                    <p className="text-xs text-muted-foreground mb-3">External links improve your blog content's ranking on search engines by referencing sources with higher authority.</p>
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="external-links" 
                        checked={contentPreferences.alwaysIncludeExternalLinks}
                        onCheckedChange={(checked) => setContentPreferences({
                          ...contentPreferences,
                          alwaysIncludeExternalLinks: !!checked
                        })}
                      />
                      <label htmlFor="external-links" className="text-sm cursor-pointer">Always include external links on blog posts</label>
                    </div>
                  </div>

                  {/* External URLs to Avoid */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">External URLs to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude these domains when generating content.</p>
                    <ChipInput
                      value={contentPreferences.externalUrlsToAvoid}
                      onChange={(chips) => setContentPreferences({ ...contentPreferences, externalUrlsToAvoid: chips })}
                      placeholder="Type domain and press Tab or Enter to add..."
                    />
                  </div>

                  {/* Hashtags */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Hashtags</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude or include these hashtags when generating content.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Avoid</p>
                        <ChipInput
                          value={contentPreferences.hashtags.avoid}
                          onChange={(chips) => setContentPreferences({
                            ...contentPreferences,
                            hashtags: { ...contentPreferences.hashtags, avoid: chips }
                          })}
                          placeholder="Type hashtag and press Tab..."
                        />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Include</p>
                        <ChipInput
                          value={contentPreferences.hashtags.include}
                          onChange={(chips) => setContentPreferences({
                            ...contentPreferences,
                            hashtags: { ...contentPreferences.hashtags, include: chips }
                          })}
                          placeholder="Type hashtag and press Tab..."
                        />
                      </div>
                    </div>

                    {/* Hashtag Frequency */}
                    <div className="mt-4">
                      <p className="text-xs font-medium text-foreground mb-2">Hashtag Frequency</p>
                      <div className="flex flex-wrap gap-2">
                        <Button 
                          variant={contentPreferences.hashtagFrequency === 'never' ? 'default' : 'outline'}
                          size="sm" 
                          className="text-xs"
                          onClick={() => setContentPreferences({ ...contentPreferences, hashtagFrequency: 'never' })}
                        >
                          Never
                        </Button>
                        <Button 
                          variant={contentPreferences.hashtagFrequency === 'sometimes' ? 'default' : 'outline'}
                          size="sm" 
                          className="text-xs"
                          onClick={() => setContentPreferences({ ...contentPreferences, hashtagFrequency: 'sometimes' })}
                        >
                          Sometimes
                        </Button>
                        <Button 
                          variant={contentPreferences.hashtagFrequency === 'always' ? 'default' : 'outline'}
                          size="sm" 
                          className="text-xs"
                          onClick={() => setContentPreferences({ ...contentPreferences, hashtagFrequency: 'always' })}
                        >
                          Always
                        </Button>
                      </div>
                      <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                        <p className="text-xs text-foreground">Tip: Hashtags can support trends or organize content, but most platforms now prioritize keywords, engagement, and relevance over hashtags for reach.</p>
                      </div>
                    </div>
                  </div>

                  {/* Logo Frequency */}
                  <div>
                    <h4 className="text-xs md:text-sm font-medium text-foreground mb-2">Logo Frequency</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set how often you'd like to include a logo in your social posts.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant={contentPreferences.logoFrequency === 'never' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, logoFrequency: 'never' })}
                      >
                        Never
                      </Button>
                      <Button 
                        variant={contentPreferences.logoFrequency === 'sometimes' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, logoFrequency: 'sometimes' })}
                      >
                        Sometimes
                      </Button>
                      <Button 
                        variant={contentPreferences.logoFrequency === 'always' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, logoFrequency: 'always' })}
                      >
                        Always
                      </Button>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">
                        {contentPreferences.logoFrequency === 'never' && 'Logo will not be included in posts.'}
                        {contentPreferences.logoFrequency === 'sometimes' && 'Include a logo in some posts. (Approximately 3-5 in every 10 posts)'}
                        {contentPreferences.logoFrequency === 'always' && 'Logo will be included in every post.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Save Button for Content Preferences */}
                <div className="flex justify-end mt-6">
                  <Button 
                    onClick={() => saveContentPreferences('content')}
                    disabled={isSaving}
                    size="sm"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Preferences
                      </>
                    )}
                  </Button>
                </div>
              </Card>

              {/* Call-to-Action Preferences */}
              <Card className="p-4 md:p-6">
                <h3 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Call-to-Action Preferences</h3>

                <div className="space-y-4 md:space-y-6">
                  {/* CTA Links */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Link</h4>
                    <p className="text-xs text-muted-foreground mb-3">Add the website URL you want Dvyb to drive traffic to across all content types.</p>
                    <ChipInput
                      value={contentPreferences.ctaLinks}
                      onChange={(chips) => setContentPreferences({ ...contentPreferences, ctaLinks: chips })}
                      placeholder="Type URL and press Tab or Enter to add..."
                    />
                  </div>

                  {/* CTA Copy */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Copy</h4>
                    <p className="text-xs text-muted-foreground mb-3">Add the copy or text to show for a hyperlink. Typically, this is the action you want to drive.</p>
                    <Input 
                      placeholder="Examples: Learn More, Buy Now, Visit Us, Schedule Call" 
                      className="max-w-md"
                      value={contentPreferences.ctaCopy}
                      onChange={(e) => setContentPreferences({ ...contentPreferences, ctaCopy: e.target.value })}
                    />
                  </div>

                  {/* CTA Frequency */}
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Frequency</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set how often you'd like to include a link in your captions for social posts.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant={contentPreferences.ctaFrequency === 'never' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, ctaFrequency: 'never' })}
                      >
                        Never
                      </Button>
                      <Button 
                        variant={contentPreferences.ctaFrequency === 'sometimes' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, ctaFrequency: 'sometimes' })}
                      >
                        Sometimes
                      </Button>
                      <Button 
                        variant={contentPreferences.ctaFrequency === 'always' ? 'default' : 'outline'}
                        size="sm" 
                        className="text-xs"
                        onClick={() => setContentPreferences({ ...contentPreferences, ctaFrequency: 'always' })}
                      >
                        Always
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Save Button for CTA Preferences */}
                <div className="flex justify-end mt-6">
                  <Button 
                    onClick={() => saveContentPreferences('cta')}
                    disabled={isSaving}
                    size="sm"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Preferences
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
