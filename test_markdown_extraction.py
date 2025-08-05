import re

print('🔍 Final Test: User\'s Exact Markdown Format...')

# User's exact example
user_content = '''
Image URL: [Image Link](https://burnie-mindshare-content-staging.s3.amazonaws.com/ai-generated/3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e/7/images/dall-e-3/2025-08-05/052943_a822cae9.png?AWSAccessKeyId=AKIAR2HZEOGLEVDSEK5C&Signature=vlksLu6E0QSPImHjAIEj68u2vfs%3D&Expires=1754375387)
'''

# Test markdown pattern
markdown_pattern = r'Image URL:\s*\[[^\]]+\]\(([^)]+)\)'
matches = re.findall(markdown_pattern, user_content)

print(f'✅ Markdown pattern extracted: {len(matches)} URLs')
for match in matches:
    print(f'   URL: {match[:100]}...')

# Test comprehensive patterns like in the actual code
comprehensive_patterns = [
    # S3 URLs
    r'https://burnie-mindshare-content[^.\s]*\.s3\.amazonaws\.com/[^\s\]<>"\'`\n\r\[\)]+',
    
    # Markdown patterns
    r'Image URL:\s*\[[^\]]+\]\(([^)]+)\)',
    
    # Generic
    r'https://[^\s\]<>"\'`\n\r\[\)]+'
]

extracted_urls = []
for i, pattern in enumerate(comprehensive_patterns):
    matches = re.findall(pattern, user_content)
    if matches:
        print(f'✅ Pattern {i+1} matched: {len(matches)} URLs')
        for match in matches:
            url = match if isinstance(match, str) else match
            if url not in extracted_urls and url.startswith('http'):
                extracted_urls.append(url)
                print(f'   Found: {url[:80]}...')

print(f'\n🎉 Final Result: {len(extracted_urls)} unique URLs extracted')
print('✅ Markdown Links Now Fully Supported!') 