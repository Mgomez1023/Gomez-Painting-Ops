import type {
  Campaign,
  CampaignContentPublishResponse,
  CampaignContentQueueItem,
  CampaignContentQueueSaveResponse,
  CampaignContentRunDueResponse,
  CampaignDraftSet,
  CompletedJob,
  ContentDraft,
  ContentQueueItem,
  ContentQueueSaveResponse,
  ManualSocialPostGenerateRequest,
  SocialQueueGenerateResponse,
  WeeklySocialQueueGenerateRequest,
} from './types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '' : 'http://127.0.0.1:8000');

export function getMediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let body: unknown = null;
    try {
      body = await response.json();
      if (
        body &&
        typeof body === 'object' &&
        'detail' in body &&
        typeof (body as { detail?: unknown }).detail === 'string'
      ) {
        const { detail } = body as { detail: string };
        message = detail;
      }
    } catch {
      // Keep the HTTP status message when the backend does not return JSON.
    }
    throw new ApiError(message, response.status, body);
  }

  return (await response.json()) as T;
}

export function getJobs(): Promise<CompletedJob[]> {
  return request<CompletedJob[]>('/jobs');
}

export function getContentQueue(): Promise<ContentQueueItem[]> {
  return request<ContentQueueItem[]>('/content-queue');
}

export function getCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>('/campaigns');
}

export function getCampaignContentQueue(): Promise<CampaignContentQueueItem[]> {
  return request<CampaignContentQueueItem[]>('/campaign-content-queue');
}

export function getWeeklySocialQueue(): Promise<CampaignContentQueueItem[]> {
  return request<CampaignContentQueueItem[]>('/posts/weekly');
}

export function previewDraft(jobId: string): Promise<ContentDraft> {
  return request<ContentDraft>(`/content/generate-from-job/${encodeURIComponent(jobId)}`, {
    method: 'POST',
  });
}

export function generateAndSave(jobId: string, force = false): Promise<ContentQueueSaveResponse> {
  const forceQuery = force ? '?force=true' : '';
  return request<ContentQueueSaveResponse>(`/content/generate-from-job/${encodeURIComponent(jobId)}/save${forceQuery}`, {
    method: 'POST',
  });
}

export function approveContent(contentId: string): Promise<ContentQueueItem> {
  return request<ContentQueueItem>(`/content-queue/${encodeURIComponent(contentId)}/approve`, {
    method: 'POST',
  });
}

export function rejectContent(contentId: string): Promise<ContentQueueItem> {
  return request<ContentQueueItem>(`/content-queue/${encodeURIComponent(contentId)}/reject`, {
    method: 'POST',
  });
}

export function markPublished(contentId: string): Promise<ContentQueueItem> {
  return request<ContentQueueItem>(`/content-queue/${encodeURIComponent(contentId)}/mark-published`, {
    method: 'POST',
  });
}

export function previewCampaignDrafts(campaignId: string): Promise<CampaignDraftSet> {
  return request<CampaignDraftSet>(`/campaigns/${encodeURIComponent(campaignId)}/generate-content`, {
    method: 'POST',
  });
}

export function generateAndSaveCampaign(campaignId: string, force = false): Promise<CampaignContentQueueSaveResponse> {
  const forceQuery = force ? '?force=true' : '';
  return request<CampaignContentQueueSaveResponse>(
    `/campaigns/${encodeURIComponent(campaignId)}/generate-content/save${forceQuery}`,
    {
      method: 'POST',
    },
  );
}

export function generateWeeklySocialPosts(
  payload: WeeklySocialQueueGenerateRequest = {},
): Promise<SocialQueueGenerateResponse> {
  return request<SocialQueueGenerateResponse>('/posts/generate-weekly', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function generateManualSocialPost(
  payload: ManualSocialPostGenerateRequest = {},
): Promise<SocialQueueGenerateResponse> {
  return request<SocialQueueGenerateResponse>('/posts/generate-post', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function approveCampaignContent(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/campaign-content-queue/${encodeURIComponent(contentId)}/approve`, {
    method: 'POST',
  });
}

export function rejectCampaignContent(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/campaign-content-queue/${encodeURIComponent(contentId)}/reject`, {
    method: 'POST',
  });
}

export function markCampaignPublished(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(
    `/campaign-content-queue/${encodeURIComponent(contentId)}/mark-published`,
    {
      method: 'POST',
    },
  );
}

export function markCampaignCopied(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/copy`, {
    method: 'POST',
  });
}

export function markCampaignPosted(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/posted`, {
    method: 'POST',
  });
}

export function markCampaignSkipped(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/skip`, {
    method: 'POST',
  });
}

export function restorePostToQueue(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/restore`, {
    method: 'POST',
  });
}

export function updatePostDraftText(contentId: string, draftText: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/draft-text`, {
    method: 'PATCH',
    body: JSON.stringify({ draft_text: draftText }),
  });
}

export function publishCampaignContent(contentId: string): Promise<CampaignContentPublishResponse> {
  return request<CampaignContentPublishResponse>(`/campaign-content-queue/${encodeURIComponent(contentId)}/publish`, {
    method: 'POST',
  });
}

export function scheduleCampaignContent(contentId: string, scheduledAt: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/campaign-content-queue/${encodeURIComponent(contentId)}/schedule`, {
    method: 'POST',
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
}

export function runDuePublishing(): Promise<CampaignContentRunDueResponse> {
  return request<CampaignContentRunDueResponse>('/publisher/run-due', {
    method: 'POST',
  });
}
