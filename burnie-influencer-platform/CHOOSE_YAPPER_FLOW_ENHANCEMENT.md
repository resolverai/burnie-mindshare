# Choose Yapper Flow Enhancement: High-Level Overview

## What We're Building

A new feature that allows users to **regenerate only the text** of content while keeping the same image, instead of regenerating everything.

## Current Problem

When users use "Choose Yapper" to generate content, the entire thing (text + images) gets regenerated. Users want to keep their chosen image but get new text in a different yapper's style.

## The Solution

### 1. Store Image Prompts
- Add a new column `image_prompt` to the database
- This stores what was used to generate the original image
- When content is created (from mining interface), we save the image prompt

### 2. New Text-Only Endpoint
- Create a new API endpoint that only generates text
- It takes the stored image prompt to make sure new text aligns with the image
- Respects the original post type (thread, shitpost, longpost)

### 3. Enhanced Choose Yapper Flow
- When user clicks "Choose Yapper" → "Generate Content"
- If `YAPPER_TEXT_ONLY_MODE=true`: Only generate new text, keep existing image
- If `YAPPER_TEXT_ONLY_MODE=false`: Generate everything (current behavior)

### 4. User Experience
- **Image stays the same** - no shimmer, no change
- **Text gets regenerated** - shows shimmer on text elements only
- **Button changes** from "Generate Content" back to "Buy Tweet"
- **Same fee structure** - users pay the extra price for regeneration

### 5. Error Handling
- If text generation fails, show original text
- Give user option to try again (since they already paid)
- No need for validation - just retry until success

## Key Benefits

1. **Users keep their chosen image** - no more losing good images
2. **Faster generation** - text only is quicker than full content
3. **Better alignment** - new text is designed to work with existing image
4. **Flexible pricing** - can charge for text regeneration separately
5. **Toggle control** - can enable/disable via environment variable

## What Changes

- **Database**: Add `image_prompt` column
- **Backend**: New text-only generation endpoint
- **Frontend**: Update PurchaseContentModal to handle text-only mode
- **UI**: Show shimmer only on text, keep image static
- **Flow**: Integrate with existing payment and generation systems

## The Result

Users can now:
1. Choose a yapper
2. Generate new text that matches their existing image
3. Pay a fee for the text regeneration
4. Get perfectly aligned content without losing their chosen image

This makes the Choose Yapper feature much more valuable and user-friendly.
