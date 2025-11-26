"use client";


import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link2, Instagram, Youtube } from "lucide-react";

interface SocialConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SocialConnectDialog = ({ open, onOpenChange }: SocialConnectDialogProps) => {
  const handleConnect = (platform: string) => {
    console.log(`Connecting to ${platform}...`);
    // Here you would implement the actual OAuth connection flow
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Let Dvyb post for you. Connect your social channels
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            Dvyb connects to your accounts to post automatically and learn what works best. 
            Posts are auto-scheduled by default, but you can unschedule or delete anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Help Section */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                  <Link2 className="w-5 h-5 text-amber-600" />
                </div>
                <span className="font-medium text-foreground">
                  Need help connecting your accounts?
                </span>
              </div>
              <Button variant="outline" size="sm">
                Get live help now
              </Button>
            </div>
          </div>

          {/* Social Media Section */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Social Media</h3>
            
            <div className="space-y-3">
              {/* Instagram */}
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center">
                    <Instagram className="w-6 h-6 text-white" />
                  </div>
                  <span className="font-medium">Instagram</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => handleConnect("Instagram")}
                  className="gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Connect Instagram
                </Button>
              </div>

              {/* X/Twitter */}
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </div>
                  <span className="font-medium">X/Twitter</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => handleConnect("X/Twitter")}
                  className="gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Connect X/Twitter
                </Button>
              </div>

              {/* TikTok */}
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                    </svg>
                  </div>
                  <span className="font-medium">TikTok</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => handleConnect("TikTok")}
                  className="gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Connect TikTok
                </Button>
              </div>

              {/* YouTube */}
              <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
                    <Youtube className="w-6 h-6 text-white" />
                  </div>
                  <span className="font-medium">YouTube</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => handleConnect("YouTube")}
                  className="gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  Connect YouTube
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
