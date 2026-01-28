"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, Play, Clock, Sparkles } from "lucide-react";

interface TemplatesTabProps {
  searchQuery: string;
}

// Mock templates data - these should eventually come from the backend
const templates = [
  {
    id: "1",
    name: "Product Showcase",
    thumbnail: "/placeholder.svg",
    duration: 30,
    category: "Marketing",
    aiPowered: true,
  },
  {
    id: "2",
    name: "Social Media Intro",
    thumbnail: "/placeholder.svg",
    duration: 15,
    category: "Social",
    aiPowered: true,
  },
  {
    id: "3",
    name: "Tutorial Template",
    thumbnail: "/placeholder.svg",
    duration: 60,
    category: "Education",
    aiPowered: false,
  },
  {
    id: "4",
    name: "Corporate Presentation",
    thumbnail: "/placeholder.svg",
    duration: 45,
    category: "Business",
    aiPowered: true,
  },
];

const categories = ["All", "Marketing", "Social", "Education", "Business", "Events", "Podcast"];

export function TemplatesTab({ searchQuery }: TemplatesTabProps) {
  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Categories */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <button
              key={category}
              className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-secondary/50 hover:bg-secondary transition-colors"
            >
              {category}
            </button>
          ))}
        </div>

        {/* Templates Grid */}
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="group relative rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("template", JSON.stringify(template));
              }}
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-secondary relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.thumbnail}
                  alt={template.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
                  </div>
                </div>

                {/* AI badge */}
                {template.aiPowered && (
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/80 text-[8px] text-white font-medium">
                    <Sparkles className="h-2.5 w-2.5" />
                    AI
                  </div>
                )}

                {/* Info */}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-[10px] text-white font-medium truncate">
                    {template.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-white/70">{template.category}</span>
                    <div className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5 text-white/70" />
                      <span className="text-[9px] text-white/70">
                        {formatDuration(template.duration)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No templates found</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
