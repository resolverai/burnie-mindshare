export enum ContentRequestStatus {
  REQUESTED = 'REQUESTED',
  INPROGRESS = 'INPROGRESS',
  COMPLETED = 'COMPLETED'
}

export interface ContentRequest {
  id: string;
  projectName: string;
  platform: string;
  campaignLinks: string;
  status: ContentRequestStatus;
  walletAddress?: string;
  adminNotes?: string;
  generatedContent?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRequestData {
  projectName: string;
  platform: string;
  campaignLinks: string;
  walletAddress?: string;
}
