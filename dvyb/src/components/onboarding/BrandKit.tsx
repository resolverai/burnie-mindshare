"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi, uploadApi } from "@/lib/api";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { ColorPickerDialog } from "@/components/ui/color-picker-dialog";
import { FontSelectorDialog } from "@/components/ui/font-selector-dialog";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

interface BrandKitProps {
  onContinue: () => void;
}

type ColorType = 'primary' | 'secondary' | 'accent';
type FontType = 'title' | 'body';

export const BrandKit = ({ onContinue }: BrandKitProps) => {
  const { accountId } = useAuth();
  const { toast } = useToast();

  // State
  const [brandName, setBrandName] = useState<string>("Your Brand");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [socialPostColors, setSocialPostColors] = useState({
    primary: "#eff31b",
    secondary: "#1a1a1a",
    accent: "#d9dd00",
  });
  const [brandFonts, setBrandFonts] = useState({
    title: "Inter",
    body: "Inter",
  });
  const [brandImages, setBrandImages] = useState<string[]>([]);
  const [brandVoice, setBrandVoice] = useState<string>("");
  
  // UI State
  const [isEditingColors, setIsEditingColors] = useState(false);
  const [isEditingFonts, setIsEditingFonts] = useState(false);
  const [isEditingBrandVoice, setIsEditingBrandVoice] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [selectedColorType, setSelectedColorType] = useState<ColorType>('primary');
  const [fontSelectorOpen, setFontSelectorOpen] = useState(false);
  const [selectedFontType, setSelectedFontType] = useState<FontType>('title');
  const [isSaving, setIsSaving] = useState(false);

  // Fetch brand data
  useEffect(() => {
    const fetchBrandData = async () => {
      if (accountId) {
        try {
          const response = await contextApi.getContext();
          if (response.success && response.data) {
            const context = response.data;
            
            setBrandName(context.accountName || "Your Brand");
            
            // Use presigned URL if available, otherwise use regular URL
            setLogoUrl((context as any).logoPresignedUrl || context.logoUrl || null);
            
            // Social Post Colors
            if (context.socialPostColors) {
              setSocialPostColors({
                primary: context.socialPostColors.primary || "#eff31b",
                secondary: context.socialPostColors.secondary || "#1a1a1a",
                accent: context.socialPostColors.accent || "#d9dd00",
              });
            } else if (context.colorPalette) {
              // Fallback to colorPalette if socialPostColors not set
              setSocialPostColors({
                primary: context.colorPalette.primary || "#eff31b",
                secondary: context.colorPalette.secondary || "#1a1a1a",
                accent: context.colorPalette.accent || "#d9dd00",
              });
            }
            
            // Brand Fonts
            if (context.brandFonts) {
              setBrandFonts({
                title: context.brandFonts.title || "Inter",
                body: context.brandFonts.body || "Inter",
              });
            }
            
            // Brand Images - use presigned URLs if available, otherwise use regular URLs
            setBrandImages((context as any).brandImagesPresigned || context.brandImages || []);
            
            // Brand Voice (from brandStory column)
            setBrandVoice(context.brandStory || "");
          }
        } catch (error) {
          console.error("Failed to fetch brand context:", error);
        }
      }
    };

    fetchBrandData();
  }, [accountId]);

  // Logo upload handler
  const handleLogoUpload = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];

    try {
      const response = await uploadApi.uploadLogo(files[0]);
      if (response.success) {
        // Use the presigned URL from the upload response immediately
        setLogoUrl(response.data.presignedUrl || response.data.s3_key);
        
        return [response.data.presignedUrl || response.data.s3_key];
      }
      throw new Error('Upload failed');
    } catch (error) {
      console.error('Logo upload error:', error);
      throw error;
    }
  };

  // Logo remove handler
  const handleLogoRemove = async (url: string) => {
    setLogoUrl(null);
    try {
      await contextApi.updateContext({ logoUrl: null });
    } catch (error) {
      console.error('Failed to remove logo:', error);
    }
  };

  // Brand images upload handler
  const handleBrandImagesUpload = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];

    try {
      const response = await uploadApi.uploadBrandImages(files);
      if (response.success) {
        // Store the regular S3 URLs temporarily
        setBrandImages(prev => [...prev, ...response.data.urls]);
        
        // Re-fetch context to get the presigned URLs
        setTimeout(async () => {
          try {
            const contextResponse = await contextApi.getContext();
            if (contextResponse.success && contextResponse.data) {
              setBrandImages((contextResponse.data as any).brandImagesPresigned || contextResponse.data.brandImages || []);
            }
          } catch (error) {
            console.error('Failed to fetch updated context:', error);
          }
        }, 1000);
        
        return response.data.urls;
      }
      throw new Error('Upload failed');
    } catch (error) {
      console.error('Brand images upload error:', error);
      throw error;
    }
  };

  // Brand image remove handler
  const handleBrandImageRemove = async (url: string) => {
    const updatedImages = brandImages.filter(img => img !== url);
    setBrandImages(updatedImages);
    
    try {
      await contextApi.updateContext({ brandImages: updatedImages });
    } catch (error) {
      console.error('Failed to remove brand image:', error);
    }
  };

  // Color picker handlers
  const handleColorEdit = (colorType: ColorType) => {
    setSelectedColorType(colorType);
    setColorPickerOpen(true);
  };

  const handleColorSelect = async (color: string) => {
    const updatedColors = { ...socialPostColors, [selectedColorType]: color };
    setSocialPostColors(updatedColors);

    if (!isEditingColors) return;

    try {
      await contextApi.updateContext({ socialPostColors: updatedColors });
      toast({
        title: "Color updated",
        description: "Social post color has been saved successfully.",
      });
    } catch (error) {
      console.error('Failed to update color:', error);
      toast({
        title: "Error",
        description: "Failed to update color. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Font selector handlers
  const handleFontEdit = (fontType: FontType) => {
    setSelectedFontType(fontType);
    setFontSelectorOpen(true);
  };

  const handleFontSelect = async (font: string) => {
    const updatedFonts = { ...brandFonts, [selectedFontType]: font };
    setBrandFonts(updatedFonts);

    if (!isEditingFonts) return;

    try {
      await contextApi.updateContext({ brandFonts: updatedFonts });
      toast({
        title: "Font updated",
        description: "Social post font has been saved successfully.",
      });
    } catch (error) {
      console.error('Failed to update font:', error);
      toast({
        title: "Error",
        description: "Failed to update font. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Save colors handler
  const handleSaveColors = async () => {
    setIsSaving(true);
    try {
      await contextApi.updateContext({ socialPostColors });
      toast({
        title: "Colors saved",
        description: "Social post colors have been updated successfully.",
      });
      setIsEditingColors(false);
    } catch (error) {
      console.error('Failed to save colors:', error);
      toast({
        title: "Error",
        description: "Failed to save colors. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Save fonts handler
  const handleSaveFonts = async () => {
    setIsSaving(true);
    try {
      await contextApi.updateContext({ brandFonts });
      toast({
        title: "Fonts saved",
        description: "Social post fonts have been updated successfully.",
      });
      setIsEditingFonts(false);
    } catch (error) {
      console.error('Failed to save fonts:', error);
      toast({
        title: "Error",
        description: "Failed to save fonts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Save brand voice handler
  const handleSaveBrandVoice = async (content: string) => {
    setIsSaving(true);
    try {
      await contextApi.updateContext({ brandStory: content });
      setBrandVoice(content);
      toast({
        title: "Brand voice saved",
        description: "Your brand voice has been updated successfully.",
      });
      setIsEditingBrandVoice(false);
    } catch (error) {
      console.error('Failed to save brand voice:', error);
      toast({
        title: "Error",
        description: "Failed to save brand voice. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-6xl mx-auto space-y-6 md:space-y-8 animate-fade-in">
        {/* Header with Logo and Title */}
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-4 md:gap-6">
          <div className="w-32 h-24 md:w-40 md:h-28 flex items-center justify-center flex-shrink-0">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <div className="text-center md:text-left space-y-2 flex-1">
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground flex items-center justify-center md:justify-start gap-2 flex-wrap px-4 md:px-0">
              <Zap className="text-accent w-6 h-6 md:w-8 md:h-8 lg:w-10 lg:h-10" />
              BAM! Here's your Brand Kit
            </h1>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          {/* Logo */}
          <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <h2 className="text-lg md:text-xl font-semibold text-foreground mb-3 md:mb-4">Logo</h2>
            <FileDropZone
              onFilesSelected={handleLogoUpload}
              currentFiles={logoUrl ? [logoUrl] : []}
              onRemove={handleLogoRemove}
              accept="image/*"
              multiple={false}
              maxFiles={1}
              uploadType="logo"
            />
          </Card>

          {/* Colors and Fonts Column */}
          <div className="space-y-4 md:space-y-6">
            {/* Social Post Colors */}
            <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
              <div className="flex items-start justify-between mb-3 md:mb-4 gap-2">
                <h2 className="text-lg md:text-xl font-semibold text-foreground">Social Post Colors</h2>
                {isEditingColors ? (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingColors(false)}
                      disabled={isSaving}
                      className="text-xs md:text-sm"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveColors}
                      disabled={isSaving}
                      className="text-xs md:text-sm"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingColors(true)} className="flex-shrink-0">
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
              </div>
              
              <div className="flex gap-3 md:gap-4 lg:gap-6 justify-center flex-wrap">
                {(['primary', 'secondary', 'accent'] as ColorType[]).map((colorType) => (
                  <button
                    key={colorType}
                    onClick={() => isEditingColors && handleColorEdit(colorType)}
                    className={`flex flex-col items-center gap-1 md:gap-2 ${isEditingColors ? 'cursor-pointer' : 'cursor-default'}`}
                    disabled={!isEditingColors}
                  >
                    <div
                      className={`w-14 h-14 md:w-16 md:h-16 lg:w-20 lg:h-20 rounded-full border-4 border-background shadow-md ${isEditingColors ? 'hover:scale-110 transition-transform' : ''}`}
                      style={{ backgroundColor: socialPostColors[colorType] }}
                    />
                    <span className="text-xs text-muted-foreground">{socialPostColors[colorType]}</span>
                  </button>
                ))}
              </div>
            </Card>

            {/* Social Post Fonts */}
            <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
              <div className="flex items-start justify-between mb-3 md:mb-4 gap-2">
                <h2 className="text-lg md:text-xl font-semibold text-foreground">Social Post Fonts</h2>
                {isEditingFonts ? (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingFonts(false)}
                      disabled={isSaving}
                      className="text-xs md:text-sm"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveFonts}
                      disabled={isSaving}
                      className="text-xs md:text-sm"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingFonts(true)} className="flex-shrink-0">
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-3 md:gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Title</p>
                  <button
                    onClick={() => isEditingFonts && handleFontEdit('title')}
                    className={`text-lg md:text-xl lg:text-2xl font-serif w-full text-left p-2 rounded border ${isEditingFonts ? 'border-primary hover:bg-primary/10 cursor-pointer' : 'border-transparent'}`}
                    style={{ fontFamily: brandFonts.title }}
                    disabled={!isEditingFonts}
                  >
                    {brandFonts.title}
                  </button>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Body</p>
                  <button
                    onClick={() => isEditingFonts && handleFontEdit('body')}
                    className={`text-lg md:text-xl lg:text-2xl w-full text-left p-2 rounded border ${isEditingFonts ? 'border-primary hover:bg-primary/10 cursor-pointer' : 'border-transparent'}`}
                    style={{ fontFamily: brandFonts.body }}
                    disabled={!isEditingFonts}
                  >
                    {brandFonts.body}
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* Images */}
          <Card className="md:col-span-2 p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="mb-3 md:mb-4">
              <h2 className="text-lg md:text-xl font-semibold text-foreground mb-1 md:mb-2">Brand Images</h2>
              <p className="text-xs md:text-sm text-muted-foreground">
                Upload inspiration images that represent your brand. We'll use these to generate similar content for you.
              </p>
            </div>
            <FileDropZone
              onFilesSelected={handleBrandImagesUpload}
              currentFiles={brandImages}
              onRemove={handleBrandImageRemove}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              multiple={true}
              maxFiles={50}
              uploadType="images"
            />
          </Card>

          {/* Brand Voice */}
          <Card className="md:col-span-2 p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-3 md:mb-4 gap-2">
              <h2 className="text-lg md:text-xl font-semibold text-foreground">Brand Voice</h2>
              {!isEditingBrandVoice && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditingBrandVoice(true)} className="flex-shrink-0">
                  <Pencil className="w-4 h-4" />
                </Button>
              )}
            </div>
            
            {isEditingBrandVoice ? (
              <RichTextEditor
                content={brandVoice}
                onSave={handleSaveBrandVoice}
                onCancel={() => setIsEditingBrandVoice(false)}
                isSaving={isSaving}
              />
            ) : (
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed whitespace-pre-line">
                {brandVoice || "Click Edit to add your brand voice"}
              </p>
            )}
          </Card>
        </div>

        <div className="flex justify-center md:justify-end pt-4 md:pt-6">
          <Button onClick={onContinue} size="lg" className="w-full md:w-auto md:min-w-[200px]">
            Continue to Content Channels
          </Button>
        </div>
      </div>

      {/* Color Picker Dialog */}
      <ColorPickerDialog
        open={colorPickerOpen}
        onOpenChange={setColorPickerOpen}
        initialColor={socialPostColors[selectedColorType]}
        onColorSelect={handleColorSelect}
        title={`Choose ${selectedColorType.charAt(0).toUpperCase() + selectedColorType.slice(1)} Color`}
      />

      {/* Font Selector Dialog */}
      <FontSelectorDialog
        open={fontSelectorOpen}
        onOpenChange={setFontSelectorOpen}
        currentFont={brandFonts[selectedFontType]}
        onFontSelect={handleFontSelect}
        title={`Select ${selectedFontType.charAt(0).toUpperCase() + selectedFontType.slice(1)} Font`}
        fontType={selectedFontType}
      />
    </div>
  );
};
