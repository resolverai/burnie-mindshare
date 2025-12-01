"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Pencil } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useToast } from "@/hooks/use-toast";

interface AnalysisDetailsProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
}

interface AnalysisData {
  base_name: string;
  business_overview_and_positioning: string;
  customer_demographics_and_psychographics: string;
  most_popular_products_and_services: string[];
  why_customers_choose: string;
  brand_story: string;
  color_palette: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}

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
                               line.match(/^(Core Identity|Market Positioning|Direct Competitors|Competitive Advantages|Primary Customer Segments|Key need|Pain points|Key interest|Top Revenue Generators|Primary Value Drivers|Emotional Benefits|The Hero's Journey|Mission Statement|Brand Personality|Archetype|Voice|Values):/);
        
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
        if (line.match(/^\d+\.\s/) || line.match(/^•\s/)) {
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

type EditSection = 'overview' | 'demographics' | 'products' | 'why' | 'story' | null;

export const AnalysisDetails = ({ onContinue, isAuthenticated: isAuthenticatedProp }: AnalysisDetailsProps) => {
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isMounted, setIsMounted] = useState(false);
  const [editingSection, setEditingSection] = useState<EditSection>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { isAuthenticated: authContextAuthenticated } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  // Use prop if provided, otherwise use context
  const isAuthenticated = isAuthenticatedProp !== undefined ? isAuthenticatedProp : authContextAuthenticated;
  
  // Handle Edit button click - navigate to auth if not authenticated, or enter edit mode
  const handleEditClick = (section: EditSection) => {
    if (!isAuthenticated) {
      router.push('/auth/login');
    } else {
      setEditingSection(section);
    }
  };

  // Handle save for a section - only updates localStorage, not database
  // Database save happens when clicking "Continue to Brand Kit"
  const handleSave = async (section: EditSection, content: string) => {
    if (!section || !analysisData) return;

    setIsSaving(true);
    try {
      // Map section to local state key
      const dataMap: Record<string, keyof AnalysisData> = {
        overview: 'business_overview_and_positioning',
        demographics: 'customer_demographics_and_psychographics',
        products: 'most_popular_products_and_services',
        why: 'why_customers_choose',
        story: 'brand_story',
      };

      const dataKey = dataMap[section];
      
      // For products, convert to array
      const updatedValue = section === 'products' 
        ? content.split('\n').filter(p => p.trim())
        : content;

      // Update local state
      setAnalysisData(prev => prev ? {
        ...prev,
        [dataKey]: updatedValue
      } : null);

      // Update localStorage
      const storedAnalysis = localStorage.getItem('dvyb_website_analysis');
      if (storedAnalysis) {
        const parsed = JSON.parse(storedAnalysis);
        parsed[dataKey] = updatedValue;
        localStorage.setItem('dvyb_website_analysis', JSON.stringify(parsed));
        console.log('✅ Updated localStorage with edited content');
      }

      toast({
        title: "Saved!",
        description: "Your changes have been saved locally.",
      });

      setEditingSection(null);
    } catch (error) {
      console.error('Failed to save section:', error);
      toast({
        title: "Error",
        description: "Failed to save changes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    
    // ALWAYS load from localStorage on this page
    // Database save happens only when clicking "Continue to Brand Kit"
    const loadFromLocalStorage = () => {
      console.log('ℹ️ Loading analysis from localStorage...');
      const storedAnalysis = localStorage.getItem('dvyb_website_analysis');
      const storedUrl = localStorage.getItem('dvyb_pending_website_url');
      
      if (storedAnalysis) {
        setAnalysisData(JSON.parse(storedAnalysis));
        console.log('✅ Analysis loaded from localStorage');
      } else {
        console.warn('⚠️ No analysis found in localStorage');
      }
      
      if (storedUrl) {
        setWebsiteUrl(storedUrl);
      }
    };
    
    loadFromLocalStorage();
  }, []);

  // Don't render until mounted (prevents hydration mismatch)
  if (!isMounted) {
    return null;
  }

  if (!analysisData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-muted-foreground">
            Loading analysis...
          </p>
        </div>
      </div>
    );
  }

  const baseName = analysisData.base_name || 'Your Brand';
  const capitalizedBaseName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-fade-in">
        {/* Header with Logo and Title */}
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-4 md:gap-6">
          <div className="w-32 h-24 md:w-40 md:h-28 flex items-center justify-center flex-shrink-0">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <div className="text-center md:text-left space-y-2 flex-1">
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground flex items-center justify-center md:justify-start gap-2 flex-wrap">
              {capitalizedBaseName}'s Brand Profile <Sparkles className="text-accent w-6 h-6 md:w-7 md:h-7" />
            </h1>
            {websiteUrl && (
              <p className="text-sm md:text-base text-muted-foreground break-all">{websiteUrl}</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:gap-6">
          {/* Business Overview & Positioning */}
          <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-4 md:mb-6 gap-4">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                Business Overview & Positioning
              </h2>
              {editingSection !== 'overview' && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 hover:bg-transparent hover:text-current" onClick={() => handleEditClick('overview')}>
                  <Pencil className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
            </div>

            <div className="space-y-3 md:space-y-4">
              {editingSection === 'overview' ? (
                <RichTextEditor
                  content={analysisData.business_overview_and_positioning}
                  onSave={(content) => handleSave('overview', content)}
                  onCancel={() => setEditingSection(null)}
                  isSaving={isSaving}
                />
              ) : (
                <FormattedText text={analysisData.business_overview_and_positioning} />
              )}
            </div>
          </Card>

          {/* Customer Demographics & Psychographics */}
          <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-4 md:mb-6 gap-4">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                Customer Demographics & Psychographics
              </h2>
              {editingSection !== 'demographics' && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 hover:bg-transparent hover:text-current" onClick={() => handleEditClick('demographics')}>
                  <Pencil className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
            </div>

            <div className="space-y-3 md:space-y-4">
              {editingSection === 'demographics' ? (
                <RichTextEditor
                  content={analysisData.customer_demographics_and_psychographics}
                  onSave={(content) => handleSave('demographics', content)}
                  onCancel={() => setEditingSection(null)}
                  isSaving={isSaving}
                />
              ) : (
                <FormattedText text={analysisData.customer_demographics_and_psychographics} />
              )}
            </div>
          </Card>

          {/* Most Popular Products & Services */}
          <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-4 md:mb-6 gap-4">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                Most Popular Products & Services
              </h2>
              {editingSection !== 'products' && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 hover:bg-transparent hover:text-current" onClick={() => handleEditClick('products')}>
                  <Pencil className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
            </div>

            <div className="space-y-3 md:space-y-4">
              {editingSection === 'products' ? (
                <RichTextEditor
                  content={analysisData.most_popular_products_and_services?.join('\n') || ''}
                  onSave={(content) => handleSave('products', content)}
                  onCancel={() => setEditingSection(null)}
                  isSaving={isSaving}
                />
              ) : (
                analysisData.most_popular_products_and_services && analysisData.most_popular_products_and_services.length > 0 ? (
                  <ol className="space-y-3 list-decimal list-inside text-muted-foreground">
                    {analysisData.most_popular_products_and_services.map((product, index) => {
                      // Check if product contains a colon or dash to bold the prefix
                      const colonMatch = product.match(/^(.+?)(:|–|—)(.*)$/);
                      
                      if (colonMatch) {
                        const [, boldText, separator, rest] = colonMatch;
                        return (
                          <li key={index} className="leading-relaxed">
                            <span className="font-semibold text-foreground">{boldText}{separator}</span>{rest}
                          </li>
                        );
                      }
                      
                      return (
                        <li key={index} className="leading-relaxed">
                          {product}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-muted-foreground">No products or services data available.</p>
                )
              )}
            </div>
          </Card>

          {/* Why Customers Choose */}
          <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-4 md:mb-6 gap-4">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                Why Customers Choose {capitalizedBaseName}
              </h2>
              {editingSection !== 'why' && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 hover:bg-transparent hover:text-current" onClick={() => handleEditClick('why')}>
                  <Pencil className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
            </div>

            <div className="space-y-3 md:space-y-4">
              {editingSection === 'why' ? (
                <RichTextEditor
                  content={analysisData.why_customers_choose}
                  onSave={(content) => handleSave('why', content)}
                  onCancel={() => setEditingSection(null)}
                  isSaving={isSaving}
                />
              ) : (
                <FormattedText text={analysisData.why_customers_choose} />
              )}
            </div>
          </Card>

          {/* Brand Story */}
          <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-4 md:mb-6 gap-4">
              <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                The {capitalizedBaseName} Brand Story
              </h2>
              {editingSection !== 'story' && (
                <Button variant="ghost" size="sm" className="flex-shrink-0 hover:bg-transparent hover:text-current" onClick={() => handleEditClick('story')}>
                  <Pencil className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
            </div>

            <div className="space-y-3 md:space-y-4">
              {editingSection === 'story' ? (
                <RichTextEditor
                  content={analysisData.brand_story}
                  onSave={(content) => handleSave('story', content)}
                  onCancel={() => setEditingSection(null)}
                  isSaving={isSaving}
                />
              ) : (
                <FormattedText text={analysisData.brand_story} />
              )}
            </div>
          </Card>

          {/* Color Palette - Only show if we have colors */}
          {analysisData.color_palette && (analysisData.color_palette.primary || analysisData.color_palette.secondary || analysisData.color_palette.accent) && (
            <Card className="p-6 md:p-8 shadow-card hover:shadow-card-hover transition-shadow">
              <div className="mb-4 md:mb-6">
                <h2 className="text-xl md:text-2xl font-semibold text-foreground">
                  Brand Color Palette
                </h2>
              </div>

              <div className="flex flex-wrap gap-4 md:gap-6 justify-center md:justify-start">
                {analysisData.color_palette.primary && (
                  <div className="flex flex-col items-center gap-2 md:gap-3">
                    <div 
                      className="w-20 h-20 md:w-24 md:h-24 rounded-lg shadow-md border-2 border-border"
                      style={{ backgroundColor: analysisData.color_palette.primary }}
                    ></div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Primary</p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {analysisData.color_palette.primary}
                      </p>
                    </div>
                  </div>
                )}
                {analysisData.color_palette.secondary && (
                  <div className="flex flex-col items-center gap-2 md:gap-3">
                    <div 
                      className="w-20 h-20 md:w-24 md:h-24 rounded-lg shadow-md border-2 border-border"
                      style={{ backgroundColor: analysisData.color_palette.secondary }}
                    ></div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Secondary</p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {analysisData.color_palette.secondary}
                      </p>
                    </div>
                  </div>
                )}
                {analysisData.color_palette.accent && (
                  <div className="flex flex-col items-center gap-2 md:gap-3">
                    <div 
                      className="w-20 h-20 md:w-24 md:h-24 rounded-lg shadow-md border-2 border-border"
                      style={{ backgroundColor: analysisData.color_palette.accent }}
                    ></div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Accent</p>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {analysisData.color_palette.accent}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          <div className="flex justify-center md:justify-end pt-4 md:pt-6">
            <Button onClick={onContinue} size="lg" className="w-full md:w-auto md:min-w-[200px]">
              {isAuthenticated ? 'Continue to Brand Kit' : 'Sign in to Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

