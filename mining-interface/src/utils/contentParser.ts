/**
 * Utility functions for parsing and cleaning Twitter content from AI-generated outputs
 */

/**
 * Removes image URLs and AWS parameters from content text
 */
export const cleanContentFromUrls = (text: string): string => {
  let cleanText = text;
  
  // Remove image URL patterns from the text
  cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
  cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
  cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '');
  cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '');
  cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '');
  cleanText = cleanText.replace(/https?:\/\/oaidalleapiprodscus[^\s\n<>"'`]+/gi, '');
  
  // Remove AWS parameters that might appear on separate lines
  const lines = cleanText.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    return trimmedLine && 
           !trimmedLine.startsWith('http') && 
           !trimmedLine.includes('AWSAccessKeyId') &&
           !trimmedLine.includes('Signature=') &&
           !trimmedLine.includes('Expires=') &&
           !trimmedLine.match(/^[A-Za-z0-9+/=]+$/); // Base64 encoded strings (AWS signatures)
  });
  
  return filteredLines.join('\n');
};

/**
 * Extracts clean Twitter text from AI-generated content
 */
export const extractTwitterText = (contentText: string): string => {
  // First clean URLs and parameters
  let cleanText = cleanContentFromUrls(contentText);
  
  // Extract just the Twitter text (before the stats and metadata)
  const lines = cleanText.split('\n');
  let twitterText = "";
  
  for (const line of lines) {
    if (line.includes('📊 Content Stats') || 
        line.includes('🖼️ [Image will be attached') ||
        line.includes('💡 To post:') ||
        line.includes('Content Stats:') ||
        line.includes('To Post on Twitter:')) {
      break;
    }
    
    const trimmedLine = line.trim();
    if (trimmedLine) {
      twitterText += line + "\n";
    }
  }
  
  return twitterText.trim();
};

/**
 * Extracts image URL from content text
 */
export const extractImageUrl = (contentText: string): string | null => {
  // Try different patterns for image URLs
  const patterns = [
    /📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i,
    /Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i,
    /(https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+)/i,
    /(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i,
    /(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i,
    /(https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+)/i,
    /(https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = contentText.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  
  return null;
};

/**
 * Formats Twitter content by separating text and image URL
 */
export const formatTwitterContent = (contentText: string): { text: string; imageUrl: string | null } => {
  const imageUrl = extractImageUrl(contentText);
  const text = extractTwitterText(contentText);
  
  return {
    text,
    imageUrl
  };
};

/**
 * Extracts hashtags from text
 */
export const extractHashtags = (text: string): string[] => {
  const hashtagRegex = /#\w+/g;
  return text.match(hashtagRegex) || [];
}; 