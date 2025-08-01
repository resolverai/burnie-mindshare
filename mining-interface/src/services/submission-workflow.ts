import { aiProviderManager, ContentGenerationRequest, ContentGenerationResponse } from './ai-providers';
import { ipfsService, IPFSContent, IPFSUploadResponse } from './ipfs-service';
import { blockchainService, SubmissionData, BatchSubmissionData, TransactionResult } from './blockchain-service';
import { agentService, MiningAgent } from './agent-service';

export interface SubmissionWorkflowConfig {
  agentId: string;
  campaignId: number;
  campaignContext: {
    title: string;
    description: string;
    brandContext?: string;
    targetAudience?: string;
    guidelines?: string;
  };
  providers: {
    aiProvider: string;
    aiModel?: string;
    apiKey: string;
  };
  minerWallet: string;
  autoSubmitToBlockchain?: boolean;
  batchSize?: number;
}

export interface SubmissionProgress {
  id: string;
  status: 'generating' | 'uploading_ipfs' | 'preparing_blockchain' | 'waiting_batch' | 'submitting_batch' | 'completed' | 'failed';
  stage: string;
  progress: number; // 0-100
  message: string;
  error?: string;
  timingData: {
    started: Date;
    contentGenerated?: Date;
    ipfsUploaded?: Date;
    batchSubmitted?: Date;
    completed?: Date;
  };
  results?: {
    contentResponse?: ContentGenerationResponse;
    ipfsResponse?: IPFSUploadResponse;
    blockchainResponse?: TransactionResult;
    submissionData?: SubmissionData;
  };
}

export interface BatchCoordinator {
  id: string;
  campaignId: number;
  submissions: SubmissionData[];
  targetSize: number;
  currentSize: number;
  status: 'collecting' | 'ready' | 'submitting' | 'completed' | 'failed';
  createdAt: Date;
  submittedAt?: Date;
  transactionResult?: TransactionResult;
}

export class SubmissionWorkflowService {
  private activeSubmissions: Map<string, SubmissionProgress> = new Map();
  private batchCoordinators: Map<number, BatchCoordinator> = new Map(); // campaignId -> BatchCoordinator
  private submissionQueue: SubmissionWorkflowConfig[] = [];
  private isProcessing = false;
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.loadState();
    this.startBatchProcessor();
  }

  // Main submission workflow
  public async submitContent(config: SubmissionWorkflowConfig): Promise<string> {
    const submissionId = this.generateSubmissionId();
    
    const progress: SubmissionProgress = {
      id: submissionId,
      status: 'generating',
      stage: 'Initializing content generation',
      progress: 0,
      message: 'Preparing to generate content...',
      timingData: {
        started: new Date()
      },
      results: {}
    };

    this.activeSubmissions.set(submissionId, progress);
    this.saveState();

    // Start the workflow asynchronously
    this.processSubmission(config, progress).catch(error => {
      console.error(`Submission ${submissionId} failed:`, error);
      progress.status = 'failed';
      progress.error = error.message;
      this.activeSubmissions.set(submissionId, progress);
      this.saveState();
    });

    return submissionId;
  }

  private async processSubmission(config: SubmissionWorkflowConfig, progress: SubmissionProgress): Promise<void> {
    try {
      // Stage 1: Generate Content
      await this.generateContent(config, progress);
      
      // Stage 2: Upload to IPFS
      await this.uploadToIPFS(config, progress);
      
      // Stage 3: Prepare for blockchain
      await this.prepareForBlockchain(config, progress);
      
      // Stage 4: Add to batch or submit
      if (config.autoSubmitToBlockchain !== false) {
        await this.addToBatch(config, progress);
      } else {
        progress.status = 'completed';
        progress.stage = 'Content ready for manual submission';
        progress.progress = 100;
        progress.message = 'Content generated and uploaded to IPFS';
        progress.timingData.completed = new Date();
      }

      this.activeSubmissions.set(progress.id, progress);
      this.saveState();

    } catch (error) {
      throw error;
    }
  }

  private async generateContent(config: SubmissionWorkflowConfig, progress: SubmissionProgress): Promise<void> {
    progress.status = 'generating';
    progress.stage = 'Generating content with AI agent';
    progress.progress = 10;
    progress.message = 'AI agent is creating content...';
    this.activeSubmissions.set(progress.id, progress);

    // Get agent and enhance prompt
    const agent = agentService.getAgent(config.agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    // Create enhanced prompt using agent's learning
    const basePrompt = `Campaign: ${config.campaignContext.title}\n\nDescription: ${config.campaignContext.description}`;
    const enhancedRequest = agentService.generateEnhancedPrompt(
      agent,
      basePrompt,
      {
        brandContext: config.campaignContext.brandContext,
        targetAudience: config.campaignContext.targetAudience
      }
    );

    // Add any campaign-specific guidelines
    if (config.campaignContext.guidelines) {
      enhancedRequest.prompt += `\n\nGuidelines: ${config.campaignContext.guidelines}`;
    }

    progress.progress = 20;
    progress.message = 'Contacting AI provider...';
    this.activeSubmissions.set(progress.id, progress);

    // Generate content
    const contentResponse = await aiProviderManager.generateContent(
      config.providers.aiProvider,
      enhancedRequest,
      config.providers.apiKey
    );

    progress.progress = 50;
    progress.message = 'Content generated successfully';
    progress.timingData.contentGenerated = new Date();
    progress.results!.contentResponse = contentResponse;
    this.activeSubmissions.set(progress.id, progress);

    // Update agent performance
    agentService.updateAgentPerformance(
      config.agentId,
      contentResponse,
      { id: config.campaignId, brandContext: config.campaignContext.brandContext }
    );

    // Adapt agent settings based on performance
    agentService.adaptAgentSettings(config.agentId);
  }

  private async uploadToIPFS(config: SubmissionWorkflowConfig, progress: SubmissionProgress): Promise<void> {
    progress.status = 'uploading_ipfs';
    progress.stage = 'Uploading content to IPFS';
    progress.progress = 60;
    progress.message = 'Uploading to IPFS for permanent storage...';
    this.activeSubmissions.set(progress.id, progress);

    const contentResponse = progress.results!.contentResponse!;
    
    // Prepare IPFS content
    const ipfsContent: IPFSContent = {
      content: contentResponse.content,
      contentType: contentResponse.contentType,
      metadata: {
        title: `Campaign ${config.campaignId} Submission`,
        description: config.campaignContext.title,
        campaignId: config.campaignId,
        minerId: parseInt(config.agentId.split('_')[1]) || 0,
        agentPersonality: contentResponse.provider,
        provider: contentResponse.provider,
        model: contentResponse.model,
        qualityScore: contentResponse.metadata.qualityScore,
        brandAlignmentScore: contentResponse.metadata.brandAlignmentScore
      }
    };

    // Upload to IPFS
    const ipfsResponse = await ipfsService.uploadContent(ipfsContent);

    progress.progress = 75;
    progress.message = `Content uploaded to IPFS: ${ipfsResponse.cid}`;
    progress.timingData.ipfsUploaded = new Date();
    progress.results!.ipfsResponse = ipfsResponse;
    this.activeSubmissions.set(progress.id, progress);
  }

  private async prepareForBlockchain(config: SubmissionWorkflowConfig, progress: SubmissionProgress): Promise<void> {
    progress.status = 'preparing_blockchain';
    progress.stage = 'Preparing blockchain submission';
    progress.progress = 80;
    progress.message = 'Preparing submission data for blockchain...';
    this.activeSubmissions.set(progress.id, progress);

    const contentResponse = progress.results!.contentResponse!;
    const ipfsResponse = progress.results!.ipfsResponse!;

    // Prepare submission data for blockchain
    const submissionData = blockchainService.prepareSubmissionForBlockchain(
      contentResponse.content,
      ipfsResponse,
      config.campaignId,
      contentResponse.model,
      contentResponse.metadata.tokensUsed || 0,
      config.minerWallet
    );

    // Store the prepared submission data
    progress.results!.submissionData = submissionData;
    progress.progress = 85;
    progress.message = 'Blockchain submission data prepared';
    this.activeSubmissions.set(progress.id, progress);
  }

  private async addToBatch(config: SubmissionWorkflowConfig, progress: SubmissionProgress): Promise<void> {
    progress.status = 'waiting_batch';
    progress.stage = 'Adding to batch coordinator';
    progress.progress = 90;
    progress.message = 'Adding to submission batch...';
    this.activeSubmissions.set(progress.id, progress);

    const submissionData = progress.results!.submissionData as SubmissionData;
    
    // Get or create batch coordinator for this campaign
    let batchCoordinator = this.batchCoordinators.get(config.campaignId);
    
    if (!batchCoordinator || batchCoordinator.status !== 'collecting') {
      batchCoordinator = {
        id: this.generateBatchId(),
        campaignId: config.campaignId,
        submissions: [],
        targetSize: this.BATCH_SIZE,
        currentSize: 0,
        status: 'collecting',
        createdAt: new Date()
      };
      this.batchCoordinators.set(config.campaignId, batchCoordinator);
    }

    // Add submission to batch
    batchCoordinator.submissions.push(submissionData);
    batchCoordinator.currentSize++;

    progress.message = `Added to batch (${batchCoordinator.currentSize}/${batchCoordinator.targetSize})`;
    this.activeSubmissions.set(progress.id, progress);

    // Check if batch is ready
    if (batchCoordinator.currentSize >= batchCoordinator.targetSize) {
      await this.submitBatch(batchCoordinator);
    } else {
      // Set timeout for partial batch submission
      setTimeout(() => {
        if (batchCoordinator && batchCoordinator.status === 'collecting') {
          this.submitBatch(batchCoordinator).catch(console.error);
        }
      }, this.BATCH_TIMEOUT);
    }

    this.saveState();
  }

  private async submitBatch(batchCoordinator: BatchCoordinator): Promise<void> {
    if (batchCoordinator.status !== 'collecting') {
      return; // Already processed
    }

    batchCoordinator.status = 'submitting';
    batchCoordinator.submittedAt = new Date();

    console.log(`📦 Submitting batch for campaign ${batchCoordinator.campaignId} with ${batchCoordinator.currentSize} submissions`);

    try {
      // Ensure we have exactly 50 submissions (pad with dummy if needed)
      const submissions = [...batchCoordinator.submissions];
      while (submissions.length < this.BATCH_SIZE) {
        // Create dummy submission
        submissions.push({
          campaignId: batchCoordinator.campaignId,
          content: '',
          model: 'dummy',
          tokensUsed: 0,
          minerWallet: '0x0000000000000000000000000000000000000000',
          cid: 'QmDummyHash',
          contentHash: 'dummy'
        });
      }

      const batchData: BatchSubmissionData = {
        submissions: submissions.slice(0, this.BATCH_SIZE)
      };

      // Submit to blockchain
      const transactionResult = await blockchainService.submitContentBatch(batchData);
      
      batchCoordinator.transactionResult = transactionResult;
      
      if (transactionResult.success) {
        batchCoordinator.status = 'completed';
        console.log(`✅ Batch submitted successfully: ${transactionResult.hash}`);
        
        // Update all related submissions
        this.updateSubmissionsInBatch(batchCoordinator, 'completed', transactionResult);
      } else {
        batchCoordinator.status = 'failed';
        console.error(`❌ Batch submission failed: ${transactionResult.error}`);
        
        // Update all related submissions
        this.updateSubmissionsInBatch(batchCoordinator, 'failed', transactionResult);
      }

    } catch (error) {
      console.error('Batch submission error:', error);
      batchCoordinator.status = 'failed';
      batchCoordinator.transactionResult = {
        success: false,
        hash: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      this.updateSubmissionsInBatch(batchCoordinator, 'failed', batchCoordinator.transactionResult);
    }

    this.saveState();
  }

  private updateSubmissionsInBatch(
    batchCoordinator: BatchCoordinator, 
    status: 'completed' | 'failed',
    transactionResult: TransactionResult
  ): void {
    // Find all submissions that belong to this batch
    for (const [submissionId, progress] of Array.from(this.activeSubmissions.entries())) {
      if (progress.results?.submissionData && 
          batchCoordinator.submissions.some(sub => 
            sub.cid === progress.results?.submissionData?.cid && 
            sub.campaignId === progress.results?.submissionData?.campaignId
          )) {
        
        progress.status = status;
        progress.progress = 100;
        progress.timingData.completed = new Date();
        progress.results.blockchainResponse = transactionResult;
        
        if (status === 'completed') {
          progress.stage = 'Submission completed successfully';
          progress.message = `Transaction confirmed: ${transactionResult.hash}`;
        } else {
          progress.stage = 'Submission failed';
          progress.message = `Blockchain submission failed: ${transactionResult.error}`;
          progress.error = transactionResult.error;
        }
        
        this.activeSubmissions.set(submissionId, progress);
      }
    }
  }

  // Batch processing
  private startBatchProcessor(): void {
    setInterval(() => {
      this.processBatchTimeouts();
    }, 30000); // Check every 30 seconds
  }

  private processBatchTimeouts(): void {
    const now = Date.now();
    
    for (const [campaignId, batchCoordinator] of Array.from(this.batchCoordinators.entries())) {
      if (batchCoordinator.status === 'collecting') {
        const elapsed = now - batchCoordinator.createdAt.getTime();
        
        if (elapsed > this.BATCH_TIMEOUT && batchCoordinator.currentSize > 0) {
          console.log(`⏰ Batch timeout reached for campaign ${campaignId}, submitting partial batch`);
          this.submitBatch(batchCoordinator).catch(console.error);
        }
      }
    }
  }

  // Queue management
  public async processQueue(): Promise<void> {
    if (this.isProcessing || this.submissionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.submissionQueue.length > 0) {
        const config = this.submissionQueue.shift()!;
        await this.submitContent(config);
        
        // Small delay between submissions
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Queue processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  public addToQueue(config: SubmissionWorkflowConfig): void {
    this.submissionQueue.push(config);
    this.processQueue().catch(console.error);
  }

  // Status and monitoring
  public getSubmissionProgress(submissionId: string): SubmissionProgress | undefined {
    return this.activeSubmissions.get(submissionId);
  }

  public getAllActiveSubmissions(): SubmissionProgress[] {
    return Array.from(this.activeSubmissions.values());
  }

  public getBatchStatus(campaignId: number): BatchCoordinator | undefined {
    return this.batchCoordinators.get(campaignId);
  }

  public getAllBatches(): BatchCoordinator[] {
    return Array.from(this.batchCoordinators.values());
  }

  public getSubmissionStats(): {
    active: number;
    completed: number;
    failed: number;
    batches: { collecting: number; ready: number; submitting: number; completed: number; failed: number };
  } {
    const submissions = this.getAllActiveSubmissions();
    const batches = this.getAllBatches();

    return {
      active: submissions.filter(s => ['generating', 'uploading_ipfs', 'preparing_blockchain', 'waiting_batch', 'submitting_batch'].includes(s.status)).length,
      completed: submissions.filter(s => s.status === 'completed').length,
      failed: submissions.filter(s => s.status === 'failed').length,
      batches: {
        collecting: batches.filter(b => b.status === 'collecting').length,
        ready: batches.filter(b => b.status === 'ready').length,
        submitting: batches.filter(b => b.status === 'submitting').length,
        completed: batches.filter(b => b.status === 'completed').length,
        failed: batches.filter(b => b.status === 'failed').length
      }
    };
  }

  // Utilities
  private generateSubmissionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // State persistence
  private saveState(): void {
    try {
      const state = {
        activeSubmissions: Array.from(this.activeSubmissions.entries()),
        batchCoordinators: Array.from(this.batchCoordinators.entries()),
        submissionQueue: this.submissionQueue
      };
      localStorage.setItem('roastpower_submission_workflow', JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save submission workflow state:', error);
    }
  }

  private loadState(): void {
    try {
      const saved = localStorage.getItem('roastpower_submission_workflow');
      if (saved) {
        const state = JSON.parse(saved);
        
        this.activeSubmissions = new Map(state.activeSubmissions?.map(([id, progress]: [string, any]) => [
          id,
          {
            ...progress,
            timingData: {
              ...progress.timingData,
              started: new Date(progress.timingData.started),
              contentGenerated: progress.timingData.contentGenerated ? new Date(progress.timingData.contentGenerated) : undefined,
              ipfsUploaded: progress.timingData.ipfsUploaded ? new Date(progress.timingData.ipfsUploaded) : undefined,
              batchSubmitted: progress.timingData.batchSubmitted ? new Date(progress.timingData.batchSubmitted) : undefined,
              completed: progress.timingData.completed ? new Date(progress.timingData.completed) : undefined
            }
          }
        ]) || []);

        this.batchCoordinators = new Map(state.batchCoordinators?.map(([id, batch]: [number, any]) => [
          id,
          {
            ...batch,
            createdAt: new Date(batch.createdAt),
            submittedAt: batch.submittedAt ? new Date(batch.submittedAt) : undefined
          }
        ]) || []);

        this.submissionQueue = state.submissionQueue || [];
      }
    } catch (error) {
      console.error('Failed to load submission workflow state:', error);
    }
  }

  // Cleanup
  public cleanup(): void {
    // Remove completed submissions older than 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const [submissionId, progress] of Array.from(this.activeSubmissions.entries())) {
      if ((progress.status === 'completed' || progress.status === 'failed') &&
          progress.timingData.completed &&
          progress.timingData.completed.getTime() < oneDayAgo) {
        this.activeSubmissions.delete(submissionId);
      }
    }

    // Remove old batch coordinators
    for (const [campaignId, batch] of Array.from(this.batchCoordinators.entries())) {
      if ((batch.status === 'completed' || batch.status === 'failed') &&
          batch.submittedAt &&
          batch.submittedAt.getTime() < oneDayAgo) {
        this.batchCoordinators.delete(campaignId);
      }
    }

    this.saveState();
  }
}

// Export singleton instance
export const submissionWorkflowService = new SubmissionWorkflowService(); 