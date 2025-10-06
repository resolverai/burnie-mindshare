import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';
import { ContentMarketplace } from './ContentMarketplace';

@Entity('video_analytics')
@Index(['userId', 'createdAt'])
@Index(['contentId', 'createdAt'])
@Index(['videoGenerationStatus'])
export class VideoAnalytics {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ name: 'user_id' })
    userId!: number;

    @Column({ name: 'content_id', nullable: true })
    contentId?: number;

    @Column({ name: 'project_name', type: 'varchar', length: 255 })
    projectName!: string;

    @Column({ name: 'video_url', type: 'text', nullable: true })
    videoUrl?: string;

    @Column({ name: 'initial_image_url', type: 'text', nullable: true })
    initialImageUrl?: string;

    @Column({ name: 'logo_url', type: 'text', nullable: true })
    logoUrl?: string;

    // Duration System
    @Column({ name: 'duration_mode', type: 'varchar', length: 50, default: 'video_duration' })
    durationMode!: string; // 'video_duration' | 'clip_based'

    @Column({ name: 'video_duration', type: 'int', nullable: true })
    videoDuration?: number;

    @Column({ name: 'clip_duration', type: 'int', default: 5 })
    clipDuration!: number;

    @Column({ name: 'number_of_clips', type: 'int', nullable: true })
    numberOfClips?: number;

    // Character Control
    @Column({ name: 'character_control', type: 'varchar', length: 50, default: 'unlimited' })
    characterControl!: string; // 'no_characters' | 'human_only' | 'web3' | 'unlimited'

    @Column({ name: 'human_characters_only', type: 'boolean', default: false })
    humanCharactersOnly!: boolean;

    @Column({ name: 'web3_characters', type: 'boolean', default: false })
    web3Characters!: boolean;

    @Column({ name: 'no_characters', type: 'boolean', default: false })
    noCharacters!: boolean;

    // Audio System
    @Column({ name: 'audio_system', type: 'varchar', length: 50, default: 'individual_clips' })
    audioSystem!: string; // 'individual_clips' | 'single_audio'

    @Column({ name: 'enable_voiceover', type: 'boolean', default: false })
    enableVoiceover!: boolean;

    @Column({ name: 'clip_audio_prompts', type: 'boolean', default: true })
    clipAudioPrompts!: boolean;

    // Creative Control
    @Column({ name: 'enable_crossfade_transitions', type: 'boolean', default: true })
    enableCrossfadeTransitions!: boolean;

    @Column({ name: 'random_mode', type: 'varchar', length: 50, default: 'true_random' })
    randomMode!: string; // 'all_regular' | 'all_prime' | 'true_random'

    @Column({ name: 'use_brand_aesthetics', type: 'boolean', default: false })
    useBrandAesthetics!: boolean;

    @Column({ name: 'include_product_images', type: 'boolean', default: false })
    includeProductImages!: boolean;

    // Model Options
    @Column({ name: 'image_model', type: 'varchar', length: 50, default: 'seedream' })
    imageModel!: string; // 'nano-banana' | 'seedream'

    @Column({ name: 'llm_provider', type: 'varchar', length: 50, default: 'grok' })
    llmProvider!: string; // 'claude' | 'grok'

    // Generation Status and Performance
    @Column({ name: 'video_generation_status', type: 'varchar', length: 50, default: 'pending' })
    videoGenerationStatus!: string; // 'pending' | 'processing' | 'completed' | 'failed'

    @Column({ name: 'generation_start_time', type: 'timestamp', nullable: true })
    generationStartTime?: Date;

    @Column({ name: 'generation_end_time', type: 'timestamp', nullable: true })
    generationEndTime?: Date;

    @Column({ name: 'generation_duration_seconds', type: 'int', nullable: true })
    generationDurationSeconds?: number;

    @Column({ name: 'error_message', type: 'text', nullable: true })
    errorMessage?: string;

    // Advanced Metadata (JSON)
    @Column({ name: 'advanced_options_metadata', type: 'json', nullable: true })
    advancedOptionsMetadata?: any;

    @Column({ name: 'generation_metadata', type: 'json', nullable: true })
    generationMetadata?: any;

    @Column({ name: 'frame_urls', type: 'json', nullable: true })
    frameUrls?: string[];

    @Column({ name: 'clip_urls', type: 'json', nullable: true })
    clipUrls?: string[];

    @Column({ name: 'audio_urls', type: 'json', nullable: true })
    audioUrls?: string[];

    @Column({ name: 'voiceover_urls', type: 'json', nullable: true })
    voiceoverUrls?: string[];

    // Content Information
    @Column({ name: 'tweet_text', type: 'text', nullable: true })
    tweetText?: string;

    @Column({ name: 'initial_image_prompt', type: 'text', nullable: true })
    initialImagePrompt?: string;

    @Column({ name: 'theme', type: 'varchar', length: 255, nullable: true })
    theme?: string;

    // Analytics and Performance Metrics
    @Column({ name: 'frames_generated', type: 'int', default: 0 })
    framesGenerated!: number;

    @Column({ name: 'clips_generated', type: 'int', default: 0 })
    clipsGenerated!: number;

    @Column({ name: 'audio_tracks_generated', type: 'int', default: 0 })
    audioTracksGenerated!: number;

    @Column({ name: 'voiceover_tracks_generated', type: 'int', default: 0 })
    voiceoverTracksGenerated!: number;

    @Column({ name: 'total_processing_cost', type: 'decimal', precision: 10, scale: 4, nullable: true })
    totalProcessingCost?: number;

    @Column({ name: 'api_calls_made', type: 'int', default: 0 })
    apiCallsMade!: number;

    // Source and Context
    @Column({ name: 'source', type: 'varchar', length: 100, default: 'mining_interface' })
    source!: string; // 'mining_interface' | 'yapper_interface' | 'dedicated_miner'

    @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
    sessionId?: string;

    @Column({ name: 'execution_id', type: 'varchar', length: 255, nullable: true })
    executionId?: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;

    // Relations
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user!: User;

    @ManyToOne(() => ContentMarketplace, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'content_id' })
    content?: ContentMarketplace;

    // Helper methods
    public getDurationInSeconds(): number {
        if (this.generationStartTime && this.generationEndTime) {
            return Math.floor((this.generationEndTime.getTime() - this.generationStartTime.getTime()) / 1000);
        }
        return this.generationDurationSeconds || 0;
    }

    public isCompleted(): boolean {
        return this.videoGenerationStatus === 'completed' && !!this.videoUrl;
    }

    public isFailed(): boolean {
        return this.videoGenerationStatus === 'failed';
    }

    public getAdvancedOptionsUsed(): any {
        return {
            durationMode: this.durationMode,
            videoDuration: this.videoDuration,
            clipDuration: this.clipDuration,
            numberOfClips: this.numberOfClips,
            characterControl: this.characterControl,
            audioSystem: this.audioSystem,
            enableVoiceover: this.enableVoiceover,
            enableCrossfadeTransitions: this.enableCrossfadeTransitions,
            randomMode: this.randomMode,
            imageModel: this.imageModel,
            llmProvider: this.llmProvider,
            useBrandAesthetics: this.useBrandAesthetics,
            includeProductImages: this.includeProductImages
        };
    }

    public getPerformanceMetrics(): any {
        return {
            generationDurationSeconds: this.getDurationInSeconds(),
            framesGenerated: this.framesGenerated,
            clipsGenerated: this.clipsGenerated,
            audioTracksGenerated: this.audioTracksGenerated,
            voiceoverTracksGenerated: this.voiceoverTracksGenerated,
            totalProcessingCost: this.totalProcessingCost,
            apiCallsMade: this.apiCallsMade,
            averageTimePerFrame: this.framesGenerated > 0 ? this.getDurationInSeconds() / this.framesGenerated : 0,
            averageTimePerClip: this.clipsGenerated > 0 ? this.getDurationInSeconds() / this.clipsGenerated : 0
        };
    }
}
