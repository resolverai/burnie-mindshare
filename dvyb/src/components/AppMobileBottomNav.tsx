"use client";

import { Compass, Building2, FolderOpen, Palette, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface AppMobileBottomNavProps {
  onCreateAd?: () => void;
}

const navItems: { name: string; icon: typeof Compass; path: string }[] = [
  { name: "Discover", icon: Compass, path: "/discover" },
  { name: "Brands", icon: Building2, path: "/brands" },
  { name: "Content", icon: FolderOpen, path: "/content-library" },
  { name: "Brand Kit", icon: Palette, path: "/brand-kit" },
];

export function AppMobileBottomNav({ onCreateAd }: AppMobileBottomNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (path: string) => {
    if (path === "/discover") return pathname === "/discover";
    if (path === "/brands") return pathname === "/brands";
    if (path === "/content-library") return pathname.startsWith("/content-library");
    if (path === "/brand-kit") return pathname.startsWith("/brand-kit");
    return false;
  };

  const handleNavClick = (path: string) => {
    router.push(path);
  };

  return (
    <nav className="fixed bottom-4 left-4 right-4 z-50 lg:hidden">
      {/* Notch/Dimple background - same as wander */}
      <div className="absolute left-1/2 -translate-x-1/2 -top-5 w-24 h-12 bg-[hsl(var(--app-content-bg))] dark:bg-secondary rounded-t-full" />

      <div className="relative bg-background/95 backdrop-blur-xl rounded-2xl border border-border/50 shadow-lg">
        {/* Center notch cutout overlay */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-6 w-20 h-10 bg-background/95 backdrop-blur-xl rounded-t-full border-t border-l border-r border-border/50" />

        <div className="flex items-center justify-around py-2.5 px-2">
          {/* Left nav items */}
          {navItems.slice(0, 2).map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-colors min-w-0 flex-1",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5 flex-shrink-0", active && "text-foreground")} />
                <span className={cn("text-[10px] font-medium truncate", active && "font-semibold")}>
                  {item.name}
                </span>
              </button>
            );
          })}

          {/* Center Create Button */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={onCreateAd}
              className="relative -mt-12 flex flex-col items-center gap-1 group"
              aria-label="Create your ad"
            >
              <div
                className="relative w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform overflow-hidden"
                style={{
                  background:
                    "radial-gradient(circle at 30% 30%, hsl(25 100% 65%), hsl(25 100% 50%) 50%, hsl(25 100% 35%) 100%)",
                  boxShadow:
                    "0 8px 24px -4px hsl(25 100% 40% / 0.7), 0 4px 0 0 hsl(25 100% 30%), inset 0 -4px 8px hsl(25 100% 25% / 0.4), inset 0 4px 8px hsl(25 100% 80% / 0.3)",
                }}
              >
                <div
                  className="absolute top-1.5 left-3 w-6 h-4 rounded-full opacity-40"
                  style={{ background: "linear-gradient(180deg, white 0%, transparent 100%)" }}
                />
                <Plus className="w-8 h-8 text-white drop-shadow-md relative z-10" strokeWidth={2.5} />
              </div>
              <span className="text-[10px] font-semibold text-[hsl(var(--landing-cta-orange))]">Create</span>
            </button>
          </div>

          {/* Right nav items */}
          {navItems.slice(2, 4).map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-colors min-w-0 flex-1",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5 flex-shrink-0", active && "text-foreground")} />
                <span className={cn("text-[10px] font-medium truncate", active && "font-semibold")}>
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
