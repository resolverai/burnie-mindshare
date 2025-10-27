#!/usr/bin/env python3
"""
Script to update all workflow screens with polling logic
"""

import os
import re

# List of all workflow files to update
all_workflows = [
    # Fashion workflows
    'src/app/web2/content-studio/fashion/model-diversity/page.tsx',
    'src/app/web2/content-studio/fashion/lifestyle-context/page.tsx',
    'src/app/web2/content-studio/fashion/color-style/page.tsx', 
    'src/app/web2/content-studio/fashion/before-after/page.tsx',
    'src/app/web2/content-studio/fashion/seasonal/page.tsx',
    
    # Social Media Management workflows
    'src/app/web2/content-studio/social-media/behind-scenes/page.tsx',
    'src/app/web2/content-studio/social-media/educational/page.tsx',
    'src/app/web2/content-studio/social-media/product-showcase/page.tsx',
    
    # Design Agency workflows
    'src/app/web2/content-studio/design-agency/presentation/page.tsx',
    'src/app/web2/content-studio/design-agency/portfolio/page.tsx',
    'src/app/web2/content-studio/design-agency/case-study/page.tsx'
]

def update_workflow_file(file_path):
    """Update a workflow file with polling logic"""
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Skip if already updated
    if "useGenerationPolling" in content:
        print(f"Already updated: {file_path}")
        return
    
    # Add import for the polling hook
    import_pattern = r"(import.*from 'react'[\s\S]*?import.*from 'next/navigation')"
    replacement = r"\1\nimport { useGenerationPolling } from '@/hooks/useGenerationPolling'"
    content = re.sub(import_pattern, replacement, content)
    
    # Add hook usage
    component_pattern = r"(export default function \w+Page\(\) \{\s*const router = useRouter\(\))"
    replacement = r"\1\n  const { startPolling, stopPolling } = useGenerationPolling()"
    content = re.sub(component_pattern, replacement, content)
    
    # Add cleanup useEffect
    hook_pattern = r"(const { startPolling, stopPolling } = useGenerationPolling\(\))"
    replacement = r"\1\n\n  // Cleanup polling on unmount\n  useEffect(() => {\n    return () => {\n      stopPolling()\n    }\n  }, [stopPolling])"
    content = re.sub(hook_pattern, replacement, content)
    
    # Add progress handlers
    handlers = '''
  const handleProgress = (progress: any) => {
    setProgressMessage(progress.progress_message || 'Processing...')
    setProgressPercent(progress.progress_percent || 0)
  }

  const handleComplete = (progress: any) => {
    setGenerationState('complete')
    setProgressMessage('Generation complete!')
    setProgressPercent(100)
    
    // Extract generated images
    if (progress.generated_image_urls && progress.generated_image_urls.length > 0) {
      setGeneratedImages(progress.generated_image_urls)
    }
    
    // Extract platform texts
    const platformTexts = {}
    if (progress.twitter_text) platformTexts.twitter = progress.twitter_text
    if (progress.youtube_description) platformTexts.youtube = progress.youtube_description
    if (progress.instagram_caption) platformTexts.instagram = progress.instagram_caption
    if (progress.linkedin_post) platformTexts.linkedin = progress.linkedin_post
    
    setPlatformTexts(platformTexts)
  }

  const handleError = (error: string) => {
    setGenerationState('idle')
    setProgressMessage('')
    setProgressPercent(0)
    alert('Generation failed: ' + error)
  }
'''
    
    # Find handleGenerate function and add handlers before it
    generate_pattern = r"(const handleGenerate = async \(\) => \{)"
    replacement = handlers + "\n  " + r"\1"
    content = re.sub(generate_pattern, replacement, content)
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"Updated {file_path}")

def main():
    """Update all workflow files"""
    for workflow in all_workflows:
        update_workflow_file(workflow)
    
    print("All workflow files updated with polling logic!")

if __name__ == "__main__":
    main()
