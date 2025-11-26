"use client";


import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Edit, Trash2, Upload, HelpCircle, Image as ImageIcon } from "lucide-react";
import logo from "@/assets/logo.png";

export const BrandKitPage = () => {
  const [activeTab, setActiveTab] = useState("source-materials");

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-8">
            <TabsTrigger value="source-materials">Source Materials</TabsTrigger>
            <TabsTrigger value="images-video">Images & Video</TabsTrigger>
            <TabsTrigger value="brand-profile">Brand Profile</TabsTrigger>
            <TabsTrigger value="styles-voice">Styles & Voice</TabsTrigger>
            <TabsTrigger value="content-preferences">Content Preferences</TabsTrigger>
          </TabsList>

          {/* Source Materials Tab */}
          <TabsContent value="source-materials">
            <div className="space-y-8">
              {/* Webpages Section */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Webpages <Badge variant="secondary" className="ml-2">3</Badge></h3>
                <Card className="p-6">
                  <div className="space-y-3">
                    {[
                      { emoji: "🔥", name: "burnie", url: "burnie.io" },
                      { emoji: "🔥", name: "Altv Stream", url: "https://burnie.io/altv-stream" },
                      { emoji: "🔥", name: "Terms And Conditions", url: "https://burnie.io/terms-and-conditions" }
                    ].map((page, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{page.emoji}</span>
                          <div>
                            <p className="font-medium text-foreground">{page.name}</p>
                            <p className="text-sm text-muted-foreground">{page.url}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon"><Edit className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="link" className="text-primary gap-2">
                      <Plus className="w-4 h-4" />
                      Add More
                    </Button>
                  </div>
                </Card>
              </div>

              {/* Integrations Section */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Integrations <Badge variant="secondary" className="ml-2">0</Badge></h3>
                <Card className="p-12 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Plus className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-2">New Integration</p>
                </Card>
              </div>

              {/* Files Section */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Files <Badge variant="secondary" className="ml-2">0</Badge></h3>
                <Card className="p-12 flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Plus className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-2">Add File</p>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Images & Video Tab */}
          <TabsContent value="images-video">
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Today</h3>
                <div className="flex items-center justify-center h-32 bg-blue-50 rounded-lg">
                  <ImageIcon className="w-12 h-12 text-blue-400" />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Yesterday</h3>
                <div className="grid grid-cols-8 gap-3">
                  {Array(16).fill(0).map((_, i) => {
                    const images = [
                      '/brand-1.jpg', '/brand-2.jpg', '/brand-3.jpg', '/brand-4.jpg',
                      '/brand-5.jpg', '/brand-6.jpg', '/brand-7.jpg', '/brand-8.jpg',
                      '/brand-9.jpg', '/brand-10.jpg'
                    ];
                    return (
                      <div key={i} className="aspect-square rounded-lg overflow-hidden">
                        <img 
                          src={images[i % images.length]} 
                          alt={`Brand content ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    );
                  })}
                </div>
                <Button variant="outline" className="mt-4 w-full">Show 5 more images</Button>
              </div>
            </div>
          </TabsContent>

          {/* Brand Profile Tab */}
          <TabsContent value="brand-profile">
            <div className="space-y-8">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-foreground">Business Overview & Positioning</h3>
                  <Button variant="link" className="gap-2">
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                </div>
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Core Identity:</h4>
                    <p className="text-sm text-foreground leading-relaxed">
                      Burnie AI is an innovative platform specializing in the creation of AI-powered roast videos, offering a unique and entertaining digital experience. The platform integrates blockchain technology, allowing users to connect their wallets and utilize $ROASTS tokens for transactions, thereby creating a decentralized content creation ecosystem.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Market Positioning:</h4>
                    <ul className="space-y-2 text-sm">
                      <li><strong>Primary Positioning:</strong> "Your go-to platform for hilarious AI-generated roast videos" - emphasizing the unique, humor-driven content experience</li>
                      <li><strong>Secondary Positioning:</strong> "Empowering creators with decentralized AI tools" - showcasing the platform's commitment to innovation and creator empowerment</li>
                      <li><strong>Tertiary Positioning:</strong> "Viral content made easy with $ROASTS tokens" - highlighting the seamless integration of cryptocurrency for digital transactions</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Direct Competitors</h4>
                    <p className="text-sm font-semibold mb-1">Global Competitors:</p>
                    <ul className="list-disc list-inside text-sm space-y-1 ml-4">
                      <li>Lumen5</li>
                      <li>Synthesia</li>
                      <li>DeepBrain</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Competitive Advantages:</h4>
                    <ol className="list-decimal list-inside text-sm space-y-1 ml-4">
                      <li><strong>Unique AI-driven humor content</strong> that stands out in a crowded digital landscape</li>
                      <li><strong>Integration with blockchain technology</strong> for secure and innovative transactions</li>
                      <li><strong>Engagement-focused platform</strong> with features like leaderboards and algorithm-optimized content</li>
                      <li><strong>Strong community backing</strong> with partnerships enhancing credibility and reach</li>
                    </ol>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-foreground">Customer Demographics & Psychographics</h3>
                  <Button variant="link" className="gap-2">
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Primary Customer Segments:</h4>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold">1. Digital Content Creators (40%)</p>
                        <ul className="list-disc list-inside text-sm space-y-1 ml-4 mt-1">
                          <li>Individuals seeking innovative tools to enhance content creation</li>
                          <li>Tech-savvy digital marketers</li>
                          <li><strong>Key need:</strong> Cutting-edge technology to stay ahead in content trends</li>
                        </ul>
                      </div>
                      <div>
                        <p className="text-sm font-semibold">2. Social Media Influencers (35%)</p>
                        <ul className="list-disc list-inside text-sm space-y-1 ml-4 mt-1">
                          <li>Users aiming to increase engagement and followers</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Styles & Voice Tab */}
          <TabsContent value="styles-voice">
            <div className="grid grid-cols-2 gap-8">
              {/* Brand Styles */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold text-foreground">Brand Styles</h3>
                  <Button variant="link" className="gap-2">
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Visual Identity Description</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-foreground">Bold graphics, vibrant orange accents, futuristic AI theme, playful character illustrations, tech-driven appeal.</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Visual Identity Keywords</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["Bold", "Vibrant orange", "Futuristic", "AI theme", "Playful", "Tech-driven"].map((keyword) => (
                        <Badge key={keyword} variant="secondary">{keyword}</Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-3">Logos</h4>
                    <p className="text-xs text-muted-foreground mb-3">Primary Logos <HelpCircle className="w-3 h-3 inline ml-1" /></p>
                    <div className="grid grid-cols-3 gap-3">
                      <Card className="p-4">
                        <div className="w-12 h-12 mb-2 flex items-center justify-center">
                          <img src={logo.src} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                        <p className="text-xs font-medium mb-2">Original</p>
                        <div className="space-y-1">
                          <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                            <Upload className="w-3 h-3" />
                            Upload
                          </Button>
                          <Button variant="ghost" size="sm" className="w-full text-xs">
                            Regenerate
                          </Button>
                        </div>
                      </Card>
                      <Card className="p-4">
                        <div className="flex items-center justify-center h-full text-xs font-medium text-muted-foreground">Dark</div>
                      </Card>
                      <Card className="p-4">
                        <div className="flex items-center justify-center h-full text-xs font-medium text-muted-foreground">Light</div>
                      </Card>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs text-muted-foreground mb-3">Additional Logos <HelpCircle className="w-3 h-3 inline ml-1" /></p>
                      <Card className="p-8 border-2 border-dashed flex flex-col items-center justify-center">
                        <div className="text-3xl mb-2">💎</div>
                        <p className="text-sm text-muted-foreground mb-2">Drop your logo here or</p>
                        <Button variant="ghost" className="gap-2">
                          <Upload className="w-4 h-4" />
                          Choose File
                        </Button>
                      </Card>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-foreground">Colors</h4>
                      <Button variant="link" className="text-xs gap-1">
                        <Plus className="w-3 h-3" />
                        New Color
                      </Button>
                    </div>
                    <div className="flex gap-3">
                      {[
                        { color: "#220808", label: "#220808" },
                        { color: "#f97316", label: "#f97316" },
                        { color: "#368405", label: "#368405" },
                        { color: "#ffffff", label: "#ffffff" }
                      ].map((item) => (
                        <div key={item.label}>
                          <div
                            className="w-12 h-12 rounded-full border-2 border-border mb-1"
                            style={{ backgroundColor: item.color }}
                          />
                          <p className="text-xs text-center">{item.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-foreground">Fonts</h4>
                      <Button variant="link" className="text-xs gap-1">
                        <Edit className="w-3 h-3" />
                        Manage Fonts
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Brand Voice */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold text-foreground">Brand Voice</h3>
                  <Button variant="link" className="gap-2">
                    <Edit className="w-4 h-4" />
                    Edit
                  </Button>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Purpose</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-foreground">Promote the creation of AI-powered roast videos, Encourage participation in live streaming events, Facilitate transactions using $ROASTS tokens, Highlight earning opportunities through engagement and content creation</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Audience</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-foreground">Content creators looking for innovative tools, Individuals interested in humor and entertainment, Cryptocurrency users and enthusiasts, Viewers of live streaming content</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Tone</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["Energetic and upbeat", "Playful with a touch of irreverence", "Inviting and community-focused"].map((tone) => (
                        <Badge key={tone} variant="secondary" className="text-xs">{tone}</Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Emotions</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["Excitement for engaging content", "Humor and light-heartedness", "A sense of belonging to a creative community"].map((emotion) => (
                        <Badge key={emotion} variant="secondary" className="text-xs">{emotion}</Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Character</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["A fun-loving and entertaining host", "An innovative tech-savvy brand", "A supportive community leader encouraging participation"].map((character) => (
                        <Badge key={character} variant="secondary" className="text-xs">{character}</Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Syntax</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["Use short, punchy sentences for impact", "Incorporate calls to action frequently", "Utilize bullet points or lists for clarity when necessary"].map((syntax) => (
                        <Badge key={syntax} variant="secondary" className="text-xs">{syntax}</Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-foreground">Language</h4>
                      <HelpCircle className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-foreground">Employ casual and accessible language with some slang</p>
                      <p className="text-sm text-foreground">Use humor and playful expressions</p>
                      <p className="text-sm text-foreground">Integrate cryptocurrency jargon where relevant</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Content Preferences Tab */}
          <TabsContent value="content-preferences">
            <div className="space-y-8">
              <Card className="p-6">
                <h3 className="text-xl font-semibold text-foreground mb-6">Design Preferences</h3>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Featured Media</h4>
                    <p className="text-xs text-muted-foreground mb-3">Select the type of media you prefer to spotlight in your social posts.</p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox id="text" defaultChecked />
                        <label htmlFor="text" className="text-sm">Text</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="image" defaultChecked />
                        <label htmlFor="image" className="text-sm">Image</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="video" defaultChecked />
                        <label htmlFor="video" className="text-sm">Video</label>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">By default, we generate a mix of social posts featuring text-only, an image, or a video.</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Brand Kit Media Priority</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set your preferred priority for using your Brand Kit media versus stock media (images, videos) in content.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">Only my Brand Kit</Button>
                      <Button variant="default" size="sm">Brand Kit first</Button>
                      <Button variant="outline" size="sm">Only stock</Button>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">We pick the most relevant images/videos for your content and only use each Brand Kit media once per batch. We'll send you email reminders to upload more media when running low. When uploading new media, please wait 1-2 minutes before regenerating content.</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Reusing Brand Kit Media</h4>
                    <p className="text-xs text-muted-foreground mb-3">When generating content, Dvyb will search for relevant images and video in your Brand Kit. Brand kit media will be re-used when no other media are available. You currently have 18 images, 0 videos available.</p>
                    <Button variant="link" className="text-xs p-0">Add to Media Library ↗</Button>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm">Never re-use</Button>
                      <Button variant="default" size="sm">Re-use after 3 weeks</Button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Checkbox id="blog-images" defaultChecked />
                      <label htmlFor="blog-images" className="text-sm font-medium">Always include images on blog posts</label>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-xl font-semibold text-foreground mb-6">Content Preferences</h3>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Content Language</h4>
                    <p className="text-xs text-muted-foreground mb-3">Select the language for your content.</p>
                    <Select defaultValue="en-us">
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-us">English (US)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Topics to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude these topics from your Brand Plan when generating content.</p>
                    <Button variant="link" className="text-xs gap-1 p-0">
                      <Plus className="w-3 h-3" />
                      Add more
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Words and Phrases to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll avoid using any of these words or phrases in your content.</p>
                    <Button variant="link" className="text-xs gap-1 p-0">
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Blog Keywords</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll use these target keywords when generating content for SEO.</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {["AI-powered roast videos", "$ROASTS tokens", "viral content", "AITV livestream", "decentralized AI content creation"].map((keyword) => (
                        <Badge key={keyword} variant="secondary" className="gap-1">
                          {keyword}
                          <button className="ml-1">×</button>
                        </Badge>
                      ))}
                    </div>
                    <Button variant="link" className="text-xs gap-1 p-0">
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Blog External Links</h4>
                    <p className="text-xs text-muted-foreground mb-3">External links improve your blog content's ranking on search engines by referencing sources with higher authority.</p>
                    <div className="flex items-center gap-2">
                      <Checkbox id="external-links" defaultChecked />
                      <label htmlFor="external-links" className="text-sm">Always include external links on blog posts</label>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">External URLs to Avoid</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude these domains when generating content.</p>
                    <Button variant="link" className="text-xs gap-1 p-0">
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Hashtags</h4>
                    <p className="text-xs text-muted-foreground mb-3">We'll exclude or include these hashtags when generating content.</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Avoid</p>
                        <Button variant="link" className="text-xs gap-1 p-0">
                          <Plus className="w-3 h-3" />
                          Add
                        </Button>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Include</p>
                        <Button variant="link" className="text-xs gap-1 p-0">
                          <Plus className="w-3 h-3" />
                          Add
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-medium text-foreground mb-2">Hashtag Frequency</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">Never</Button>
                        <Button variant="default" size="sm">Sometimes</Button>
                        <Button variant="outline" size="sm">Always</Button>
                      </div>
                      <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                        <p className="text-xs text-foreground">Tip: Hashtags can support trends or organize content, but most platforms now prioritize keywords, engagement, and relevance over hashtags for reach.</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Logo Frequency</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set how often you'd like to include a logo in your social posts.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">Never</Button>
                      <Button variant="default" size="sm">Sometimes</Button>
                      <Button variant="outline" size="sm">Always</Button>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 border-l-4 border-primary">
                      <p className="text-xs text-foreground">Include a logo in some posts. (Approximately 3-5 in every 10 posts)</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-xl font-semibold text-foreground mb-6">Call-to-Action Preferences</h3>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Link</h4>
                    <p className="text-xs text-muted-foreground mb-3">Add the website URL you want Dvyb to drive traffic to across all content types.</p>
                    <Button variant="link" className="text-xs gap-1 p-0">
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Copy</h4>
                    <p className="text-xs text-muted-foreground mb-3">Add the copy or text to show for a hyperlink. Typically, this is the action you want to drive.</p>
                    <Input placeholder="Examples: Learn More, Buy Now, Visit Us, Schedule Call" className="max-w-md" />
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">Call-to-Action Frequency</h4>
                    <p className="text-xs text-muted-foreground mb-3">Set how often you'd like to include a link in your captions for social posts.</p>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
