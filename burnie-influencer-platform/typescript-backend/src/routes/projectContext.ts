import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web3ProjectContext } from '../models/Web3ProjectContext';
import { logger } from '../config/logger';
import { s3Service } from '../services/S3Service';
import { UrlCacheService } from '../services/UrlCacheService';
import { projectAuthMiddleware } from '../middleware/projectAuthMiddleware';

const router = Router();

// Apply authorization middleware to all routes
router.use('/:id/*', projectAuthMiddleware);

router.get('/:id/context', async (req: Request, res: Response) => {
  if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
  const projectId = parseInt(idParam);
  if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
  const repo = AppDataSource.getRepository(Web3ProjectContext);
  const ctx = await repo.findOne({ where: { projectId } });
  
  if (!ctx) {
    return res.json({ success: true, data: null });
  }
  
  // Generate presigned URL for logo with Redis caching (similar to Web2)
  const responseData: any = { ...ctx };
  if ((ctx as any).logo_url) {
    try {
      const s3Key = s3Service.extractS3Key((ctx as any).logo_url);
      if (!s3Key) {
        logger.warn(`Failed to extract S3 key from logo_url: ${(ctx as any).logo_url}`);
        return res.json({ success: true, data: responseData });
      }
      
      // Check Redis cache first
      const isRedisAvailable = await UrlCacheService.isRedisAvailable();
      let presignedUrl: string | null = null;
      
      if (isRedisAvailable) {
        presignedUrl = await UrlCacheService.getCachedUrl(s3Key);
      }
      
      // If not cached, generate new presigned URL
      if (!presignedUrl) {
        presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600);
        
        // Cache in Redis if available
        if (isRedisAvailable && presignedUrl) {
          await UrlCacheService.cacheUrl(s3Key, presignedUrl, 3300); // 55 minutes TTL
        }
      }
      
      if (presignedUrl) {
        responseData.logo_url_presigned = presignedUrl;
        const cacheStatus = isRedisAvailable ? '(cached via Redis)' : '(no Redis, direct generation)';
        logger.info(`Generated presigned URL for project ${projectId} logo: ${s3Key} ${cacheStatus}`);
      }
    } catch (error) {
      logger.warn(`Failed to generate presigned URL for project ${projectId} logo:`, error);
    }
  }
  
  return res.json({ success: true, data: responseData });
});

router.put('/:id/context', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    const repo = AppDataSource.getRepository(Web3ProjectContext);
    let ctx = await repo.findOne({ where: { projectId } });
    const payload = req.body || {};
    if (!ctx) {
      ctx = repo.create({ projectId });
    }
    
    // Explicitly handle all fields including logo_url
    if (payload.logo_url !== undefined) {
      (ctx as any).logo_url = payload.logo_url;
      logger.info(`Setting logo_url for project ${projectId}: ${payload.logo_url}`);
    }
    if (payload.project_name !== undefined) (ctx as any).project_name = payload.project_name || null;
    if (payload.website !== undefined) (ctx as any).website = payload.website || null;
    if (payload.chain !== undefined) (ctx as any).chain = payload.chain || null;
    if (payload.tokenSymbol !== undefined) (ctx as any).tokenSymbol = payload.tokenSymbol || null;
    if (payload.tone !== undefined) (ctx as any).tone = payload.tone || null;
    if (payload.category !== undefined) (ctx as any).category = payload.category || null;
    if (payload.keywords !== undefined) (ctx as any).keywords = payload.keywords || null;
    if (payload.competitors !== undefined) (ctx as any).competitors = payload.competitors || null;
    if (payload.goals !== undefined) (ctx as any).goals = payload.goals || null;
    if (payload.brand_values !== undefined) {
      // Ensure brand_values is a string (not array)
      (ctx as any).brand_values = typeof payload.brand_values === 'string' 
        ? payload.brand_values 
        : (payload.brand_values || null);
    }
    if (payload.color_palette !== undefined) (ctx as any).color_palette = payload.color_palette || null;
    if (payload.document_urls !== undefined) {
      // Ensure document_urls is either null or a valid array
      if (payload.document_urls === null) {
        (ctx as any).document_urls = null;
      } else if (Array.isArray(payload.document_urls)) {
        if (payload.document_urls.length > 0) {
          // Normalize S3 keys (remove leading slashes for consistency)
          const normalizedUrls = payload.document_urls
            .filter((url: any) => url != null && typeof url === 'string')
            .map((url: string) => {
              const trimmed = url.trim();
              return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
            })
            .filter((url: string) => url.length > 0);
          
          (ctx as any).document_urls = normalizedUrls.length > 0 ? normalizedUrls : null;
          logger.info(`Setting document_urls for project ${projectId}: ${normalizedUrls.length} documents`);
        } else {
          (ctx as any).document_urls = null;
        }
      } else {
        // Not an array - log warning and set to null
        logger.warn(`Invalid document_urls type for project ${projectId}: ${typeof payload.document_urls}`);
        (ctx as any).document_urls = null;
      }
    }
    if (payload.documents_text !== undefined) {
      // Ensure documents_text is either null or a valid array
      if (Array.isArray(payload.documents_text) && payload.documents_text.length > 0) {
        (ctx as any).documents_text = payload.documents_text;
        logger.info(`Setting documents_text for project ${projectId}: ${payload.documents_text.length} documents`);
      } else {
        (ctx as any).documents_text = null;
      }
    }
    if (payload.details_text !== undefined) (ctx as any).details_text = payload.details_text || null;
    if (payload.content_text !== undefined) (ctx as any).content_text = payload.content_text || null;
    if (payload.platform_handles !== undefined) {
      // Ensure platform_handles is a valid object with arrays for twitter, github, website
      if (payload.platform_handles && typeof payload.platform_handles === 'object') {
        const normalized: Record<string, any> = {}
        
        // Twitter handles - array of strings
        if (Array.isArray(payload.platform_handles.twitter)) {
          normalized.twitter = payload.platform_handles.twitter.filter((h: any) => h && typeof h === 'string' && h.trim())
        } else if (payload.platform_handles.twitter && typeof payload.platform_handles.twitter === 'string') {
          // Convert old format (string) to new format (array)
          normalized.twitter = payload.platform_handles.twitter.trim() ? [payload.platform_handles.twitter.trim()] : []
        } else {
          normalized.twitter = []
        }
        
        // GitHub repos - array of strings
        if (Array.isArray(payload.platform_handles.github)) {
          normalized.github = payload.platform_handles.github.filter((r: any) => r && typeof r === 'string' && r.trim())
        } else if (payload.platform_handles.github && typeof payload.platform_handles.github === 'string') {
          // Convert old format (string) to new format (array)
          normalized.github = payload.platform_handles.github.trim() ? [payload.platform_handles.github.trim()] : []
        } else {
          normalized.github = []
        }
        
        // Website URLs - array of strings
        if (Array.isArray(payload.platform_handles.website)) {
          normalized.website = payload.platform_handles.website.filter((u: any) => u && typeof u === 'string' && u.trim())
        } else if (payload.platform_handles.website && typeof payload.platform_handles.website === 'string') {
          // Convert old format (string) to new format (array)
          normalized.website = payload.platform_handles.website.trim() ? [payload.platform_handles.website.trim()] : []
        } else {
          normalized.website = []
        }
        
        // Remove old discord/telegram fields if present
        // (we're no longer storing these)
        
        (ctx as any).platform_handles = normalized
        logger.info(`Setting platform_handles for project ${projectId}: twitter=${normalized.twitter.length}, github=${normalized.github.length}, website=${normalized.website.length}`)
      } else {
        (ctx as any).platform_handles = null
      }
    }
    
    // Handle links - ensure proper format
    if (payload.links !== undefined) {
      if (Array.isArray(payload.links)) {
        // Handle both old format (array of strings) and new format (array of objects with timestamp)
        const mappedLinks = payload.links.map((link: any) => {
          if (typeof link === 'string') {
            // Old format: just a string URL
            return { url: link, timestamp: new Date().toISOString() }
          } else if (link && typeof link === 'object') {
            // New format: object with url and optional timestamp
            return {
              url: link.url || link,
              timestamp: link.timestamp || new Date().toISOString()
            }
          }
          return null;
        });
        
        // Filter out null values and empty/invalid links
        const linksWithTimestamps = mappedLinks.filter((link: any) => {
          return link && link.url && typeof link.url === 'string' && link.url.trim().length > 0;
        });
        
        (ctx as any).linksJson = linksWithTimestamps.length > 0 ? linksWithTimestamps : null;
      } else {
        // Not an array - set to null
        (ctx as any).linksJson = null;
      }
    }
    
    const saved = await repo.save(ctx);
    logger.info(`Saved context for project ${projectId}, logo_url: ${(saved as any).logo_url || 'null'}`);
    return res.json({ success: true, data: saved });
  } catch (error) {
    logger.error(`Error saving context for project ${req.params.id}:`, error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to save context' 
    });
  }
});

// Optional endpoint to update extracted text separately
router.post('/:id/context/documents-text', async (req: Request, res: Response) => {
  if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
  const projectId = parseInt(idParam);
  if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
  const { documents_text } = req.body || {};
  const repo = AppDataSource.getRepository(Web3ProjectContext);
  let ctx = await repo.findOne({ where: { projectId } });
  if (!ctx) ctx = repo.create({ projectId });
  (ctx as any).documents_text = documents_text || '';
  const saved = await repo.save(ctx);
  return res.json({ success: true, data: saved });
});

// Server-side text extraction from document S3 keys (delegates to Python backend)
router.post('/:id/context/extract-documents', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    const { document_urls } = req.body || {};
    if (!Array.isArray(document_urls) || document_urls.length === 0) {
      return res.status(400).json({ success: false, error: 'document_urls must be a non-empty array' });
    }

    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });

    // Get bucket name and S3 region from environment
    const bucketName = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';
    const s3Region = process.env.AWS_REGION || 'us-east-1';
    
    const extracted: Array<{ name: string; url: string; text: string; timestamp?: string }> = [];
    
    // Process each document URL - ensure we create entries for ALL URLs even if extraction fails
    for (const s3KeyOrUrl of document_urls as string[]) {
      let s3Key: string = '';
      let docUrl: string = '';
      let docName: string = 'document';
      let extractedText: string = '';
      
      try {
        // Handle both S3 keys and URLs
        if (s3KeyOrUrl.startsWith('http://') || s3KeyOrUrl.startsWith('https://')) {
          // Already a URL - extract S3 key from URL if possible
          const urlMatch = s3KeyOrUrl.match(/s3\.amazonaws\.com\/([^?]+)/) || s3KeyOrUrl.match(/amazonaws\.com\/([^?]+)/);
          s3Key = (urlMatch && urlMatch[1]) ? urlMatch[1] : s3KeyOrUrl;
          docUrl = s3KeyOrUrl;
        } else if (s3KeyOrUrl.startsWith('s3://')) {
          // S3 URI format
          const match = s3KeyOrUrl.match(/s3:\/\/([^\/]+)\/(.+)/);
          if (match && match[2]) {
            s3Key = match[2];
            docUrl = `https://${match[1]}.s3.${s3Region}.amazonaws.com/${match[2]}`;
          } else {
            const extractedKey = s3KeyOrUrl.replace('s3://', '').split('/').slice(1).join('/');
            s3Key = extractedKey || s3KeyOrUrl;
            docUrl = `https://${bucketName}.s3.${s3Region}.amazonaws.com/${s3Key}`;
          }
        } else {
          // S3 key format (most common)
          s3Key = s3KeyOrUrl.startsWith('/') ? s3KeyOrUrl.slice(1) : s3KeyOrUrl;
          docUrl = `https://${bucketName}.s3.${s3Region}.amazonaws.com/${s3Key}`;
        }
        
        // Ensure s3Key and docUrl are non-empty strings
        if (!s3Key || !docUrl) {
          logger.warn(`Failed to parse S3 key/URL from: ${s3KeyOrUrl}`);
          continue;
        }
        
        // Extract document name from S3 key
        docName = s3Key.split('/').pop() || s3KeyOrUrl.split('/').pop() || 'document';
        
        logger.info(`Extracting text from document: ${s3Key} (${docUrl})`);
        
        // Try to extract text from the document
        try {
          const extractResp = await fetch(`${pythonBackendUrl}/api/utils/extract-text-from-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: docUrl, s3_key: s3Key })
          });
          
          if (extractResp && extractResp.ok) {
            const data = await extractResp.json() as any;
            extractedText = data?.text || '';
            if (data?.name) docName = data.name;
            logger.info(`✅ Text extracted for ${s3Key}: ${extractedText.length} characters`);
          } else {
            logger.warn(`Text extraction endpoint returned ${extractResp?.status || 'error'} for ${s3Key}`);
          }
        } catch (extractErr) {
          logger.warn(`Text extraction request failed for ${s3Key}: ${extractErr}`);
          // Continue without text - we'll still save the document
        }
        
        // Always create an entry for this document, even if extraction failed
        extracted.push({ 
          name: docName, 
          url: s3Key, // Store S3 key, not URL
          text: extractedText,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        // Fallback: use the original URL/key and create basic entry
        logger.warn(`Document processing failed for ${s3KeyOrUrl}: ${err}`);
        const fallbackKey = s3Key || s3KeyOrUrl;
        const fallbackName = fallbackKey.includes('/') ? fallbackKey.split('/').pop() : fallbackKey;
        extracted.push({ 
          name: fallbackName || 'document', 
          url: fallbackKey, 
          text: '',
          timestamp: new Date().toISOString()
        });
      }
    }

    const repo = AppDataSource.getRepository(Web3ProjectContext);
    let ctx = await repo.findOne({ where: { projectId } });
    if (!ctx) ctx = repo.create({ projectId });
    
    // Get existing documents to preserve timestamps and documents not in this request
    const existingDocs = Array.isArray((ctx as any).documents_text) ? (ctx as any).documents_text : []
    const existingUrls = Array.isArray((ctx as any).document_urls) ? (ctx as any).document_urls : []
    
    // Normalize provided URLs for matching (remove leading slashes)
    const normalizedProvidedUrls = document_urls.map((url: string) => url.startsWith('/') ? url.slice(1) : url)
    const providedUrlsSet = new Set(normalizedProvidedUrls)
    
    logger.info(`Extracting documents for project ${projectId}: ${document_urls.length} URLs provided, ${existingDocs.length} existing docs in documents_text, ${existingUrls.length} in document_urls`);
    
    // Create map of existing documents by URL for timestamp preservation
    const existingDocsMap = new Map<string, any>()
    existingDocs.forEach((doc: any) => {
      if (doc && doc.url) {
        // Normalize S3 key for matching (remove leading slash if present)
        const normalizedUrl = doc.url.startsWith('/') ? doc.url.slice(1) : doc.url
        existingDocsMap.set(normalizedUrl, doc)
        existingDocsMap.set(doc.url, doc) // Also store original for lookup
      }
    })
    
    // Ensure extracted array has entries for ALL provided URLs (it should, but double-check)
    if (extracted.length !== document_urls.length) {
      logger.warn(`⚠️ Mismatch: extracted ${extracted.length} docs but provided ${document_urls.length} URLs for project ${projectId}`);
    }
    
    logger.info(`Processing ${extracted.length} extracted documents for project ${projectId}`);
    logger.info(`Extracted docs: ${JSON.stringify(extracted.map(d => ({ name: d.name, url: d.url, hasText: !!d.text })))}`);
    
    // Update extracted docs with preserved timestamps from existing docs
    const updatedExtracted = extracted
      .filter(doc => {
        if (!doc || !doc.url) {
          logger.warn(`⚠️ Invalid doc entry in extracted array for project ${projectId}: ${JSON.stringify(doc)}`);
          return false
        }
        return true
      })
      .map(doc => {
        // Normalize S3 key for matching
        const normalizedUrl = doc.url.startsWith('/') ? doc.url.slice(1) : doc.url
        const existing = existingDocsMap.get(normalizedUrl) || existingDocsMap.get(doc.url)
        
        if (existing && existing.timestamp) {
          // Preserve existing timestamp but update text
          return { 
            name: doc.name || existing.name || 'document',
            url: doc.url,
            text: doc.text || existing.text || '',
            timestamp: existing.timestamp
          }
        }
        // New document - use the timestamp we created
        return { 
          name: doc.name || 'document',
          url: doc.url,
          text: doc.text || '',
          timestamp: doc.timestamp || new Date().toISOString()
        }
      })
    
    logger.info(`Updated extracted docs after timestamp preservation: ${updatedExtracted.length}`);
    
    // Keep existing documents that weren't in the extraction request
    const preservedDocs = existingDocs.filter((doc: any) => {
      if (!doc || !doc.url) return false
      const normalizedUrl = doc.url.startsWith('/') ? doc.url.slice(1) : doc.url
      return !providedUrlsSet.has(normalizedUrl) && !providedUrlsSet.has(doc.url)
    })
    
    // Combine updated extracted docs with preserved existing docs
    const allDocs = [...updatedExtracted, ...preservedDocs]
    
    // Store S3 keys in document_urls (normalize - remove leading slash)
    const allDocumentUrls: string[] = allDocs
      .map((d: any) => {
        if (!d || !d.url) return null
        // Normalize - remove leading slash
        const normalizedUrl = typeof d.url === 'string' && d.url.startsWith('/') ? d.url.slice(1) : d.url
        return normalizedUrl
      })
      .filter((url: any): url is string => url != null && typeof url === 'string' && url.length > 0)
    
    logger.info(`Saving ${allDocs.length} documents (${updatedExtracted.length} new/updated, ${preservedDocs.length} preserved) for project ${projectId}`);
    logger.info(`Document URLs to save: ${JSON.stringify(allDocumentUrls)}`);
    logger.info(`Documents text structure: ${JSON.stringify(allDocs.map((d: any) => ({ name: d.name, url: d.url, textLength: d.text?.length || 0, hasTimestamp: !!d.timestamp })))}`);
    
    // Save documents - always save what we have (even if extraction failed)
    // Use repo.update() to ensure JSONB columns are properly saved
    const updateData: any = {}
    
    if (allDocs.length > 0 && Array.isArray(allDocumentUrls)) {
      updateData.document_urls = allDocumentUrls.length > 0 ? allDocumentUrls : null
      updateData.documents_text = allDocs.length > 0 ? allDocs : null
      logger.info(`✅ Setting documents_text with ${allDocs.length} entries for project ${projectId}`);
      logger.info(`✅ Setting document_urls with ${allDocumentUrls.length} entries for project ${projectId}`);
    } else {
      logger.warn(`⚠️ No documents to save for project ${projectId} - extracted: ${extracted.length}, allDocs: ${allDocs.length}, document_urls provided: ${document_urls.length}`);
      // Only set to null if we really have nothing
      updateData.document_urls = Array.isArray(allDocumentUrls) && allDocumentUrls.length > 0 ? allDocumentUrls : null
      updateData.documents_text = null
    }
    
    // Log what we're about to update
    logger.info(`📝 Updating documents for project ${projectId}:`);
    logger.info(`   - document_urls: ${JSON.stringify(updateData.document_urls)}`);
    logger.info(`   - documents_text count: ${Array.isArray(updateData.documents_text) ? updateData.documents_text.length : 'null'}`);
    if (Array.isArray(updateData.documents_text) && updateData.documents_text.length > 0) {
      logger.info(`   - First document_text entry: ${JSON.stringify(updateData.documents_text[0])}`);
    }
    
    // Explicitly update the columns using update() to ensure TypeORM saves JSONB properly
    const updateResult = await repo.update({ projectId }, updateData);
    logger.info(`✅ Update result for project ${projectId}: ${updateResult.affected} row(s) affected`);
    
    // Reload to get the saved data
    const saved = await repo.findOne({ where: { projectId } });
    
    if (!saved) {
      logger.error(`❌ Failed to reload context after update for project ${projectId}`);
      return res.status(500).json({ success: false, error: 'Failed to save documents' });
    }
    
    // Verify what was actually saved
    const savedDocsText = (saved as any).documents_text;
    const savedDocsUrls = (saved as any).document_urls;
    logger.info(`✅ Extracted text from ${extracted.length} documents for project ${projectId}`);
    logger.info(`✅ Saved documents_urls: ${Array.isArray(savedDocsUrls) ? savedDocsUrls.length : 'null/undefined'}`);
    logger.info(`✅ Saved documents_text: ${Array.isArray(savedDocsText) ? savedDocsText.length : savedDocsText === null ? 'null' : 'undefined'} entries`);
    
    if (Array.isArray(savedDocsText) && savedDocsText.length > 0) {
      logger.info(`✅ First saved document: ${JSON.stringify(savedDocsText[0])}`);
    }
    
    return res.json({ 
      success: true, 
      data: saved, 
      extracted_count: extracted.length,
      documents_saved: Array.isArray(savedDocsText) ? savedDocsText.length : 0
    });
  } catch (e) {
    logger.error('extract-documents failed', e);
    return res.status(500).json({ success: false, error: 'Failed to extract document text' });
  }
});

export { router as projectContextRoutes };


