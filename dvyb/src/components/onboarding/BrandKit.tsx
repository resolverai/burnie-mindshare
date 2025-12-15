"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi, uploadApi, adhocGenerationApi } from "@/lib/api";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

interface BrandKitProps {
  onContinue: (productImageS3Key?: string) => void;
}

export const BrandKit = ({ onContinue }: BrandKitProps) => {
  const { accountId } = useAuth();
  const { toast } = useToast();

  // Carousel state
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  
  // State
  const [brandName, setBrandName] = useState<string>("Your Brand");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [productImageS3Key, setProductImageS3Key] = useState<string | null>(null);

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

  // Product image upload handler (same as how GenerateContentDialog handles user_images)
  const handleProductImageUpload = async (files: File[]): Promise<string[]> => {
    if (files.length === 0) return [];

    try {
      // Upload to S3 and get presigned URL for preview
      const s3Url = await adhocGenerationApi.uploadImage(files[0]);
      
      // Store both the presigned URL (for display) and extract S3 key (for API)
      setProductImageUrl(s3Url);
      setProductImageS3Key(adhocGenerationApi.extractS3Key(s3Url));
      
      return [s3Url];
    } catch (error: any) {
      console.error('Product image upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload product image. Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Product image remove handler
  const handleProductImageRemove = (url: string) => {
    setProductImageUrl(null);
    setProductImageS3Key(null);
  };

  const handleProceed = () => {
    // Pass the product image S3 key to the parent for API call
    onContinue(productImageS3Key || undefined);
  };

  const goToNextStep = () => {
    if (currentStep === 1 && logoUrl) {
      setCurrentStep(2);
    }
  };

  const goToPrevStep = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
    }
  };

  return (
    <div 
      className="min-h-screen p-4 md:p-6 lg:p-8"
      style={{
        backgroundImage: 'url(/onboarding-bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="max-w-6xl mx-auto space-y-6 md:space-y-8 animate-fade-in">
        {/* Header with Logo and Title */}
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-4 md:gap-6">
          <div className="w-32 h-24 md:w-40 md:h-28 flex items-center justify-center flex-shrink-0">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <div className="text-center md:text-left space-y-2 flex-1">
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground flex items-center justify-center md:justify-start gap-2 flex-wrap px-4 md:px-0">
              <Zap className="text-accent w-6 h-6 md:w-8 md:h-8 lg:w-10 lg:h-10" />
              Let's personalize your content
            </h1>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          <div className={`w-3 h-3 rounded-full transition-colors ${currentStep === 1 ? 'bg-primary' : 'bg-white/30'}`} />
          <div className={`w-3 h-3 rounded-full transition-colors ${currentStep === 2 ? 'bg-primary' : 'bg-white/30'}`} />
        </div>

        {/* Carousel Content */}
        <div className="w-full max-w-3xl mx-auto px-4 md:px-8">
          {/* Step 1: Logo Upload */}
          {currentStep === 1 && (
            <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow animate-fade-in">
              <h2 className="text-lg md:text-xl font-semibold text-foreground mb-3 md:mb-4">
                Verify or Upload Your Logo
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                We detected this logo from your website. Verify it's correct or upload a new one. 
                Your logo will be used in your generated social media content.
              </p>
              <div className="min-h-[200px] md:min-h-[280px]">
                <FileDropZone
                  onFilesSelected={handleLogoUpload}
                  currentFiles={logoUrl ? [logoUrl] : []}
                  onRemove={handleLogoRemove}
                  accept="image/*"
                  multiple={false}
                  maxFiles={1}
                  uploadType="logo"
                />
              </div>
              
              {/* Next button for Step 1 */}
              <div className="mt-6 flex justify-end">
                <Button 
                  onClick={goToNextStep}
                  disabled={!logoUrl}
                  size="lg"
                  className="gap-2 min-w-[150px] btn-gradient-cta"
                >
                  Next
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
              {!logoUrl && (
                <p className="text-sm text-muted-foreground text-center md:text-right mt-2">
                  Please upload your brand logo to continue
                </p>
              )}
            </Card>
          )}

          {/* Step 2: Product Image (Optional) */}
          {currentStep === 2 && (
            <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow animate-fade-in">
              <h2 className="text-lg md:text-xl font-semibold text-foreground mb-3 md:mb-4">
                Add a Product Image (Optional)
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Upload a product image to see it featured in your first generated content. 
                This creates a highly personalized experience tailored to your brand!
              </p>
              <div className="min-h-[200px] md:min-h-[280px]">
                <FileDropZone
                  onFilesSelected={handleProductImageUpload}
                  currentFiles={productImageUrl ? [productImageUrl] : []}
                  onRemove={handleProductImageRemove}
                  accept="image/*"
                  multiple={false}
                  maxFiles={1}
                  uploadType="images"
                />
              </div>
              
              {/* Navigation buttons for Step 2 */}
              <div className="mt-6 flex justify-between items-center">
                <Button 
                  onClick={goToPrevStep}
                  variant="outline"
                  size="lg"
                  className="gap-2"
                >
                  <ChevronLeft className="w-5 h-5" />
                  Back
                </Button>
                
                <Button 
                  onClick={handleProceed}
                  size="lg"
                  className="gap-2 min-w-[150px] btn-gradient-cta"
                >
                  Proceed
                </Button>
              </div>
              <p className="text-sm text-muted-foreground text-center mt-4">
                {productImageUrl 
                  ? "Great! Your product will be featured in your first content."
                  : "You can skip this step - we'll generate content without a product image."}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
