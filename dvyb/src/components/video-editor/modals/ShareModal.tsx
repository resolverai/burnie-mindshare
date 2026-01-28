"use client";

import { useState } from "react";
import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { X, Share2, Link, Copy, Check, Mail, Twitter, Facebook, Linkedin, Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShareModal({ isOpen, onClose }: ShareModalProps) {
  const { state } = useVideoEditor();
  const [copied, setCopied] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("unlisted");
  const [shareLink, setShareLink] = useState(`https://dvyb.app/v/${state.projectId}`);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const socialLinks = [
    {
      name: "Twitter",
      icon: Twitter,
      color: "bg-[#1DA1F2]/10 text-[#1DA1F2] hover:bg-[#1DA1F2]/20",
      url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(`Check out my video: ${state.projectName}`)}`,
    },
    {
      name: "Facebook",
      icon: Facebook,
      color: "bg-[#4267B2]/10 text-[#4267B2] hover:bg-[#4267B2]/20",
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink)}`,
    },
    {
      name: "LinkedIn",
      icon: Linkedin,
      color: "bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20",
      url: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareLink)}&title=${encodeURIComponent(state.projectName)}`,
    },
    {
      name: "Email",
      icon: Mail,
      color: "bg-secondary hover:bg-secondary/80",
      url: `mailto:?subject=${encodeURIComponent(state.projectName)}&body=${encodeURIComponent(`Check out this video: ${shareLink}`)}`,
    },
  ];

  const visibilityOptions = [
    { value: "private", label: "Private", icon: Lock, description: "Only you can view" },
    { value: "unlisted", label: "Unlisted", icon: Link, description: "Anyone with the link" },
    { value: "public", label: "Public", icon: Globe, description: "Visible to everyone" },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20 text-primary">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Share Video</h2>
              <p className="text-xs text-muted-foreground">{state.projectName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Visibility */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Who can view this video?</label>
            <div className="space-y-2">
              {visibilityOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setVisibility(option.value)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                    visibility === option.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <option.icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                  {visibility === option.value && (
                    <Check className="h-4 w-4 text-primary ml-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Share Link */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Share link</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 border border-border">
                <Link className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 bg-transparent text-sm outline-none min-w-0"
                />
              </div>
              <button
                onClick={handleCopy}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  copied
                    ? "bg-green-500/20 text-green-500"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Social Share */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Share on social media</label>
            <div className="flex gap-2">
              {socialLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 p-3 rounded-lg transition-colors",
                    social.color
                  )}
                  title={`Share on ${social.name}`}
                >
                  <social.icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Embed Code */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Embed code</label>
            <div className="p-3 rounded-lg bg-secondary/30 border border-border">
              <code className="text-xs text-muted-foreground break-all">
                {`<iframe src="${shareLink}/embed" width="640" height="360" frameborder="0" allowfullscreen></iframe>`}
              </code>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
