import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { VideoAnalytics } from '../models/VideoAnalytics';
import { logger } from '../config/logger';

const router = Router();

// POST /api/video-analytics - Insert video analytics record
router.post('/video-analytics', async (req, res) => {
    try {
        const videoAnalyticsRepo = AppDataSource.getRepository(VideoAnalytics);
        
        // Create new video analytics record
        const videoAnalytics = new VideoAnalytics();
        
        // Map request data to entity
        Object.assign(videoAnalytics, {
            userId: req.body.user_id,
            contentId: req.body.content_id || null,
            projectName: req.body.project_name || 'Unknown',
            videoUrl: req.body.video_url,
            initialImageUrl: req.body.initial_image_url,
            logoUrl: req.body.logo_url,
            
            // Duration System
            durationMode: req.body.duration_mode || 'video_duration',
            videoDuration: req.body.video_duration,
            clipDuration: req.body.clip_duration || 5,
            numberOfClips: req.body.number_of_clips,
            
            // Character Control
            characterControl: req.body.character_control || 'unlimited',
            humanCharactersOnly: req.body.human_characters_only || false,
            web3Characters: req.body.web3_characters || false,
            noCharacters: req.body.no_characters || false,
            
            // Audio System
            audioSystem: req.body.audio_system || 'individual_clips',
            enableVoiceover: req.body.enable_voiceover || false,
            clipAudioPrompts: req.body.clip_audio_prompts !== false,
            
            // Creative Control
            enableCrossfadeTransitions: req.body.enable_crossfade_transitions !== false,
            randomMode: req.body.random_mode || 'true_random',
            useBrandAesthetics: req.body.use_brand_aesthetics || false,
            includeProductImages: req.body.include_product_images || false,
            
            // Model Options
            imageModel: req.body.image_model || 'seedream',
            llmProvider: req.body.llm_provider || 'grok',
            
            // Generation Status and Performance
            videoGenerationStatus: req.body.video_generation_status || 'pending',
            generationStartTime: req.body.generation_start_time ? new Date(req.body.generation_start_time) : null,
            generationEndTime: req.body.generation_end_time ? new Date(req.body.generation_end_time) : null,
            generationDurationSeconds: req.body.generation_duration_seconds || 0,
            errorMessage: req.body.error_message,
            
            // Advanced Metadata
            advancedOptionsMetadata: req.body.advanced_options_metadata,
            generationMetadata: req.body.generation_metadata,
            frameUrls: req.body.frame_urls || [],
            clipUrls: req.body.clip_urls || [],
            audioUrls: req.body.audio_urls || [],
            voiceoverUrls: req.body.voiceover_urls || [],
            
            // Content Information
            tweetText: req.body.tweet_text,
            initialImagePrompt: req.body.initial_image_prompt,
            theme: req.body.theme,
            
            // Analytics and Performance Metrics
            framesGenerated: req.body.frames_generated || 0,
            clipsGenerated: req.body.clips_generated || 0,
            audioTracksGenerated: req.body.audio_tracks_generated || 0,
            voiceoverTracksGenerated: req.body.voiceover_tracks_generated || 0,
            totalProcessingCost: req.body.total_processing_cost || 0,
            apiCallsMade: req.body.api_calls_made || 0,
            
            // Source and Context
            source: req.body.source || 'mining_interface',
            sessionId: req.body.session_id,
            executionId: req.body.execution_id
        });
        
        // Save to database
        const savedAnalytics = await videoAnalyticsRepo.save(videoAnalytics);
        
        logger.info(`📊 Video analytics inserted with ID: ${savedAnalytics.id}`);
        
        res.status(201).json({
            success: true,
            data: {
                id: savedAnalytics.id,
                message: 'Video analytics record created successfully'
            }
        });
        
    } catch (error) {
        logger.error('❌ Error inserting video analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to insert video analytics record',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// GET /api/video-analytics/:id - Get video analytics by ID
router.get('/video-analytics/:id', async (req, res) => {
    try {
        const videoAnalyticsRepo = AppDataSource.getRepository(VideoAnalytics);
        const analytics = await videoAnalyticsRepo.findOne({
            where: { id: parseInt(req.params.id) },
            relations: ['user', 'content']
        });
        
        if (!analytics) {
            return res.status(404).json({
                success: false,
                error: 'Video analytics record not found'
            });
        }
        
        return res.json({
            success: true,
            data: {
                ...analytics,
                advancedOptionsUsed: analytics.getAdvancedOptionsUsed(),
                performanceMetrics: analytics.getPerformanceMetrics()
            }
        });
        
    } catch (error) {
        logger.error('❌ Error fetching video analytics:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch video analytics record'
        });
    }
});

export default router;
