"use client";

import { useState, useEffect } from "react";
import { 
  Home, 
  Calendar, 
  FileText, 
  Palette,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  Menu
} from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi } from "@/lib/api";

interface AppSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

const menuItems = [
  { id: "home", label: "Home", icon: Home },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "content-library", label: "Content Library", icon: FolderOpen },
  { id: "brand-plan", label: "Brand Plan", icon: FileText },
  { id: "brand-kit", label: "Brand Kit", icon: Palette },
];

export const AppSidebar = ({ activeView, onViewChange }: AppSidebarProps) => {
  // Collapsed by default on mobile/tablet, expanded on desktop
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024; // Tailwind's lg breakpoint
    }
    return false;
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const { accountId } = useAuth();

  // Handle window resize for responsive sidebar state
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      } else {
        setIsCollapsed(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchLogo = async () => {
      if (!accountId) return;
      
      try {
        const response = await contextApi.getContext();
        if (response.success && response.data) {
          // Use logoPresignedUrl (which includes presigned S3 URL) instead of logoUrl
          const presignedUrl = response.data.logoPresignedUrl || response.data.logoUrl;
          if (presignedUrl) {
            console.log("Setting logo URL:", presignedUrl);
            setLogoUrl(presignedUrl);
          }
        }
      } catch (error) {
        console.error("Failed to fetch logo:", error);
      }
    };

    fetchLogo();
  }, [accountId]);

  return (
    <aside 
      className={cn(
        "bg-sidebar border-r border-sidebar-border h-screen flex flex-col transition-all duration-300 relative",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo Section */}
      <div className={cn(
        "p-4 flex items-center justify-center border-b border-sidebar-border",
        isCollapsed ? "p-2" : "p-4"
      )}>
        {logoUrl ? (
          <img 
            src={logoUrl} 
            alt="Logo" 
            className={cn(
              "object-contain",
              isCollapsed ? "h-8 w-8" : "h-16 w-auto"
            )}
          />
        ) : (
          <Image 
            src={dvybLogo} 
            alt="Dvyb Logo" 
            className={cn(
              "object-contain",
              isCollapsed ? "h-8 w-8" : "h-16 w-auto"
            )}
            priority 
          />
        )}
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-20 bg-sidebar border border-sidebar-border rounded-full p-1 hover:bg-sidebar-accent transition-colors z-10"
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-sidebar-foreground" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-sidebar-foreground" />
        )}
      </button>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors",
              activeView === item.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
              isCollapsed && "justify-center"
            )}
            title={isCollapsed ? item.label : undefined}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && (
              <span className="flex-1 text-left">{item.label}</span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
};
