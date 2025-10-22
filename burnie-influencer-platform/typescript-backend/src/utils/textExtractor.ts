import { logger } from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Text extraction utility for various file formats
 * Supports: PDF, DOCX, CSV, TXT
 */

/**
 * Extract text from PDF file
 */
async function extractFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Using pdf-parse library
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    logger.error('Error extracting text from PDF:', error);
    return '';
  }
}

/**
 * Extract text from DOCX file
 */
async function extractFromDOCX(buffer: Buffer): Promise<string> {
  try {
    // Using mammoth library
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (error) {
    logger.error('Error extracting text from DOCX:', error);
    return '';
  }
}

/**
 * Extract text from CSV file
 */
function extractFromCSV(buffer: Buffer): string {
  try {
    const content = buffer.toString('utf-8');
    // Convert CSV to readable text format
    const lines = content.split('\n');
    return lines.map(line => line.replace(/,/g, ' | ')).join('\n');
  } catch (error) {
    logger.error('Error extracting text from CSV:', error);
    return '';
  }
}

/**
 * Extract text from plain text file
 */
function extractFromTXT(buffer: Buffer): string {
  try {
    return buffer.toString('utf-8');
  } catch (error) {
    logger.error('Error extracting text from TXT:', error);
    return '';
  }
}

/**
 * Main function to extract text from any supported file format
 * @param buffer - File buffer
 * @param filename - Original filename with extension
 * @returns Extracted text content
 */
export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  
  logger.info(`Extracting text from file: ${filename} (type: ${ext})`);
  
  try {
    switch (ext) {
      case '.pdf':
        return await extractFromPDF(buffer);
      
      case '.docx':
        return await extractFromDOCX(buffer);
      
      case '.csv':
        return extractFromCSV(buffer);
      
      case '.txt':
        return extractFromTXT(buffer);
      
      default:
        logger.warn(`Unsupported file type for text extraction: ${ext}`);
        return '';
    }
  } catch (error) {
    logger.error(`Error during text extraction for ${filename}:`, error);
    return '';
  }
}

/**
 * Check if file type supports text extraction
 */
export function supportsTextExtraction(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ['.pdf', '.docx', '.csv', '.txt'].includes(ext);
}

/**
 * Sanitize and format extracted text
 * - Remove excessive whitespace
 * - Normalize line breaks
 * - Trim content
 */
export function sanitizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Normalize line breaks
    .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
    .replace(/[ \t]{2,}/g, ' ') // Remove excessive spaces
    .trim();
}

/**
 * Append text to existing context
 * @param existingContext - Current context text
 * @param newText - New text to append
 * @param separator - Separator between contexts (default: double line break)
 * @returns Combined context
 */
export function appendToContext(
  existingContext: string | null | undefined,
  newText: string,
  separator: string = '\n\n---\n\n'
): string {
  const sanitizedNew = sanitizeExtractedText(newText);
  
  if (!sanitizedNew) {
    return existingContext || '';
  }
  
  if (!existingContext || existingContext.trim() === '') {
    return sanitizedNew;
  }
  
  return `${existingContext}${separator}${sanitizedNew}`;
}

