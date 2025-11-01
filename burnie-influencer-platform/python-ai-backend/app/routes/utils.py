"""
Utility endpoints for document text extraction
"""
import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import boto3
from botocore.exceptions import ClientError
import io
import os

logger = logging.getLogger(__name__)

router = APIRouter()

# S3 client
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION', 'us-east-1')
)

bucket_name = os.getenv('S3_BUCKET_NAME', 'burnie-mindshare-content-staging')


class ExtractTextRequest(BaseModel):
    url: Optional[str] = None
    s3_key: Optional[str] = None


def extract_text_from_pdf(file_content: bytes) -> str:
    """Extract text from PDF file"""
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        
        pdf_file = io.BytesIO(file_content)
        pdf_reader = PdfReader(pdf_file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        return ""


def extract_text_from_docx(file_content: bytes) -> str:
    """Extract text from DOCX file"""
    try:
        from docx import Document
        
        docx_file = io.BytesIO(file_content)
        doc = Document(docx_file)
        text = ""
        for paragraph in doc.paragraphs:
            text += paragraph.text + "\n"
        return text.strip()
    except Exception as e:
        logger.error(f"DOCX extraction error: {e}")
        return ""


@router.post("/extract-text-from-url")
async def extract_text_from_url(request: ExtractTextRequest) -> Dict[str, Any]:
    """
    Extract text from PDF or DOCX file stored in S3
    Accepts either a URL or S3 key
    """
    try:
        s3_key = None
        
        # Get S3 key from URL or use provided s3_key
        if request.s3_key:
            s3_key = request.s3_key.lstrip('/')
        elif request.url:
            # Extract S3 key from URL
            if 's3.amazonaws.com' in request.url or 'amazonaws.com' in request.url:
                # Extract key from URL like: https://bucket.s3.region.amazonaws.com/key
                url_parts = request.url.split('amazonaws.com/')
                if len(url_parts) > 1:
                    s3_key = url_parts[1].split('?')[0]  # Remove query params
                else:
                    raise HTTPException(status_code=400, detail="Could not extract S3 key from URL")
            else:
                raise HTTPException(status_code=400, detail="URL must be an S3 URL")
        else:
            raise HTTPException(status_code=400, detail="Either 'url' or 's3_key' must be provided")
        
        logger.info(f"Extracting text from S3 key: {s3_key}")
        
        # Download file from S3
        try:
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            file_content = response['Body'].read()
            content_type = response.get('ContentType', '')
        except ClientError as e:
            logger.error(f"S3 download error: {e}")
            raise HTTPException(status_code=404, detail=f"File not found in S3: {s3_key}")
        
        # Determine file type and extract text
        file_extension = s3_key.lower().split('.')[-1] if '.' in s3_key else ''
        extracted_text = ""
        
        if file_extension == 'pdf' or 'pdf' in content_type.lower():
            extracted_text = extract_text_from_pdf(file_content)
        elif file_extension in ['docx', 'doc'] or 'word' in content_type.lower() or 'msword' in content_type.lower():
            extracted_text = extract_text_from_docx(file_content)
        else:
            logger.warning(f"Unsupported file type: {file_extension} ({content_type})")
            raise HTTPException(status_code=400, detail=f"Unsupported file type. Only PDF and DOCX are supported.")
        
        # Get filename from S3 key
        filename = s3_key.split('/')[-1]
        
        logger.info(f"✅ Extracted {len(extracted_text)} characters from {filename}")
        
        return {
            "success": True,
            "name": filename,
            "url": s3_key,  # Return S3 key as URL identifier
            "text": extracted_text,
            "text_length": len(extracted_text)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Text extraction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text: {str(e)}")

