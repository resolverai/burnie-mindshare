'use client'

import React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Platform {
  value: string
  label: string
}

interface PlatformSelectorProps {
  platforms: Platform[]
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
}

export default function PlatformSelector({ 
  platforms, 
  selectedPlatform, 
  onPlatformChange 
}: PlatformSelectorProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="platform-select">Platform</Label>
      <Select value={selectedPlatform} onValueChange={onPlatformChange}>
        <SelectTrigger id="platform-select">
          <SelectValue placeholder="Select platform" />
        </SelectTrigger>
        <SelectContent>
          {platforms.map((platform) => (
            <SelectItem key={platform.value} value={platform.value}>
              {platform.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-gray-500">
        Choose the attention economy platform for this screenshot
      </p>
    </div>
  )
}
