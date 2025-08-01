import axios from 'axios';

export interface IPFSUploadResponse {
  success: boolean;
  cid: string;
  size: number;
  url: string;
  pinataUrl?: string;
  timestamp: number;
  contentHash: string;
}

export interface IPFSContent {
  content: string;
  contentType: 'text' | 'image' | 'video' | 'audio';
  metadata: {
    title?: string;
    description?: string;
    campaignId?: number;
    minerId?: number;
    agentPersonality?: string;
    provider?: string;
    model?: string;
    qualityScore?: number;
    brandAlignmentScore?: number;
  };
}

export interface PinataConfig {
  apiKey: string;
  secretApiKey: string;
  jwt?: string;
}

export class IPFSService {
  private pinataConfig: PinataConfig | null = null;
  private readonly PINATA_API_URL = 'https://api.pinata.cloud';
  private readonly PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

  constructor() {
    this.loadPinataConfig();
  }

  private loadPinataConfig(): void {
    try {
      const config = localStorage.getItem('roastpower_pinata_config');
      if (config) {
        this.pinataConfig = JSON.parse(config);
      }
    } catch (error) {
      console.error('Failed to load Pinata config:', error);
    }
  }

  public configurePinata(config: PinataConfig): void {
    this.pinataConfig = config;
    localStorage.setItem('roastpower_pinata_config', JSON.stringify(config));
  }

  public isPinataConfigured(): boolean {
    return !!(this.pinataConfig?.apiKey && this.pinataConfig?.secretApiKey);
  }

  private generateContentHash(content: string): string {
    // Simple hash function for content verification
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private async uploadToPinata(ipfsContent: IPFSContent): Promise<IPFSUploadResponse> {
    if (!this.isPinataConfigured()) {
      throw new Error('Pinata not configured. Please configure Pinata API credentials.');
    }

    try {
      // Prepare content for upload
      const uploadData = {
        pinataContent: {
          content: ipfsContent.content,
          contentType: ipfsContent.contentType,
          metadata: {
            ...ipfsContent.metadata,
            uploadedAt: new Date().toISOString(),
            source: 'roastpower-mining-interface'
          }
        },
        pinataMetadata: {
          name: `roastpower-${ipfsContent.contentType}-${Date.now()}`,
          keyvalues: {
            campaign: ipfsContent.metadata.campaignId?.toString() || 'unknown',
            miner: ipfsContent.metadata.minerId?.toString() || 'unknown',
            contentType: ipfsContent.contentType,
            personality: ipfsContent.metadata.agentPersonality || 'unknown',
            provider: ipfsContent.metadata.provider || 'unknown',
            qualityScore: ipfsContent.metadata.qualityScore?.toString() || '0'
          }
        },
        pinataOptions: {
          cidVersion: 1,
          wrapWithDirectory: false
        }
      };

      const response = await axios.post(`${this.PINATA_API_URL}/pinning/pinJSONToIPFS`, uploadData, {
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': this.pinataConfig!.apiKey,
          'pinata_secret_api_key': this.pinataConfig!.secretApiKey,
        },
      });

      if (response.data && response.data.IpfsHash) {
        const cid = response.data.IpfsHash;
        const contentHash = this.generateContentHash(ipfsContent.content);
        
        return {
          success: true,
          cid,
          size: response.data.PinSize || 0,
          url: `${this.PINATA_GATEWAY}/${cid}`,
          pinataUrl: `https://app.pinata.cloud/pinmanager?hash=${cid}`,
          timestamp: Date.now(),
          contentHash
        };
      } else {
        throw new Error('Invalid response from Pinata API');
      }
    } catch (error: any) {
      console.error('Pinata upload error:', error);
      throw new Error(`Failed to upload to Pinata: ${error.response?.data?.error || error.message}`);
    }
  }

  public async uploadContent(ipfsContent: IPFSContent): Promise<IPFSUploadResponse> {
    try {
      // Validate content
      if (!ipfsContent.content || ipfsContent.content.trim().length === 0) {
        throw new Error('Content cannot be empty');
      }

      if (ipfsContent.content.length > 1000000) { // 1MB limit for JSON content
        throw new Error('Content too large. Maximum size is 1MB.');
      }

      // Upload to Pinata
      const result = await this.uploadToPinata(ipfsContent);

      // Store local record for tracking
      this.storeLocalRecord(result, ipfsContent);

      return result;
    } catch (error: any) {
      console.error('IPFS upload error:', error);
      throw error;
    }
  }

  private storeLocalRecord(uploadResult: IPFSUploadResponse, content: IPFSContent): void {
    try {
      const records = this.getLocalRecords();
      const record = {
        ...uploadResult,
        originalContent: content,
        uploadedAt: new Date().toISOString()
      };
      
      records.push(record);
      
      // Keep only last 100 records
      if (records.length > 100) {
        records.splice(0, records.length - 100);
      }
      
      localStorage.setItem('roastpower_ipfs_records', JSON.stringify(records));
    } catch (error) {
      console.error('Failed to store local IPFS record:', error);
    }
  }

  public getLocalRecords(): any[] {
    try {
      const records = localStorage.getItem('roastpower_ipfs_records');
      return records ? JSON.parse(records) : [];
    } catch (error) {
      console.error('Failed to load local IPFS records:', error);
      return [];
    }
  }

  public async verifyContent(cid: string, expectedHash: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.PINATA_GATEWAY}/${cid}`, {
        timeout: 10000
      });

      if (response.data && response.data.content) {
        const actualHash = this.generateContentHash(response.data.content);
        return actualHash === expectedHash;
      }

      return false;
    } catch (error) {
      console.error('Content verification error:', error);
      return false;
    }
  }

  public async retrieveContent(cid: string): Promise<IPFSContent | null> {
    try {
      const response = await axios.get(`${this.PINATA_GATEWAY}/${cid}`, {
        timeout: 10000
      });

      if (response.data) {
        return response.data as IPFSContent;
      }

      return null;
    } catch (error) {
      console.error('Content retrieval error:', error);
      return null;
    }
  }

  public async testConnection(): Promise<boolean> {
    if (!this.isPinataConfigured()) {
      return false;
    }

    try {
      const response = await axios.get(`${this.PINATA_API_URL}/data/testAuthentication`, {
        headers: {
          'pinata_api_key': this.pinataConfig!.apiKey,
          'pinata_secret_api_key': this.pinataConfig!.secretApiKey,
        },
        timeout: 5000
      });

      return response.status === 200 && response.data.message === 'Congratulations! You are communicating with the Pinata API!';
    } catch (error) {
      console.error('Pinata connection test failed:', error);
      return false;
    }
  }

  public async getPinList(limit: number = 10): Promise<any[]> {
    if (!this.isPinataConfigured()) {
      throw new Error('Pinata not configured');
    }

    try {
      const response = await axios.get(`${this.PINATA_API_URL}/data/pinList`, {
        headers: {
          'pinata_api_key': this.pinataConfig!.apiKey,
          'pinata_secret_api_key': this.pinataConfig!.secretApiKey,
        },
        params: {
          pageLimit: limit,
          status: 'pinned',
          metadata: {
            keyvalues: {
              source: 'roastpower-mining-interface'
            }
          }
        }
      });

      return response.data.rows || [];
    } catch (error) {
      console.error('Failed to get pin list:', error);
      return [];
    }
  }

  public generateGatewayUrl(cid: string): string {
    return `${this.PINATA_GATEWAY}/${cid}`;
  }

  public generatePublicGatewayUrl(cid: string): string {
    return `https://ipfs.io/ipfs/${cid}`;
  }

  public clearLocalRecords(): void {
    localStorage.removeItem('roastpower_ipfs_records');
  }

  public getStorageStats(): { totalUploads: number; totalSize: number; lastUpload: string | null } {
    const records = this.getLocalRecords();
    const totalUploads = records.length;
    const totalSize = records.reduce((sum, record) => sum + (record.size || 0), 0);
    const lastUpload = records.length > 0 ? records[records.length - 1].uploadedAt : null;

    return { totalUploads, totalSize, lastUpload };
  }

  // Batch upload for team collaboration
  public async uploadBatch(contents: IPFSContent[]): Promise<IPFSUploadResponse[]> {
    const results: IPFSUploadResponse[] = [];
    const errors: string[] = [];

    for (let i = 0; i < contents.length; i++) {
      try {
        const result = await this.uploadContent(contents[i]);
        results.push(result);
        
        // Add small delay to avoid rate limiting
        if (i < contents.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        errors.push(`Content ${i + 1}: ${error.message}`);
        results.push({
          success: false,
          cid: '',
          size: 0,
          url: '',
          timestamp: Date.now(),
          contentHash: '',
          error: error.message
        } as any);
      }
    }

    if (errors.length > 0) {
      console.warn('Batch upload completed with errors:', errors);
    }

    return results;
  }
}

// Export singleton instance
export const ipfsService = new IPFSService(); 