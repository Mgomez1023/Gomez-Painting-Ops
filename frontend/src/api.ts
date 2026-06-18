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
  PhotoAsset,
  PhotoAssetPayload,
  SocialQueueGenerateResponse,
  VisibilityGenerationRequest,
  VisibilityGenerationResponse,
  WeeklySocialQueueGenerateRequest,
  Business,
  BusinessContext,
  BusinessContextPayload,
  BusinessPayload,
  BusinessPhotoAsset,
  GeneratedPost,
  GeneratedPostPayload,
  BusinessPublishTarget,
  PublishTargetPlatform,
  SocialConnection,
  SocialTarget,
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

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const bodyText = await response.text().catch(() => '');
    const preview = bodyText.trim().slice(0, 80);
    const message = `API endpoint ${path} returned ${contentType || 'a non-JSON response'} instead of JSON.${
      preview ? ` Response starts with: ${preview}` : ''
    }`;
    throw new ApiError(message, response.status, bodyText);
  }

  try {
    return (await response.json()) as T;
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? `API endpoint ${path} returned invalid JSON. ${err.message}` : `API endpoint ${path} returned invalid JSON.`,
      response.status,
      null,
    );
  }
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

export function getWeeklySocialQueue(weekStartDate?: string | null): Promise<CampaignContentQueueItem[]> {
  const query = weekStartDate ? `?week_start_date=${encodeURIComponent(weekStartDate)}` : '';
  return request<CampaignContentQueueItem[]>(`/posts/weekly${query}`);
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

export function generateVisibilityContent(
  payload: VisibilityGenerationRequest,
): Promise<VisibilityGenerationResponse> {
  return request<VisibilityGenerationResponse>('/visibility/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listBusinesses(): Promise<Business[]> {
  return request<Business[]>('/businesses');
}

export function createBusiness(payload: BusinessPayload): Promise<Business> {
  return request<Business>('/businesses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBusiness(businessId: string, payload: Partial<BusinessPayload>): Promise<Business> {
  return request<Business>(`/businesses/${encodeURIComponent(businessId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getBusinessContext(businessId: string): Promise<BusinessContext> {
  return request<BusinessContext>(`/businesses/${encodeURIComponent(businessId)}/context`);
}

export function upsertBusinessContext(
  businessId: string,
  payload: BusinessContextPayload,
): Promise<BusinessContext> {
  return request<BusinessContext>(`/businesses/${encodeURIComponent(businessId)}/context`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function listBusinessPhotoAssets(businessId: string): Promise<BusinessPhotoAsset[]> {
  return request<BusinessPhotoAsset[]>(`/businesses/${encodeURIComponent(businessId)}/photos`);
}

export function createBusinessPhotoAsset(
  businessId: string,
  payload: Omit<BusinessPhotoAsset, 'id' | 'business_id' | 'created_at' | 'updated_at'>,
): Promise<BusinessPhotoAsset> {
  return request<BusinessPhotoAsset>(`/businesses/${encodeURIComponent(businessId)}/photos`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteBusinessPhotoAsset(businessId: string, photoAssetId: string): Promise<BusinessPhotoAsset> {
  return request<BusinessPhotoAsset>(
    `/businesses/${encodeURIComponent(businessId)}/photos/${encodeURIComponent(photoAssetId)}`,
    {
      method: 'DELETE',
    },
  );
}

export function listGeneratedPosts(businessId: string): Promise<GeneratedPost[]> {
  return request<GeneratedPost[]>(`/businesses/${encodeURIComponent(businessId)}/generated-posts`);
}

export function createGeneratedPost(businessId: string, payload: GeneratedPostPayload): Promise<GeneratedPost> {
  return request<GeneratedPost>(`/businesses/${encodeURIComponent(businessId)}/generated-posts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateGeneratedPost(
  businessId: string,
  generatedPostId: string,
  payload: Partial<GeneratedPostPayload>,
): Promise<GeneratedPost> {
  return request<GeneratedPost>(
    `/businesses/${encodeURIComponent(businessId)}/generated-posts/${encodeURIComponent(generatedPostId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
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

export function updatePostScheduledAt(contentId: string, scheduledAt: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
}

export function updatePostImage(
  contentId: string,
  payload: Pick<CampaignContentQueueItem, 'image_filename' | 'image_path' | 'image_url'>,
): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}/image`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deletePost(contentId: string): Promise<CampaignContentQueueItem> {
  return request<CampaignContentQueueItem>(`/posts/${encodeURIComponent(contentId)}`, {
    method: 'DELETE',
  });
}

export function getPhotoAssets(businessId = 'marom-painting'): Promise<PhotoAsset[]> {
  return request<PhotoAsset[]>(`/photo-assets?business_id=${encodeURIComponent(businessId)}`);
}

export function createPhotoAsset(payload: PhotoAssetPayload): Promise<PhotoAsset> {
  return request<PhotoAsset>('/photo-assets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePhotoAsset(assetId: string, payload: Partial<PhotoAssetPayload>): Promise<PhotoAsset> {
  return request<PhotoAsset>(`/photo-assets/${encodeURIComponent(assetId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deletePhotoAsset(assetId: string, businessId = 'marom-painting'): Promise<PhotoAsset> {
  return request<PhotoAsset>(
    `/photo-assets/${encodeURIComponent(assetId)}?business_id=${encodeURIComponent(businessId)}`,
    {
      method: 'DELETE',
    },
  );
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

export function listSocialConnections(): Promise<SocialConnection[]> {
  return request<SocialConnection[]>('/social-connections');
}

export function listSocialTargets(): Promise<SocialTarget[]> {
  return request<SocialTarget[]>('/social-targets');
}

export function listBusinessPublishTargets(businessId: string): Promise<BusinessPublishTarget[]> {
  return request<BusinessPublishTarget[]>(`/businesses/${encodeURIComponent(businessId)}/publish-targets`);
}

export function createFakeMetaConnection(): Promise<SocialConnection> {
  return request<SocialConnection>('/social-connections/fake-meta', {
    method: 'POST',
  });
}

export function createFakeGoogleConnection(): Promise<SocialConnection> {
  return request<SocialConnection>('/social-connections/fake-google', {
    method: 'POST',
  });
}

export function disconnectSocialConnection(connectionId: string): Promise<SocialConnection> {
  return request<SocialConnection>(`/social-connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
  });
}

export function assignBusinessPublishTarget(
  businessId: string,
  platform: PublishTargetPlatform,
  socialTargetId: string,
): Promise<BusinessPublishTarget> {
  return request<BusinessPublishTarget>(
    `/businesses/${encodeURIComponent(businessId)}/publish-targets/${encodeURIComponent(platform)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ social_target_id: socialTargetId }),
    },
  );
}

export function unassignBusinessPublishTarget(
  businessId: string,
  platform: PublishTargetPlatform,
): Promise<BusinessPublishTarget> {
  return request<BusinessPublishTarget>(
    `/businesses/${encodeURIComponent(businessId)}/publish-targets/${encodeURIComponent(platform)}`,
    {
      method: 'DELETE',
    },
  );
}
