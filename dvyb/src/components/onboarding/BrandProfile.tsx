"use client";


import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Sparkles } from "lucide-react";

interface BrandProfileProps {
  onContinue: () => void;
}

export const BrandProfile = ({ onContinue }: BrandProfileProps) => {
  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center justify-center gap-2">
            Burnie AI's Brand Profile <Sparkles className="text-accent" />
          </h1>
        </div>

        <div className="grid gap-6">
          <Card className="p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-semibold text-foreground">
                Business Overview & Positioning
              </h2>
              <Button variant="ghost" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-2">Core Identity:</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Burnie AI is an innovative platform specializing in the creation of AI-powered roast videos, 
                  offering a unique and entertaining digital experience. The platform integrates blockchain technology, 
                  allowing users to connect their wallets and utilize $ROASTS tokens for transactions, thereby creating 
                  a decentralized content creation ecosystem.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Market Positioning:</h3>
                <ul className="space-y-3">
                  <li className="flex gap-3">
                    <span className="font-medium text-foreground min-w-fit">Primary Positioning:</span>
                    <span className="text-muted-foreground">
                      "Your go-to platform for hilarious AI-generated roast videos" - emphasizing the unique, 
                      humor-driven content experience
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-medium text-foreground min-w-fit">Secondary Positioning:</span>
                    <span className="text-muted-foreground">
                      "Empowering creators with decentralized AI tools" - showcasing the platform's commitment 
                      to innovation and creator empowerment
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-medium text-foreground min-w-fit">Tertiary Positioning:</span>
                    <span className="text-muted-foreground">
                      "Viral content made easy with $ROASTS tokens" - highlighting the seamless integration 
                      of cryptocurrency for digital transactions
                    </span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Direct Competitors</h3>
                <p className="text-sm font-medium text-muted-foreground mb-2">Global Competitors:</p>
                <ul className="space-y-2 ml-4">
                  <li className="text-muted-foreground">• Lumen5</li>
                  <li className="text-muted-foreground">• Synthesia</li>
                  <li className="text-muted-foreground">• DeepBrain</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Competitive Advantages:</h3>
                <ol className="space-y-2 list-decimal list-inside">
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Unique AI-driven humor content</span> that stands out in a crowded digital landscape
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Integration with blockchain technology</span> for secure and innovative transactions
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Engagement-focused platform</span> with features like leaderboards and algorithm-optimized content
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Strong community backing</span> with partnerships enhancing credibility and reach
                  </li>
                </ol>
              </div>
            </div>
          </Card>

          <Card className="p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-semibold text-foreground">
                Customer Demographics & Psychographics
              </h2>
              <Button variant="ghost" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-3">Primary Customer Segments:</h3>
                <div className="space-y-4">
                  <div>
                    <p className="font-medium text-foreground">1. Digital Content Creators (40%)</p>
                    <ul className="mt-2 ml-6 space-y-1">
                      <li className="text-muted-foreground">• Individuals seeking innovative tools to enhance content creation</li>
                      <li className="text-muted-foreground">• Tech-savvy digital marketers</li>
                      <li className="text-muted-foreground">
                        <span className="font-medium text-foreground">Key need:</span> Cutting-edge technology to stay ahead in content trends
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p className="font-medium text-foreground">2. Social Media Influencers (35%)</p>
                    <ul className="mt-2 ml-6 space-y-1">
                      <li className="text-muted-foreground">• Users aiming to increase engagement and followers</li>
                      <li className="text-muted-foreground">• Platforms: Instagram, TikTok, YouTube</li>
                      <li className="text-muted-foreground">
                        <span className="font-medium text-foreground">Pain points:</span> Need for differentiated content to stand out
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p className="font-medium text-foreground">3. Tech Enthusiasts and Cryptocurrency Users (25%)</p>
                    <ul className="mt-2 ml-6 space-y-1">
                      <li className="text-muted-foreground">• Early adopters of blockchain technology</li>
                      <li className="text-muted-foreground">• Individuals interested in decentralized platforms and digital currency</li>
                      <li className="text-muted-foreground">
                        <span className="font-medium text-foreground">Key interest:</span> Innovative uses of cryptocurrency in content creation
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-semibold text-foreground">
                Most Popular Products & Services
              </h2>
              <Button variant="ghost" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-foreground mb-3">Top Revenue Generators (based on website prominence):</h3>
                <ol className="space-y-2 list-decimal list-inside">
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">AI-Powered Roast Video Generation</span> - Core service enabling users to create humorous content
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">$ROASTS Tokens</span> - Cryptocurrency used for transactions within the platform
                  </li>
                </ol>
              </div>
            </div>
          </Card>

          <Card className="p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-semibold text-foreground">
                Why Customers Choose Burnie AI
              </h2>
              <Button variant="ghost" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-3">Primary Value Drivers:</h3>
                <ol className="space-y-2 list-decimal list-inside">
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Innovation:</span> Cutting-edge AI technology for unique content creation
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Community Engagement:</span> Active user base with opportunities for interaction and competition
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Decentralization:</span> Secure and transparent transactions through blockchain integration
                  </li>
                  <li className="text-muted-foreground">
                    <span className="font-medium text-foreground">Revenue Potential:</span> Opportunities for creators to earn through content and token engagement
                  </li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Emotional Benefits:</h3>
                <ul className="space-y-2 ml-4">
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Excitement:</span> Engaging in a platform that offers novel and entertaining experiences
                  </li>
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Empowerment:</span> Tools that enable creators to innovate and earn
                  </li>
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Community:</span> Joining a vibrant network of creators and tech enthusiasts
                  </li>
                </ul>
              </div>
            </div>
          </Card>

          <Card className="p-8 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start justify-between mb-6">
              <h2 className="text-2xl font-semibold text-foreground">
                The Burnie AI Brand Story
              </h2>
              <Button variant="ghost" size="sm">
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  <span className="font-semibold text-foreground">The Hero's Journey:</span> Burnie AI emerged from the vision of creating a platform that merges entertainment with advanced technology. By leveraging AI and blockchain, Burnie AI offers a unique space where creativity and tech-savvy users can thrive. The brand's journey reflects a commitment to innovation and community empowerment, providing users with tools to create, engage, and earn in a decentralized environment.
                </p>
              </div>

              <div>
                <p className="text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Mission Statement:</span> "To revolutionize digital content creation through AI and blockchain, empowering creators to innovate, engage, and earn."
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-3">Brand Personality:</h3>
                <ul className="space-y-2 ml-4">
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Archetype:</span> The Creator-Innovator (pioneering and imaginative)
                  </li>
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Voice:</span> Bold, engaging, and tech-forward
                  </li>
                  <li className="text-muted-foreground">
                    • <span className="font-medium text-foreground">Values:</span> Innovation, community, empowerment, humor, decentralization
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-muted-foreground leading-relaxed">
                  Burnie AI positions itself as more than just a content creation tool—it's a dynamic platform where humor meets technology, empowering users to express themselves in unique and profitable ways.
                </p>
              </div>
            </div>
          </Card>

          <div className="flex justify-end pt-4">
            <Button onClick={onContinue} size="lg" className="min-w-[200px]">
              Continue to Brand Kit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
