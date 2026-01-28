"""
Grok File Chat - PDF Image-Script Mapper
Upload a PDF to xAI and analyze images, mapping them to script text sections.
Outputs structured JSON for easy integration.

Usage:
    # Analyze PDF to map images to script sections (outputs JSON)
    python grok_file_chat.py --file /path/to/script.pdf --analyze
    python grok_file_chat.py -f script.pdf -a
    
    # Save JSON output to file
    python grok_file_chat.py -f script.pdf -a -o output.json
    
    # Custom question about the file
    python grok_file_chat.py --file /path/to/document.pdf --question "What is the main topic?"

Requirements:
    pip install xai-sdk python-dotenv
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path

from dotenv import load_dotenv
from xai_sdk import Client
from xai_sdk.chat import user, file, system

# Load environment variables from python-ai-backend/.env
env_path = Path(__file__).parent.parent / "python-ai-backend" / ".env"
load_dotenv(env_path)

# Get XAI API key
xai_api_key = os.getenv("XAI_API_KEY")

# Default analysis question for image-script mapping (JSON output)
DEFAULT_ANALYZE_QUESTION = """Analyze this PDF document and create a detailed mapping between images and script/text sections.

You MUST output your response as valid JSON with the following structure:

{
  "document_summary": {
    "total_images": <number>,
    "total_script_sections": <number>,
    "document_structure": "<brief description of document layout>"
  },
  "mappings": [
    {
      "image_number": 1,
      "page": <page number or null if unknown>,
      "position": "<position description: top, middle, bottom, left, right, etc.>",
      "visual_description": "<detailed description of what the image shows>",
      "image_type": "<photo|diagram|chart|screenshot|illustration|other>",
      "mapped_script": {
        "section_title": "<title or identifier of the script section if available>",
        "text": "<the exact script/text this image relates to>",
        "text_location": "<where this text appears in the document>"
      },
      "confidence": "<high|medium|low>",
      "reasoning": "<why this image pairs with this script text>"
    }
  ],
  "unmapped_images": [
    {
      "image_number": <number>,
      "visual_description": "<description>",
      "reason_unmapped": "<why no script text matches this image>"
    }
  ],
  "unmapped_scripts": [
    {
      "text": "<script text without a matching image>",
      "suggested_visual": "<what kind of image would fit this text>"
    }
  ]
}

IMPORTANT:
- Output ONLY valid JSON, no markdown code blocks or additional text
- Include ALL images found in the PDF
- Be thorough in visual descriptions
- If an image has no matching script, put it in unmapped_images
- If script text has no matching image, put it in unmapped_scripts"""


# System persona for PDF image-script analysis (JSON output)
SYSTEM_PERSONA = """You are a PDF analyzer specialized in mapping visual content to script text. You ALWAYS output valid JSON.

Your task is to:
1. ANALYZE all images in the PDF - identify and describe what each image contains (people, objects, scenes, charts, diagrams, screenshots, photos, etc.)
2. IDENTIFY all script/text sections in the PDF
3. MAP each image to its most relevant script section based on context, proximity, and semantic relevance
4. OUTPUT a structured JSON mapping

The PDF may have text and images in any layout or structure. You must:
- Understand the document's overall structure
- Detect image positions relative to text
- Use contextual clues to determine which images relate to which script sections
- Handle cases where one image may relate to multiple text sections or vice versa
- Be thorough - don't miss any images
- Output ONLY valid JSON, no explanatory text before or after

Your response must be parseable JSON that can be directly used by downstream systems."""


def upload_file(client: Client, file_path: str) -> object:
    """Upload a file to xAI and return the file object."""
    if not os.path.exists(file_path):
        print(f"❌ Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    
    print(f"📤 Uploading file: {file_path}", file=sys.stderr)
    uploaded_file = client.files.upload(file_path)
    
    print(f"  ✅ File uploaded successfully!", file=sys.stderr)
    print(f"  📁 File ID: {uploaded_file.id}", file=sys.stderr)
    print(f"  📝 Filename: {uploaded_file.filename}", file=sys.stderr)
    print(f"  📊 Size: {uploaded_file.size} bytes", file=sys.stderr)
    print(f"  🕐 Created at: {uploaded_file.created_at}", file=sys.stderr)
    
    return uploaded_file


def extract_json(content: str) -> str:
    """
    Extract JSON from response, handling various markdown code block formats.
    
    Handles:
    - ```json ... ```
    - ```JSON ... ```
    - ``` json ... ```
    - ``` ... ``` (generic code block)
    - Text before/after code blocks
    - Multiple code blocks (extracts first JSON one)
    - Raw JSON without code blocks
    """
    content = content.strip()
    
    # Pattern to match markdown code blocks with optional language tag
    # Handles: ```json, ```JSON, ``` json, ```  json, etc.
    code_block_pattern = r'```\s*(?:json|JSON)?\s*\n?([\s\S]*?)```'
    
    # Try to find code blocks
    matches = re.findall(code_block_pattern, content)
    
    if matches:
        # Try each match to find valid JSON
        for match in matches:
            candidate = match.strip()
            # Quick check if it looks like JSON (starts with { or [)
            if candidate and (candidate.startswith('{') or candidate.startswith('[')):
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    continue
        
        # If no valid JSON found in code blocks, return first match anyway
        if matches[0].strip():
            return matches[0].strip()
    
    # No code blocks found - try to extract JSON directly
    # Look for JSON object or array pattern in the content
    
    # Try to find a JSON object
    json_object_pattern = r'(\{[\s\S]*\})'
    object_matches = re.findall(json_object_pattern, content)
    
    for match in object_matches:
        try:
            json.loads(match)
            return match
        except json.JSONDecodeError:
            continue
    
    # Try to find a JSON array
    json_array_pattern = r'(\[[\s\S]*\])'
    array_matches = re.findall(json_array_pattern, content)
    
    for match in array_matches:
        try:
            json.loads(match)
            return match
        except json.JSONDecodeError:
            continue
    
    # Fallback: return stripped content as-is
    # Remove any leading/trailing backticks that might remain
    content = re.sub(r'^`+\s*(?:json|JSON)?\s*', '', content)
    content = re.sub(r'\s*`+$', '', content)
    
    return content.strip()


def chat_with_file(client: Client, file_id: str, question: str, model: str = "grok-4-fast") -> str:
    """Create a chat with an uploaded file and ask a question."""
    print(f"\n🔍 Analyzing file...", file=sys.stderr)
    print(f"🤖 Model: {model}", file=sys.stderr)
    
    # Create a chat with the file attached
    chat = client.chat.create(model=model)
    
    # Set system persona for PDF image-script mapping
    chat.append(system(SYSTEM_PERSONA))
    
    # Add user question with file attachment
    chat.append(user(question, file(file_id)))
    
    # Get the response
    response = chat.sample()
    
    print(f"📊 Usage: {response.usage}", file=sys.stderr)
    
    return response.content


def main():
    parser = argparse.ArgumentParser(
        description="Upload a PDF to Grok and analyze images, mapping them to script text sections (JSON output)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze PDF to map images to script sections (JSON to stdout)
  python grok_file_chat.py -f script.pdf --analyze
  
  # Save JSON output to file
  python grok_file_chat.py -f script.pdf -a -o mappings.json
  
  # Custom question
  python grok_file_chat.py -f document.pdf -q "List all images as JSON"
  
  # Use a different model
  python grok_file_chat.py -f script.pdf -a -m grok-4
        """
    )
    
    parser.add_argument(
        "-f", "--file",
        type=str,
        required=True,
        help="Path to the PDF file to upload and analyze"
    )
    
    parser.add_argument(
        "-a", "--analyze",
        action="store_true",
        help="Perform full image-script mapping analysis (uses default analysis prompt)"
    )
    
    parser.add_argument(
        "-q", "--question",
        type=str,
        default=None,
        help="Custom question to ask about the file (overrides --analyze)"
    )
    
    parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Output file path to save JSON result (default: stdout)"
    )
    
    parser.add_argument(
        "-m", "--model",
        type=str,
        default="grok-4-fast",
        help="Model to use for chat (default: grok-4-fast)"
    )
    
    parser.add_argument(
        "--file-id",
        type=str,
        default=None,
        help="Optional: Use an existing file ID instead of uploading a new file"
    )
    
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output with indentation"
    )
    
    args = parser.parse_args()
    
    # Determine the question to ask
    if args.question:
        question = args.question
    elif args.analyze:
        question = DEFAULT_ANALYZE_QUESTION
    else:
        print("❌ Error: Please specify either --analyze (-a) or --question (-q)", file=sys.stderr)
        print("Use --help for usage examples", file=sys.stderr)
        sys.exit(1)
    
    # Check for API key
    if not xai_api_key:
        print("❌ Error: XAI_API_KEY environment variable not set!", file=sys.stderr)
        print("Please set it in python-ai-backend/.env file", file=sys.stderr)
        sys.exit(1)
    
    # Initialize client
    client = Client(api_key=xai_api_key)
    
    # Upload file or use existing file ID
    if args.file_id:
        print(f"📁 Using existing file ID: {args.file_id}", file=sys.stderr)
        file_id = args.file_id
    else:
        uploaded_file = upload_file(client, args.file)
        file_id = uploaded_file.id
    
    # Chat with the file
    content = chat_with_file(client, file_id, question, args.model)
    
    # Extract and validate JSON
    json_content = extract_json(content)
    
    try:
        # Parse to validate it's valid JSON
        parsed_json = json.loads(json_content)
        
        # Format output
        if args.pretty:
            output = json.dumps(parsed_json, indent=2, ensure_ascii=False)
        else:
            output = json.dumps(parsed_json, ensure_ascii=False)
        
        # Write to file or stdout
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output)
            print(f"\n✅ JSON saved to: {args.output}", file=sys.stderr)
        else:
            print(output)
            
    except json.JSONDecodeError as e:
        print(f"\n⚠️ Warning: Response is not valid JSON: {e}", file=sys.stderr)
        print(f"Raw response:", file=sys.stderr)
        print(content)


if __name__ == "__main__":
    main()
