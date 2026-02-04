"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Edit, Trash2, Loader2, Save, X, CloudUpload, FileText, ImageIcon, Users, Package, Briefcase, Video, MessageSquare, Settings } from "lucide-react";
import { contextApi, uploadApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

// Helper: format text with line breaks and bold sections (from BrandKitPage)
const FormattedText = ({ text }: { text: string }) => {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-2" />;
        const isSectionHeader =
          line.match(/^(•\s*)?([A-Z][^:]+):/) ||
          line.match(
            /^(Core Identity|Market Positioning|Direct Competitors|Business Overview|Why Customers Choose|Customer Demographics|Psychographics):/i
          );
        if (isSectionHeader) {
          const colonIndex = line.indexOf(":");
          const header = line.substring(0, colonIndex + 1);
          const content = line.substring(colonIndex + 1);
          return (
            <p key={index} className="text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{header}</span>
              {content}
            </p>
          );
        }
        if (line.match(/^(\d+\.\s|•\s)/)) {
          const colonMatch = line.match(/^(\d+\.\s|•\s)(.+?)(:|–|—)(.*)$/);
          if (colonMatch) {
            const [, bullet, boldText, separator, rest] = colonMatch;
            return (
              <p key={index} className="text-muted-foreground leading-relaxed ml-0">
                {bullet}
                <span className="font-semibold text-foreground">{boldText}{separator}</span>
                {rest}
              </p>
            );
          }
        }
        return (
          <p key={index} className="text-muted-foreground leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
};

interface DocumentData {
  name: string;
  url: string;
  text: string;
  timestamp?: string;
}

type SettingsBrandTab = "profile" | "images-video" | "voice" | "preferences";

interface SettingsBrandContentProps {
  tab: SettingsBrandTab;
}

export const SettingsBrandContent = ({ tab }: SettingsBrandContentProps) => {
  const [contextData, setContextData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [uploadedDocuments, setUploadedDocuments] = useState<DocumentData[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<{
    images: Array<{ url: string; presignedUrl: string; timestamp: string }>;
    videos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
  }>({ images: [], videos: [] });
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [brandVoices, setBrandVoices] = useState<{
    purpose: string;
    audience: string;
    tone: string[];
    emotions: string[];
    character: string[];
    syntax: string[];
    language: string;
  }>({
    purpose: "",
    audience: "",
    tone: [],
    emotions: [],
    character: [],
    syntax: [],
    language: "",
  });
  const [contentPreferences, setContentPreferences] = useState<{
    featuredMedia: { text: boolean; image: boolean; video: boolean };
    brandKitMediaPriority: "only_brand_kit" | "brand_kit_first" | "only_stock";
    brandKitMediaReuse: "never_reuse" | "reuse_after_3_weeks";
    alwaysIncludeBlogImages: boolean;
    contentLanguage: string;
    topicsToAvoid: string[];
    wordsToAvoid: string[];
    blogKeywords: string[];
    alwaysIncludeExternalLinks: boolean;
    externalUrlsToAvoid: string[];
    hashtags: { avoid: string[]; include: string[] };
    hashtagFrequency: string;
    logoFrequency: string;
    ctaLinks: string[];
    ctaCopy: string;
    ctaFrequency: string;
  }>({
    featuredMedia: { text: true, image: true, video: true },
    brandKitMediaPriority: "brand_kit_first",
    brandKitMediaReuse: "reuse_after_3_weeks",
    alwaysIncludeBlogImages: true,
    contentLanguage: "en-us",
    topicsToAvoid: [],
    wordsToAvoid: [],
    blogKeywords: [],
    alwaysIncludeExternalLinks: true,
    externalUrlsToAvoid: [],
    hashtags: { avoid: [], include: [] },
    hashtagFrequency: "sometimes",
    logoFrequency: "sometimes",
    ctaLinks: [],
    ctaCopy: "",
    ctaFrequency: "sometimes",
  });
  const [voiceTagInputs, setVoiceTagInputs] = useState({ tone: "", emotions: "", character: "", syntax: "" });
  const [preferencesWander, setPreferencesWander] = useState<{
    preferredContentTypes: string[];
    targetPlatforms: string[];
    postingFrequency: string;
    bestTimesToPost: string;
    contentGuidelines: string;
    hashtagStrategy: string;
  }>({
    preferredContentTypes: [],
    targetPlatforms: [],
    postingFrequency: "",
    bestTimesToPost: "",
    contentGuidelines: "",
    hashtagStrategy: "",
  });

  const { toast } = useToast();
  const { accountId } = useAuth();

  const fetchContextData = async () => {
    if (!accountId) return;
    try {
      setIsLoading(true);
      const response = await contextApi.getContext();
      if (response.success && response.data) {
        setContextData(response.data);
        if (response.data.documentsText && Array.isArray(response.data.documentsText)) {
          setUploadedDocuments(response.data.documentsText);
        }
        const images: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
        const videos: Array<{ url: string; presignedUrl: string; timestamp: string }> = [];
        if (response.data.brandImages && Array.isArray(response.data.brandImages)) {
          for (const item of response.data.brandImages) {
            if (typeof item === "string") {
              const presignedUrl = await uploadApi.getPresignedUrl(item);
              images.push({ url: item, presignedUrl: presignedUrl || item, timestamp: new Date().toISOString() });
            } else if (item.url) {
              const presignedUrl = await uploadApi.getPresignedUrl(item.url);
              images.push({
                url: item.url,
                presignedUrl: presignedUrl || item.url,
                timestamp: item.timestamp || new Date().toISOString(),
              });
            }
          }
        }
        if (response.data.brandAssets && Array.isArray(response.data.brandAssets)) {
          for (const item of response.data.brandAssets) {
            if (typeof item === "string") {
              const presignedUrl = await uploadApi.getPresignedUrl(item);
              videos.push({ url: item, presignedUrl: presignedUrl || item, timestamp: new Date().toISOString() });
            } else if (item.url) {
              const presignedUrl = await uploadApi.getPresignedUrl(item.url);
              videos.push({
                url: item.url,
                presignedUrl: presignedUrl || item.url,
                timestamp: item.timestamp || new Date().toISOString(),
              });
            }
          }
        }
        setUploadedMedia({ images, videos });
        if (response.data.brandVoices) {
          setBrandVoices({
            purpose: Array.isArray(response.data.brandVoices.purpose)
              ? response.data.brandVoices.purpose.join("\n")
              : response.data.brandVoices.purpose || "",
            audience: Array.isArray(response.data.brandVoices.audience)
              ? response.data.brandVoices.audience.join("\n")
              : response.data.brandVoices.audience || "",
            tone: response.data.brandVoices.tone || [],
            emotions: response.data.brandVoices.emotions || [],
            character: response.data.brandVoices.character || [],
            syntax: response.data.brandVoices.syntax || [],
            language: Array.isArray(response.data.brandVoices.language)
              ? response.data.brandVoices.language.join("\n")
              : response.data.brandVoices.language || "",
          });
        }
        if (response.data.contentPreferences) {
          setContentPreferences({
            featuredMedia: response.data.contentPreferences.featuredMedia || {
              text: true,
              image: true,
              video: true,
            },
            brandKitMediaPriority: response.data.contentPreferences.brandKitMediaPriority || "brand_kit_first",
            brandKitMediaReuse: response.data.contentPreferences.brandKitMediaReuse || "reuse_after_3_weeks",
            alwaysIncludeBlogImages: response.data.contentPreferences.alwaysIncludeBlogImages ?? true,
            contentLanguage: response.data.contentPreferences.contentLanguage || "en-us",
            topicsToAvoid: response.data.contentPreferences.topicsToAvoid || [],
            wordsToAvoid: response.data.contentPreferences.wordsToAvoid || [],
            blogKeywords: response.data.contentPreferences.blogKeywords || [],
            alwaysIncludeExternalLinks: response.data.contentPreferences.alwaysIncludeExternalLinks ?? true,
            externalUrlsToAvoid: response.data.contentPreferences.externalUrlsToAvoid || [],
            hashtags: response.data.contentPreferences.hashtags || { avoid: [], include: [] },
            hashtagFrequency: response.data.contentPreferences.hashtagFrequency || "sometimes",
            logoFrequency: response.data.contentPreferences.logoFrequency || "sometimes",
            ctaLinks: response.data.contentPreferences.ctaLinks || [],
            ctaCopy: response.data.contentPreferences.ctaCopy || "",
            ctaFrequency: response.data.contentPreferences.ctaFrequency || "sometimes",
          });
          setPreferencesWander({
            preferredContentTypes: response.data.contentPreferences.preferredContentTypes || [],
            targetPlatforms: response.data.contentPreferences.targetPlatforms || [],
            postingFrequency: response.data.contentPreferences.postingFrequency || "",
            bestTimesToPost: response.data.contentPreferences.bestTimesToPost || "",
            contentGuidelines: response.data.contentGuidelines || "",
            hashtagStrategy: response.data.contentPreferences.hashtagStrategy || "",
          });
        }
        if (response.data && !response.data.contentPreferences) {
          setPreferencesWander({
            preferredContentTypes: [],
            targetPlatforms: [],
            postingFrequency: "",
            bestTimesToPost: "",
            contentGuidelines: response.data.contentGuidelines || "",
            hashtagStrategy: "",
          });
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch context:", error);
      toast({ title: "Error", description: "Failed to load data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (accountId) fetchContextData();
  }, [accountId]);

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
      const response = await contextApi.updateContext(updates);
      if (response.success && response.data) {
        setContextData(response.data);
        if (response.data.brandVoices) {
          setBrandVoices({
            purpose: Array.isArray(response.data.brandVoices.purpose)
              ? response.data.brandVoices.purpose.join("\n")
              : response.data.brandVoices.purpose || "",
            audience: Array.isArray(response.data.brandVoices.audience)
              ? response.data.brandVoices.audience.join("\n")
              : response.data.brandVoices.audience || "",
            tone: response.data.brandVoices.tone || [],
            emotions: response.data.brandVoices.emotions || [],
            character: response.data.brandVoices.character || [],
            syntax: response.data.brandVoices.syntax || [],
            language: Array.isArray(response.data.brandVoices.language)
              ? response.data.brandVoices.language.join("\n")
              : response.data.brandVoices.language || "",
          });
        }
        if (response.data.contentPreferences) {
          setContentPreferences({
            ...contentPreferences,
            ...response.data.contentPreferences,
          });
        }
        if (response.data.contentPreferences || response.data.contentGuidelines !== undefined) {
          setPreferencesWander((p) => ({
            preferredContentTypes: response.data.contentPreferences?.preferredContentTypes ?? p.preferredContentTypes,
            targetPlatforms: response.data.contentPreferences?.targetPlatforms ?? p.targetPlatforms,
            postingFrequency: response.data.contentPreferences?.postingFrequency ?? p.postingFrequency,
            bestTimesToPost: response.data.contentPreferences?.bestTimesToPost ?? p.bestTimesToPost,
            contentGuidelines: response.data.contentGuidelines ?? p.contentGuidelines,
            hashtagStrategy: response.data.contentPreferences?.hashtagStrategy ?? p.hashtagStrategy,
          }));
        }
        setEditingSection(null);
        setEditData({});
        toast({ title: "Success", description: "Changes saved successfully" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const saveContentPreferences = async (section?: "design" | "content" | "cta") => {
    try {
      setIsSaving(true);
      let preferencesToSave: any = { ...contentPreferences };
      if (section === "design") {
        preferencesToSave = {
          ...contextData?.contentPreferences,
          featuredMedia: contentPreferences.featuredMedia,
          brandKitMediaPriority: contentPreferences.brandKitMediaPriority,
          brandKitMediaReuse: contentPreferences.brandKitMediaReuse,
          alwaysIncludeBlogImages: contentPreferences.alwaysIncludeBlogImages,
        };
      } else if (section === "content") {
        preferencesToSave = {
          ...contextData?.contentPreferences,
          contentLanguage: contentPreferences.contentLanguage,
          topicsToAvoid: contentPreferences.topicsToAvoid,
          wordsToAvoid: contentPreferences.wordsToAvoid,
          blogKeywords: contentPreferences.blogKeywords,
          alwaysIncludeExternalLinks: contentPreferences.alwaysIncludeExternalLinks,
          externalUrlsToAvoid: contentPreferences.externalUrlsToAvoid,
          hashtags: contentPreferences.hashtags,
          hashtagFrequency: contentPreferences.hashtagFrequency,
          logoFrequency: contentPreferences.logoFrequency,
        };
      } else if (section === "cta") {
        preferencesToSave = {
          ...contextData?.contentPreferences,
          ctaLinks: contentPreferences.ctaLinks,
          ctaCopy: contentPreferences.ctaCopy,
          ctaFrequency: contentPreferences.ctaFrequency,
        };
      }
      await handleSave({ contentPreferences: preferencesToSave });
      toast({
        title: "Success",
        description: section
          ? `${section === "design" ? "Design" : section === "content" ? "Content" : "CTA"} preferences saved`
          : "Preferences saved",
      });
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to save preferences", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const uploadDocuments = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;
    try {
      setUploadingDocuments(true);
      const response = await uploadApi.uploadDocuments(filesToUpload);
      if (response.success && response.data) {
        const newDocs = response.data.documents_text || [];
        const allDocs = [...uploadedDocuments, ...newDocs];
        setUploadedDocuments(allDocs);
        const allDocumentUrls = allDocs.map((d) => d.url).filter(Boolean);
        await handleSave({ documentsText: allDocs, documentUrls: allDocumentUrls });
        setDocumentFiles([]);
        toast({ title: "Success", description: `${filesToUpload.length} document(s) uploaded` });
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to upload documents", variant: "destructive" });
    } finally {
      setUploadingDocuments(false);
    }
  };

  const uploadMedia = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return;
    try {
      setUploadingImages(true);
      const response = await uploadApi.uploadMedia(filesToUpload);
      if (response.success && response.data) {
        const allImages = [...uploadedMedia.images, ...response.data.images];
        const allVideos = [...uploadedMedia.videos, ...response.data.videos];
        setUploadedMedia({ images: allImages, videos: allVideos });
        await handleSave({ brandImages: allImages, brandAssets: allVideos });
        setMediaFiles([]);
        toast({ title: "Success", description: `${filesToUpload.length} file(s) uploaded` });
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to upload media", variant: "destructive" });
    } finally {
      setUploadingImages(false);
    }
  };

  const deleteMedia = async (type: "image" | "video", index: number) => {
    try {
      let newImages = [...uploadedMedia.images];
      let newVideos = [...uploadedMedia.videos];
      if (type === "image") newImages = newImages.filter((_, i) => i !== index);
      else newVideos = newVideos.filter((_, i) => i !== index);
      setUploadedMedia({ images: newImages, videos: newVideos });
      await handleSave({ brandImages: newImages, brandAssets: newVideos });
      toast({ title: "Deleted", description: `${type} removed` });
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to delete ${type}`, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  const cardClass = "rounded-xl border border-border bg-card p-4 md:p-6 shadow-sm";
  const btnOutline =
    "rounded-lg border border-border bg-background hover:bg-accent hover:text-accent-foreground text-foreground px-3 py-2 h-9 text-sm font-medium transition-colors";
  const btnEdit =
    "rounded-full border border-input bg-muted hover:bg-[#e88d44] hover:text-white hover:border-[#e88d44] text-foreground px-3 py-2 h-9 text-sm font-medium transition-colors dark:border-[hsl(217_25%_22%)] dark:bg-[hsl(217_33%_14%)] dark:hover:bg-[#e88d44] dark:hover:text-white dark:hover:border-[#e88d44]";
  const btnPrimary = "rounded-lg bg-black text-white hover:bg-black/90 border-0 px-4 py-2 h-9 text-sm font-medium";

  // Profile tab - wanderlust style, includes Files + Media upload zones
  if (tab === "profile") {
    return (
      <div className="space-y-6">
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-muted-foreground" />
              Business Overview & Positioning
            </h3>
            {editingSection !== "business-overview" && (
              <Button variant="outline" size="sm" className={btnEdit} onClick={() => handleEdit("business-overview", { businessOverview: contextData?.businessOverview || "", competitors: contextData?.competitors || "", whyCustomersChoose: contextData?.whyCustomersChoose || "" })}>
                <Edit className="w-4 h-4 mr-1" /> Edit
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">Business Overview:</h4>
              {editingSection === "business-overview" ? (
                <RichTextEditor
                  content={editData.businessOverview || ""}
                  onSave={(c: string) => handleSave({ businessOverview: c, competitors: editData.competitors, whyCustomersChoose: editData.whyCustomersChoose })}
                  onCancel={handleCancelEdit}
                  isSaving={isSaving}
                />
              ) : contextData?.businessOverview ? (
                <FormattedText text={contextData.businessOverview} />
              ) : (
                <p className="text-muted-foreground text-sm">No business overview yet. Click Edit to add.</p>
              )}
            </div>
            {contextData?.whyCustomersChoose && editingSection !== "business-overview" && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Why Customers Choose {contextData.accountName || "Us"}:</h4>
                <FormattedText text={contextData.whyCustomersChoose} />
              </div>
            )}
            {contextData?.competitors && editingSection !== "business-overview" && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Direct Competitors</h4>
                <FormattedText text={contextData.competitors} />
              </div>
            )}
          </div>
        </div>

        {contextData?.customerDemographics && (
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                Customer Demographics & Psychographics
              </h3>
              {editingSection !== "customer-demographics" && (
<Button variant="outline" size="sm" className={btnEdit} onClick={() => handleEdit("customer-demographics", { customerDemographics: contextData?.customerDemographics || "" })}>
                <Edit className="w-4 h-4 mr-1" /> Edit
              </Button>
              )}
            </div>
            {editingSection === "customer-demographics" ? (
              <RichTextEditor content={editData.customerDemographics || ""} onSave={(c: string) => handleSave({ customerDemographics: c })} onCancel={handleCancelEdit} isSaving={isSaving} />
            ) : (
              <FormattedText text={contextData.customerDemographics} />
            )}
          </div>
        )}

        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2">
              <Package className="w-5 h-5 text-muted-foreground" />
              Most Popular Products & Services
            </h3>
            {editingSection !== "popular-products" && (
              <Button
                variant="outline"
                size="sm"
                className={btnEdit}
                onClick={() => {
                  const raw = contextData?.popularProducts;
                  const str = Array.isArray(raw) ? raw.join("\n") : (raw || "");
                  handleEdit("popular-products", { popularProducts: str });
                }}
              >
                <Edit className="w-4 h-4 mr-1" /> Edit
              </Button>
            )}
          </div>
          {editingSection === "popular-products" ? (
            <RichTextEditor
              content={editData.popularProducts || ""}
              onSave={(c: string) => {
                const arr = c.split("\n").map((s) => s.trim()).filter(Boolean);
                handleSave({ popularProducts: arr });
              }}
              onCancel={handleCancelEdit}
              isSaving={isSaving}
            />
          ) : contextData?.popularProducts ? (
            Array.isArray(contextData.popularProducts) ? (
              <FormattedText text={contextData.popularProducts.join("\n")} />
            ) : (
              <FormattedText text={contextData.popularProducts} />
            )
          ) : (
            <p className="text-muted-foreground text-sm">No products yet. Click Edit to add.</p>
          )}
        </div>

        {/* Files - Documents upload (moved from Images & Video) */}
        <div className={cardClass}>
          <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
            <FileText className="w-5 h-5 text-muted-foreground" />
            Files
          </h3>
          <p className="text-sm text-muted-foreground mb-4">Upload PDF or DOCX. Text will be extracted.</p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files).filter((f) => /pdf|docx?/i.test(f.type) || /\.(pdf|docx?)$/i.test(f.name));
              if (files.length) setDocumentFiles((p) => [...p, ...files]);
            }}
            className="border-2 border-dashed border-[hsl(var(--landing-nav-bar-border))] rounded-lg p-8 text-center cursor-pointer hover:border-foreground/20 transition-colors bg-[hsl(var(--landing-hero-bg))]"
          >
            <CloudUpload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-foreground mb-2">Drag & drop PDF or DOCX, or click to choose</p>
            <input type="file" className="hidden" id="profile-docs-input" accept=".pdf,.doc,.docx" multiple onChange={(e) => setDocumentFiles((p) => [...p, ...Array.from(e.target.files || [])])} />
            <Button variant="outline" size="sm" className={btnOutline} onClick={() => document.getElementById("profile-docs-input")?.click()}>
              Choose Files
            </Button>
          </div>
          {documentFiles.length > 0 && (
            <Button className={`mt-4 ${btnPrimary}`} onClick={() => uploadDocuments(documentFiles)} disabled={uploadingDocuments}>
              {uploadingDocuments ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Upload {documentFiles.length} file(s)
            </Button>
          )}
        </div>

        {!contextData?.businessOverview &&
          !contextData?.customerDemographics &&
          !(Array.isArray(contextData?.popularProducts) ? contextData.popularProducts.length : contextData?.popularProducts) && (
            <p className="text-muted-foreground text-sm">No profile data yet. Add your business overview in Brand Kit or here.</p>
          )}
      </div>
    );
  }

  // Images & Video tab - upload media + galleries
  if (tab === "images-video") {
    return (
      <div className="space-y-6">
        {/* Upload Media */}
        <div className={cardClass}>
          <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
            <ImageIcon className="w-5 h-5 text-muted-foreground" />
            Upload Media
          </h3>
          <p className="text-sm text-muted-foreground mb-4">Drag & drop images or videos. Supported: JPG, PNG, WEBP, MP4</p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files).filter((f) => /^(image\/(jpeg|jpg|png|webp)|video\/mp4)$/.test(f.type));
              if (files.length) setMediaFiles((p) => [...p, ...files]);
            }}
            onClick={() => document.getElementById("images-video-media-input")?.click()}
            className="border-2 border-dashed border-[hsl(var(--landing-nav-bar-border))] rounded-lg p-8 text-center cursor-pointer hover:border-foreground/20 transition-colors bg-[hsl(var(--landing-hero-bg))]"
          >
            <CloudUpload className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-foreground">Drag & drop or click to upload</p>
          </div>
          <input type="file" id="images-video-media-input" className="hidden" accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4" multiple onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) setMediaFiles((p) => [...p, ...f]); e.target.value = ""; }} />
          {mediaFiles.length > 0 && (
            <Button className={`mt-4 ${btnPrimary}`} onClick={() => uploadMedia(mediaFiles)} disabled={uploadingImages}>
              {uploadingImages ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Upload {mediaFiles.length} file(s)
            </Button>
          )}
        </div>

        <div className={cardClass}>
          <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
            <ImageIcon className="w-5 h-5 text-muted-foreground" />
            Brand Images ({uploadedMedia.images.length})
          </h3>
          {uploadedMedia.images.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {uploadedMedia.images.map((item, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img src={item.presignedUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                    <Button variant="ghost" size="icon" className="text-white" onClick={() => deleteMedia("image", idx)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center rounded-lg bg-[hsl(var(--landing-hero-bg))] border border-[hsl(var(--landing-nav-bar-border))]">
              <p className="text-sm text-muted-foreground">No images yet</p>
            </div>
          )}
        </div>

        <div className={cardClass}>
          <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
            <Video className="w-5 h-5 text-muted-foreground" />
            Brand Videos ({uploadedMedia.videos.length})
          </h3>
          {uploadedMedia.videos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {uploadedMedia.videos.map((item, idx) => (
                <div key={idx} className="relative rounded-lg overflow-hidden">
                  <video src={item.presignedUrl} controls className="w-full" />
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2 bg-black/50 text-white" onClick={() => deleteMedia("video", idx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center rounded-lg bg-[hsl(var(--landing-hero-bg))] border border-[hsl(var(--landing-nav-bar-border))]">
              <p className="text-sm text-muted-foreground">No videos yet</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Voice tab - matches wander-discover-connect: single card, no inner scroll, page scrolls naturally
  if (tab === "voice") {
    const saveVoice = async () => {
      await handleSave({
        brandVoices: {
          purpose: brandVoices.purpose || "",
          audience: brandVoices.audience || "",
          tone: brandVoices.tone || [],
          emotions: brandVoices.emotions || [],
          character: brandVoices.character || [],
          syntax: brandVoices.syntax || [],
          language: brandVoices.language || "",
        },
      });
    };

    return (
      <div className="space-y-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-foreground" />
              <h2 className="font-semibold">Brand Voice</h2>
            </div>
            <Button
              size="sm"
              className="rounded-lg bg-black text-white hover:bg-black/90 border-0 px-4 py-2 h-9 text-sm font-medium"
              onClick={saveVoice}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />} Save
            </Button>
          </div>

          <div className="space-y-6">
            {/* Purpose */}
            <div>
              <label className="text-sm font-medium mb-2 block">Purpose</label>
              <Textarea
                placeholder="Describe your brand's purpose..."
                className="min-h-[100px] bg-secondary/30 border border-border"
                value={brandVoices.purpose || ""}
                onChange={(e) => setBrandVoices({ ...brandVoices, purpose: e.target.value })}
              />
            </div>

            {/* Audience */}
            <div>
              <label className="text-sm font-medium mb-2 block">Audience</label>
              <Textarea
                placeholder="Describe your target audience..."
                className="min-h-[100px] bg-secondary/30 border border-border"
                value={brandVoices.audience || ""}
                onChange={(e) => setBrandVoices({ ...brandVoices, audience: e.target.value })}
              />
            </div>

            {/* Tone - wander style: Badge + Input in bg-secondary/30 box */}
            <div>
              <label className="text-sm font-medium mb-2 block">Tone</label>
              <div className="bg-secondary/30 border border-border rounded-lg p-3 min-h-[80px]">
                <div className="flex flex-wrap gap-2 mb-2">
                  {(brandVoices.tone || []).map((tone) => (
                    <Badge key={tone} variant="secondary" className="gap-1">
                      {tone}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setBrandVoices({ ...brandVoices, tone: (brandVoices.tone || []).filter((t) => t !== tone) })} />
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Type and press Tab or Enter to add tone..."
                  className="border-0 bg-transparent p-0 focus-visible:ring-0 text-sm"
                  value={voiceTagInputs.tone}
                  onChange={(e) => setVoiceTagInputs((p) => ({ ...p, tone: e.target.value }))}
                  onKeyDown={(e) => {
                    const val = voiceTagInputs.tone.trim();
                    if ((e.key === "Tab" || e.key === "Enter") && val) {
                      e.preventDefault();
                      if (!(brandVoices.tone || []).includes(val)) {
                        setBrandVoices({ ...brandVoices, tone: [...(brandVoices.tone || []), val] });
                        setVoiceTagInputs((p) => ({ ...p, tone: "" }));
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Emotions */}
            <div>
              <label className="text-sm font-medium mb-2 block">Emotions</label>
              <div className="bg-secondary/30 border border-border rounded-lg p-3 min-h-[80px]">
                <div className="flex flex-wrap gap-2 mb-2">
                  {(brandVoices.emotions || []).map((emotion) => (
                    <Badge key={emotion} variant="secondary" className="gap-1">
                      {emotion}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setBrandVoices({ ...brandVoices, emotions: (brandVoices.emotions || []).filter((e) => e !== emotion) })} />
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Type and press Tab or Enter to add emotions..."
                  className="border-0 bg-transparent p-0 focus-visible:ring-0 text-sm"
                  value={voiceTagInputs.emotions}
                  onChange={(e) => setVoiceTagInputs((p) => ({ ...p, emotions: e.target.value }))}
                  onKeyDown={(e) => {
                    const val = voiceTagInputs.emotions.trim();
                    if ((e.key === "Tab" || e.key === "Enter") && val) {
                      e.preventDefault();
                      if (!(brandVoices.emotions || []).includes(val)) {
                        setBrandVoices({ ...brandVoices, emotions: [...(brandVoices.emotions || []), val] });
                        setVoiceTagInputs((p) => ({ ...p, emotions: "" }));
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Character */}
            <div>
              <label className="text-sm font-medium mb-2 block">Character</label>
              <div className="bg-secondary/30 border border-border rounded-lg p-3 min-h-[80px]">
                <div className="flex flex-wrap gap-2 mb-2">
                  {(brandVoices.character || []).map((char) => (
                    <Badge key={char} variant="secondary" className="gap-1">
                      {char}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setBrandVoices({ ...brandVoices, character: (brandVoices.character || []).filter((c) => c !== char) })} />
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Type and press Tab or Enter to add character..."
                  className="border-0 bg-transparent p-0 focus-visible:ring-0 text-sm"
                  value={voiceTagInputs.character}
                  onChange={(e) => setVoiceTagInputs((p) => ({ ...p, character: e.target.value }))}
                  onKeyDown={(e) => {
                    const val = voiceTagInputs.character.trim();
                    if ((e.key === "Tab" || e.key === "Enter") && val) {
                      e.preventDefault();
                      if (!(brandVoices.character || []).includes(val)) {
                        setBrandVoices({ ...brandVoices, character: [...(brandVoices.character || []), val] });
                        setVoiceTagInputs((p) => ({ ...p, character: "" }));
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Syntax */}
            <div>
              <label className="text-sm font-medium mb-2 block">Syntax</label>
              <div className="bg-secondary/30 border border-border rounded-lg p-3 min-h-[80px]">
                <div className="flex flex-wrap gap-2 mb-2">
                  {(brandVoices.syntax || []).map((syn) => (
                    <Badge key={syn} variant="secondary" className="gap-1">
                      {syn}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setBrandVoices({ ...brandVoices, syntax: (brandVoices.syntax || []).filter((s) => s !== syn) })} />
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Type and press Tab or Enter to add syntax..."
                  className="border-0 bg-transparent p-0 focus-visible:ring-0 text-sm"
                  value={voiceTagInputs.syntax}
                  onChange={(e) => setVoiceTagInputs((p) => ({ ...p, syntax: e.target.value }))}
                  onKeyDown={(e) => {
                    const val = voiceTagInputs.syntax.trim();
                    if ((e.key === "Tab" || e.key === "Enter") && val) {
                      e.preventDefault();
                      if (!(brandVoices.syntax || []).includes(val)) {
                        setBrandVoices({ ...brandVoices, syntax: [...(brandVoices.syntax || []), val] });
                        setVoiceTagInputs((p) => ({ ...p, syntax: "" }));
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="text-sm font-medium mb-2 block">Language</label>
              <Textarea
                placeholder="Describe language preferences..."
                className="min-h-[100px] bg-secondary/30 border border-border"
                value={brandVoices.language || ""}
                onChange={(e) => setBrandVoices({ ...brandVoices, language: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Preferences tab - matches wander UI exactly, saves to dvyb_context
  if (tab === "preferences") {
    const CONTENT_TYPES = ["Static Images", "Video Ads", "Carousels", "Stories", "Reels"];
    const PLATFORMS = ["Instagram", "Facebook", "TikTok", "LinkedIn", "Twitter", "YouTube"];

    const toggleContentType = (type: string) => {
      setPreferencesWander((p) => ({
        ...p,
        preferredContentTypes: p.preferredContentTypes.includes(type)
          ? p.preferredContentTypes.filter((t) => t !== type)
          : [...p.preferredContentTypes, type],
      }));
    };

    const togglePlatform = (platform: string) => {
      setPreferencesWander((p) => ({
        ...p,
        targetPlatforms: p.targetPlatforms.includes(platform)
          ? p.targetPlatforms.filter((t) => t !== platform)
          : [...p.targetPlatforms, platform],
      }));
    };

    const savePreferences = async () => {
      await handleSave({
        contentGuidelines: preferencesWander.contentGuidelines || null,
        contentPreferences: {
          ...contextData?.contentPreferences,
          preferredContentTypes: preferencesWander.preferredContentTypes,
          targetPlatforms: preferencesWander.targetPlatforms,
          postingFrequency: preferencesWander.postingFrequency || undefined,
          bestTimesToPost: preferencesWander.bestTimesToPost || undefined,
          hashtagStrategy: preferencesWander.hashtagStrategy || undefined,
        },
      });
    };

    return (
      <div className="space-y-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-foreground" />
              <h2 className="font-semibold">Content Preferences</h2>
            </div>
            <Button
              size="sm"
              className="rounded-lg bg-black text-white hover:bg-black/90 border-0 px-4 py-2 h-9 text-sm font-medium"
              onClick={savePreferences}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />} Save
            </Button>
          </div>

          <div className="space-y-6">
            {/* Preferred Content Types */}
            <div>
              <label className="text-sm font-medium mb-3 block">Preferred Content Types</label>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((type) => (
                  <Badge
                    key={type}
                    variant={preferencesWander.preferredContentTypes.includes(type) ? "default" : "outline"}
                    className="cursor-pointer hover:bg-black hover:text-white transition-colors px-3 py-1.5"
                    onClick={() => toggleContentType(type)}
                  >
                    {type}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Target Platforms */}
            <div>
              <label className="text-sm font-medium mb-3 block">Target Platforms</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((platform) => (
                  <Badge
                    key={platform}
                    variant={preferencesWander.targetPlatforms.includes(platform) ? "default" : "outline"}
                    className="cursor-pointer hover:bg-black hover:text-white transition-colors px-3 py-1.5"
                    onClick={() => togglePlatform(platform)}
                  >
                    {platform}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Preferred Posting Frequency */}
            <div>
              <label className="text-sm font-medium mb-2 block">Preferred Posting Frequency</label>
              <Input
                placeholder="e.g., 3-5 times per week"
                className="bg-secondary/30"
                value={preferencesWander.postingFrequency}
                onChange={(e) => setPreferencesWander((p) => ({ ...p, postingFrequency: e.target.value }))}
              />
            </div>

            {/* Best Times to Post */}
            <div>
              <label className="text-sm font-medium mb-2 block">Best Times to Post</label>
              <Input
                placeholder="e.g., Weekdays 9am-12pm, 6pm-9pm"
                className="bg-secondary/30"
                value={preferencesWander.bestTimesToPost}
                onChange={(e) => setPreferencesWander((p) => ({ ...p, bestTimesToPost: e.target.value }))}
              />
            </div>

            {/* Content Guidelines */}
            <div>
              <label className="text-sm font-medium mb-2 block">Content Guidelines</label>
              <Textarea
                placeholder="Any specific guidelines, dos and don'ts for your content..."
                className="min-h-[100px] bg-secondary/30"
                value={preferencesWander.contentGuidelines}
                onChange={(e) => setPreferencesWander((p) => ({ ...p, contentGuidelines: e.target.value }))}
              />
            </div>

            {/* Hashtag Strategy */}
            <div>
              <label className="text-sm font-medium mb-2 block">Hashtag Strategy</label>
              <Textarea
                placeholder="Preferred hashtags, hashtag groups, or strategy notes..."
                className="min-h-[80px] bg-secondary/30"
                value={preferencesWander.hashtagStrategy}
                onChange={(e) => setPreferencesWander((p) => ({ ...p, hashtagStrategy: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
