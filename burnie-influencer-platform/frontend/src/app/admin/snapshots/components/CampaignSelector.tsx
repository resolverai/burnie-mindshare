'use client'

import React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Campaign {
  value: number
  label: string
  platformSource: string
  description: string
}

interface CampaignSelectorProps {
  campaigns: Campaign[]
  selectedCampaign: number | null
  onCampaignChange: (campaignId: number | null) => void
  disabled?: boolean
}

export default function CampaignSelector({ 
  campaigns, 
  selectedCampaign, 
  onCampaignChange, 
  disabled = false 
}: CampaignSelectorProps) {
  const selectedCampaignData = campaigns.find(c => c.value === selectedCampaign);

  return (
    <div className="space-y-2">
      <Label htmlFor="campaign-select">Campaign</Label>
      <Select 
        value={selectedCampaign?.toString() || ''} 
        onValueChange={(value) => onCampaignChange(value ? parseInt(value) : null)}
        disabled={disabled}
      >
        <SelectTrigger id="campaign-select" className="h-auto min-h-[2.5rem] py-2">
          {selectedCampaignData ? (
            <div className="flex flex-col items-start text-left w-full space-y-1">
              <div className="flex items-center justify-between w-full">
                <span className="font-medium text-sm truncate">{selectedCampaignData.label}</span>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full ml-2 flex-shrink-0">
                  {selectedCampaignData.platformSource}
                </span>
              </div>
              {selectedCampaignData.description && (
                <span className="text-xs text-gray-500 truncate max-w-full leading-relaxed">
                  {selectedCampaignData.description.length > 50 
                    ? `${selectedCampaignData.description.substring(0, 50)}...` 
                    : selectedCampaignData.description
                  }
                </span>
              )}
            </div>
          ) : (
            <SelectValue placeholder={disabled ? "Select platform first" : "Select campaign"} />
          )}
        </SelectTrigger>
        <SelectContent className="max-w-lg">
          {campaigns.map((campaign) => (
            <SelectItem 
              key={campaign.value} 
              value={campaign.value.toString()}
              className="py-3 border-b border-gray-100 last:border-b-0"
            >
              <div className="flex flex-col w-full space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{campaign.label}</span>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                    {campaign.platformSource}
                  </span>
                </div>
                {campaign.description && (
                  <span 
                    className="text-xs text-gray-600 leading-relaxed" 
                    title={campaign.description}
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {campaign.description}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-gray-500">
        Associate screenshot with an active campaign for ML training
      </p>
    </div>
  )
}
