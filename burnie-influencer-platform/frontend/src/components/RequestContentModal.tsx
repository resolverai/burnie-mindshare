"use client";

import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";

interface RequestContentModalProps {
    isOpen: boolean;
    onClose: () => void;
    searchQuery?: string;
    onSubmit?: (data: {
        projectName: string;
        platform: string;
        campaignLinks: string;
    }) => void;
}

export default function RequestContentModal({ isOpen, onClose, searchQuery, onSubmit }: RequestContentModalProps) {
    const [projectName, setProjectName] = useState(searchQuery || "");
    const [selectedPlatform, setSelectedPlatform] = useState("burnie");
    const [campaignLinks, setCampaignLinks] = useState("");
    const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false);
    const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [projectSearchResults, setProjectSearchResults] = useState<Array<{id: number, name: string, logo?: string}>>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(false);
    const [platformSearchTerm, setPlatformSearchTerm] = useState("");
    const projectSearchRef = useRef<HTMLDivElement>(null);
    const platformSearchRef = useRef<HTMLDivElement>(null);

    // Platform options from admin dashboard
    const PLATFORM_SOURCES = [
        { value: 'burnie', label: 'Burnie (Internal)' },
        { value: 'cookie.fun', label: 'Cookie.fun' },
        { value: 'yaps.kaito.ai', label: 'Yaps.Kaito.ai' },
        { value: 'yap.market', label: 'Yap.market' },
        { value: 'amplifi.now', label: 'Amplifi.now' },
        { value: 'arbus', label: 'Arbus' },
        { value: 'trendsage.xyz', label: 'Trendsage.xyz' },
        { value: 'bantr', label: 'Bantr' },
        { value: 'wallchain', label: 'Wallchain' },
        { value: 'galxe', label: 'Galxe' },
    ];

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (projectSearchRef.current && !projectSearchRef.current.contains(event.target as Node)) {
                setIsProjectDropdownOpen(false);
            }
            if (platformSearchRef.current && !platformSearchRef.current.contains(event.target as Node)) {
                setIsPlatformDropdownOpen(false);
                setPlatformSearchTerm("");
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Search projects function
    const searchProjects = async (query: string) => {
        if (!query.trim()) {
            setProjectSearchResults([]);
            setIsProjectDropdownOpen(false);
            return;
        }

        setIsLoadingProjects(true);
        try {
            // Use adminToken for admin API calls
            const adminToken = localStorage.getItem('adminToken');
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            
            if (adminToken) {
                headers['Authorization'] = `Bearer ${adminToken}`;
            }

            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/projects/search?q=${encodeURIComponent(query)}`, {
                headers,
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    setProjectSearchResults(result.data || []);
                    setIsProjectDropdownOpen(true);
                }
            } else if (response.status === 401) {
                console.warn('Admin token not available for project search, skipping...');
                setProjectSearchResults([]);
                setIsProjectDropdownOpen(false);
            }
        } catch (error) {
            console.error('Error searching projects:', error);
        } finally {
            setIsLoadingProjects(false);
        }
    };

    // Handle project name input change
    const handleProjectNameChange = (value: string) => {
        setProjectName(value);
        searchProjects(value);
    };

    // Handle project selection from dropdown
    const selectProject = (project: {id: number, name: string, logo?: string}) => {
        setProjectName(project.name);
        setIsProjectDropdownOpen(false);
        setProjectSearchResults([]);
    };

    // Filter platforms based on search term
    const filteredPlatforms = PLATFORM_SOURCES.filter(platform =>
        platform.label.toLowerCase().includes(platformSearchTerm.toLowerCase()) ||
        platform.value.toLowerCase().includes(platformSearchTerm.toLowerCase())
    );

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        try {
            const requestData = {
                projectName,
                platform: selectedPlatform,
                campaignLinks,
            };

            if (onSubmit) {
                await onSubmit(requestData);
            } else {
                // Fallback to console log if no onSubmit handler provided
                console.log("Request submitted:", requestData);
            }

            // Reset form
            setProjectName("");
            setSelectedPlatform("burnie");
            setCampaignLinks("");
            onClose();
        } catch (error) {
            console.error("Error submitting request:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4"
            onClick={handleOverlayClick}
        >
            <div className="bg-[#492222] rounded-2xl sm:rounded-3xl w-full max-w-[606px] max-h-[90vh] sm:h-[750px] pt-4 pr-4 pb-6 pl-4 sm:pt-6 sm:pr-6 sm:pb-8 sm:pl-6 relative shadow-[0_20px_60px_rgba(0,0,0,0.4)] flex flex-col gap-4 sm:gap-6 overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h2 className="text-white text-lg sm:text-xl font-semibold">Request content</h2>
                    <button
                        onClick={onClose}
                        className="text-white/70 hover:text-white transition-colors p-1"
                    >
                        <X size={20} className="sm:w-6 sm:h-6" />
                    </button>
                </div>

                {/* Subtitle */}
                <div className="flex flex-col">
                    <div className="flex flex-col items-start bg-[#12141866] rounded-t-md p-3 sm:p-4 border-b border-white/40">
                        <h3 className="text-white text-base sm:text-lg font-semibold">Provide details</h3>
                        <p className="text-white/90 text-xs sm:text-sm font-normal">
                            We will create content on the basis of details provided. It may take some time
                        </p>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 sm:gap-6 rounded-b-md p-3 sm:p-4 bg-[#12141866]">
                        {/* Project Name Field */}
                        <div ref={projectSearchRef} className="flex flex-col items-start bg-[#220808] rounded-md px-3 sm:px-4 py-2 sm:py-3 border-[1px] border-[#ffffff]/30 relative">
                            <label className="block text-white/80 text-xs sm:text-sm font-medium">
                                Project name
                            </label>
                            <input
                                type="text"
                                value={projectName}
                                onChange={(e) => handleProjectNameChange(e.target.value)}
                                onFocus={() => {
                                    if (projectName.trim()) {
                                        searchProjects(projectName);
                                    }
                                }}
                                className="w-full text-white placeholder:text-white/40 font-semibold text-sm sm:text-md focus:outline-none placeholder:font-normal sm:text-lg bg-transparent"
                                placeholder="Search existing projects or enter new project name"
                                required
                                autoComplete="off"
                            />
                            
                            {/* Loading indicator */}
                            {isLoadingProjects && (
                                <div className="absolute right-3 top-9 text-white/40">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white/60"></div>
                                </div>
                            )}
                            
                            {/* Search results dropdown */}
                            {isProjectDropdownOpen && projectSearchResults.length > 0 && (
                                <div className="absolute z-10 w-full mt-1 bg-[#2A0F0F] border border-[#743636] rounded-[12px] shadow-lg max-h-60 overflow-auto top-full left-0">
                                    {projectSearchResults.map((project) => (
                                        <div
                                            key={project.id}
                                            onClick={() => selectProject(project)}
                                            className="px-4 py-2 hover:bg-[#451616] cursor-pointer flex items-center space-x-2"
                                        >
                                            {project.logo && (
                                                <img src={project.logo} alt="" className="w-6 h-6 rounded-full object-cover" />
                                            )}
                                            <span className="text-sm text-white/80">{project.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            {/* No results message */}
                            {isProjectDropdownOpen && projectSearchResults.length === 0 && projectName.trim() && !isLoadingProjects && (
                                <div className="absolute z-10 w-full mt-1 bg-[#2A0F0F] border border-[#743636] rounded-[12px] shadow-lg top-full left-0">
                                    <div className="px-4 py-2 text-sm text-white/60">
                                        No existing projects found. A new project will be created.
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Platform Field */}
                        <div ref={platformSearchRef} className="flex flex-col items-start bg-[#220808] rounded-md px-3 sm:px-4 py-2 sm:py-3 border-[1px] border-[#ffffff]/30 relative">
                            <label className="block text-white/80 text-xs sm:text-sm font-medium">
                                Platform
                            </label>
                            <div className="relative w-full">
                                <input
                                    type="text"
                                    value={selectedPlatform}
                                    onChange={(e) => {
                                        setSelectedPlatform(e.target.value);
                                        setPlatformSearchTerm(e.target.value);
                                        setIsPlatformDropdownOpen(true);
                                    }}
                                    onFocus={() => setIsPlatformDropdownOpen(true)}
                                    onBlur={() => {
                                        // Delay closing to allow clicking on dropdown items
                                        setTimeout(() => setIsPlatformDropdownOpen(false), 200);
                                    }}
                                    className="w-full text-white placeholder:text-white/40 font-semibold text-sm sm:text-md focus:outline-none placeholder:font-normal sm:text-lg bg-transparent"
                                    placeholder="Search existing platforms or enter new platform name"
                                    required
                                    autoComplete="off"
                                />
                                
                                {/* Platform suggestions dropdown */}
                                {isPlatformDropdownOpen && filteredPlatforms.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-[#2A0F0F] border border-[#743636] rounded-[12px] shadow-lg max-h-60 overflow-auto top-full left-0">
                                        {filteredPlatforms.map((platform) => (
                                            <div
                                                key={platform.value}
                                                onClick={() => {
                                                    setSelectedPlatform(platform.value);
                                                    setPlatformSearchTerm("");
                                                    setIsPlatformDropdownOpen(false);
                                                }}
                                                className="px-4 py-2 hover:bg-[#451616] cursor-pointer flex items-center space-x-2"
                                            >
                                                <span className="text-sm text-white/80">{platform.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                {/* No results message */}
                                {isPlatformDropdownOpen && filteredPlatforms.length === 0 && selectedPlatform.trim() && (
                                    <div className="absolute z-10 w-full mt-1 bg-[#2A0F0F] border border-[#743636] rounded-[12px] shadow-lg top-full left-0">
                                        <div className="px-4 py-2 text-sm text-white/60">
                                            No existing platforms found. A new platform will be created.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Campaign Links Field */}
                        <div className="flex flex-col items-start bg-[#220808] rounded-md px-3 sm:px-4 py-2 sm:py-3 border-[1px] border-[#ffffff]/30">
                            <label className="block text-white/80 text-xs sm:text-sm font-medium mb-2">
                                Links for campaign
                            </label>
                            <textarea
                                value={campaignLinks}
                                onChange={(e) => setCampaignLinks(e.target.value)}
                                rows={6}
                                className="w-full text-white placeholder:text-white/40 resize-none focus:outline-none font-semibold text-sm sm:text-md bg-transparent"
                                placeholder="Paste campaign links here..."
                                required
                            />
                        </div>

                        {/* Submit Button */}
                        <div className="mt-auto">
                            <Button
                                type="submit"
                                variant="default"
                                size="lg"
                                className="w-full h-10 sm:h-12 rounded-[12px] text-white font-semibold bg-[#FD7A10] hover:bg-[#E56A09] glow-button-orange shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition-all text-sm sm:text-base"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? "Submitting..." : "Request"}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
