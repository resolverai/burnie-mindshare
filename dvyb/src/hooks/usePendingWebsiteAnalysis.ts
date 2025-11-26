"use client";

import { useEffect, useState, useRef } from 'react';
import { contextApi } from '@/lib/api';

/**
 * Hook to handle pending website analysis after authentication.
 * Saves analysis data from localStorage to the backend when user authenticates.
 */
export function usePendingWebsiteAnalysis(isAuthenticated: boolean) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const saveAttemptedRef = useRef(false);

  useEffect(() => {
    // Prevent duplicate saves with ref flag
    if (isAuthenticated && !isSaving && !saveComplete && !saveAttemptedRef.current) {
      const pendingUrl = localStorage.getItem('dvyb_pending_website_url');
      const analysisDataString = localStorage.getItem('dvyb_website_analysis');
      const savingFlag = localStorage.getItem('dvyb_saving_in_progress');
      
      // Check if another instance is already saving
      if (savingFlag === 'true') {
        console.log("⚠️ Save already in progress, skipping duplicate save");
        return;
      }
      
      if (pendingUrl && analysisDataString) {
        console.log("💾 Found pending analysis data, saving to backend:", pendingUrl);
        
        // Mark as attempted to prevent re-runs
        saveAttemptedRef.current = true;
        
        // Set lock flag IMMEDIATELY before any async operations
        localStorage.setItem('dvyb_saving_in_progress', 'true');
        setIsSaving(true);
        
        try {
          const parsedAnalysisData = JSON.parse(analysisDataString);
          console.log("📊 Parsed analysis data:", Object.keys(parsedAnalysisData));
          
          contextApi.saveWebsiteAnalysis(pendingUrl, parsedAnalysisData)
            .then((response) => {
              if (response.success) {
                console.log("✅ Website analysis saved to backend successfully");
                console.log("  → Context ID:", response.data?.context?.id);
                
                // Clear pending data and lock after successful save
                localStorage.removeItem('dvyb_pending_website_url');
                localStorage.removeItem('dvyb_website_analysis');
                localStorage.removeItem('dvyb_saving_in_progress');
                
                setSaveComplete(true);
                setIsSaving(false);
              } else {
                console.error("❌ Save failed:", response);
                localStorage.removeItem('dvyb_saving_in_progress');
                setIsSaving(false);
              }
            })
            .catch((error) => {
              console.error("❌ Failed to save website analysis:", error);
              console.error("  → Error details:", error.message);
              
              // Clear lock flag on error so user can retry
              localStorage.removeItem('dvyb_saving_in_progress');
              setIsSaving(false);
            });
        } catch (error) {
          console.error("❌ Failed to parse analysis data:", error);
          localStorage.removeItem('dvyb_saving_in_progress');
          setIsSaving(false);
        }
      } else {
        console.log("ℹ️ No pending analysis data found in localStorage");
      }
    }
  }, [isAuthenticated, isSaving, saveComplete]);

  return { isSaving, saveComplete };
}

