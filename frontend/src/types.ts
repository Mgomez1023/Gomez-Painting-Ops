export type CompletedJob = {
  job_id: string | null;
  customer: string;
  job_type: string;
  location: string;
  date_completed: string;
  photos_uploaded: boolean;
  notes: string;
  before_photo_url: string | null;
  after_photo_url: string | null;
  room_area: string | null;
  paint_colors: string | null;
  customer_outcome: string | null;
  project_highlights: string | null;
};

export type ContentDraft = {
  facebook_post: string;
  google_business_post: string;
  instagram_caption: string;
  review_request_text: string;
  confidence: number;
  needs_human_review: boolean;
};

export type ContentQueueItem = {
  content_id: string;
  job_id: string;
  platform: 'Facebook' | 'Google Business' | 'Instagram' | 'Review Request';
  draft_text: string;
  status: string;
  approved: string;
  published: string;
  created_at: string;
  notes: string;
};

export type ContentQueueSaveResponse = {
  content_draft: ContentDraft;
  queue_items: ContentQueueItem[];
};

export type ContentQueueConflictResponse = {
  detail: string;
  existing_queue_items: ContentQueueItem[];
};

export type Campaign = {
  campaign_id: string;
  campaign_name: string;
  service_focus: string;
  target_location: string;
  target_customer: string;
  offer: string | null;
  cta: string;
  landing_page_url: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string;
};

export type CampaignDraftSet = {
  facebook_post: string;
  facebook_group_post?: string;
  google_business_post: string;
  instagram_caption: string;
  craigslist_post: string;
  nextdoor_post: string;
  confidence: number;
  needs_human_review: boolean;
};

export type CampaignContentQueueItem = {
  content_id: string;
  campaign_id: string;
  platform:
    | 'Facebook'
    | 'Facebook Page'
    | 'Google Business'
    | 'Instagram'
    | 'Meta Dual'
    | 'Facebook Groups'
    | 'Craigslist'
    | 'Nextdoor';
  draft_text: string;
  cta: string;
  landing_page_url: string;
  image_filename: string | null;
  image_path: string | null;
  image_url: string | null;
  business: string | null;
  post_type: string | null;
  status: string;
  approved: string;
  published: string;
  created_at: string;
  published_at: string | null;
  scheduled_at: string | null;
  publish_attempts: number;
  last_publish_error: string | null;
  external_post_id: string | null;
  published_url: string | null;
  notes: string;
};

export type CampaignContentQueueSaveResponse = {
  campaign_draft_set: CampaignDraftSet;
  queue_items: CampaignContentQueueItem[];
};

export type CampaignContentQueueConflictResponse = {
  detail: string;
  existing_queue_items: CampaignContentQueueItem[];
};

export type CampaignContentPublishResponse = {
  queue_item: CampaignContentQueueItem;
  publish_result: {
    external_post_id: string | null;
    published_url: string | null;
    status: string;
    published: string;
    last_publish_error: string | null;
    notes: string | null;
  };
};

export type CampaignContentRunDueResponse = {
  published_items: CampaignContentQueueItem[];
  failed_items: CampaignContentQueueItem[];
};

export type BusinessProfile = {
  business_name: string;
  industry: string;
  service_area_cities: string[];
  services_offered: string[];
  website_url: string;
  phone_number: string;
  email: string;
  brand_tone: string;
  target_customer: string;
  primary_cta: string;
  platforms_used: Array<'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups'>;
  visibility_channels?: Array<
    'Google Business Profile' | 'Facebook Groups' | 'Craigslist' | 'Neighborhood Groups' | 'General Social Post'
  >;
};

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  industry: string | null;
  location: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessPayload = {
  name: string;
  industry?: string | null;
  location?: string | null;
  website_url?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type BusinessContext = {
  business_id: string;
  services: string[];
  target_customers: string | null;
  brand_voice: string | null;
  differentiators: string[];
  service_area: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessContextPayload = {
  services: string[];
  target_customers?: string | null;
  brand_voice?: string | null;
  differentiators?: string[];
  service_area?: string | null;
  notes?: string | null;
};

export type BusinessPhotoAsset = {
  id: string;
  business_id: string;
  storage_path: string;
  public_url: string | null;
  caption: string | null;
  tags: string[];
  job_type: string | null;
  created_at: string;
  updated_at: string;
};

export type GeneratedPostToolType = 'reach' | 'review' | 'intro' | 'craigslist' | string;

export type GeneratedPost = {
  id: string;
  business_id: string;
  tool_type: GeneratedPostToolType;
  platform: string | null;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

export type GeneratedPostPayload = {
  tool_type: GeneratedPostToolType;
  platform?: string | null;
  title?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  status?: string;
};

export type VisibilityGenerationMode = 'llm' | 'fallback';

export type VisibilityPhotoAssetMetadata = {
  id?: string | null;
  title?: string;
  description?: string;
  category?: string;
  service_type?: string;
  location?: string;
  tags?: string[];
  quality?: string;
  image_filename?: string | null;
  image_path?: string | null;
  image_url?: string | null;
};

export type VisibilityGenerationRequest = {
  toolType: 'local_reach_post' | 'review_request' | 'business_intro_post' | 'craigslist_service_ad';
  destination?: string | null;
  postType?: string | null;
  activeBusiness?: Business | null;
  businessContext?: BusinessContext | null;
  businessProfile?: BusinessProfile | null;
  serviceFocus?: string;
  location?: string;
  goal?: string;
  tone?: string;
  cta?: string;
  notes?: string;
  customerName?: string;
  jobCompleted?: string;
  reviewLink?: string;
  servicesToMention?: string;
  businessBackground?: string;
  offerDetails?: string;
  customerPainPoint?: string;
  trustSignals?: string;
  contact?: string;
  photoAsset?: VisibilityPhotoAssetMetadata | null;
  photoAssets?: VisibilityPhotoAssetMetadata[];
  outputFormat?: string;
};

export type VisibilityGenerationResponse = {
  primary?: string;
  shortVersion?: string;
  ctaLine?: string;
  titles?: string[];
  hashtagsOrKeywords?: string[];
  imageSuggestions?: string[];
  generationMode?: VisibilityGenerationMode;
};

export type PhotoAssetQuality = 'standard' | 'strong' | 'hero';

export type PhotoAssetCategory =
  | 'Before'
  | 'After'
  | 'Before/After Pair'
  | 'Interior'
  | 'Exterior'
  | 'Cabinets'
  | 'Trim'
  | 'Drywall Repair'
  | 'Team / Work In Progress'
  | 'Finished Project';

export type PhotoAsset = {
  id: string;
  business_id: string;
  image_url: string | null;
  image_path: string | null;
  image_filename: string | null;
  title: string;
  description: string;
  category: PhotoAssetCategory;
  service_type: string;
  location: string;
  tags: string[];
  quality: PhotoAssetQuality;
  used_count: number;
  created_at: string;
  updated_at: string;
};

export type PhotoAssetPayload = {
  business_id?: string | null;
  image_data?: string | null;
  image_url?: string | null;
  image_filename?: string | null;
  title: string;
  description: string;
  category: PhotoAssetCategory;
  service_type: string;
  location: string;
  tags: string[];
  quality: PhotoAssetQuality;
};

export type WeeklySocialQueueGenerateRequest = {
  campaign_id?: string | null;
  platforms?: CampaignContentQueueItem['platform'][] | null;
  posts_per_platform?: number;
  content_days?: number;
  week_start_date?: string | null;
  content_types?: string[] | null;
  campaign_theme?: string | null;
  separate_meta_platforms?: boolean;
  include_facebook_groups?: boolean;
  business_profile?: BusinessProfile | null;
};

export type ManualSocialPostGenerateRequest = {
  campaign_id?: string | null;
  platform?: CampaignContentQueueItem['platform'] | null;
  post_type?: string;
  business_profile?: BusinessProfile | null;
};

export type SocialQueueGenerateResponse = {
  queue_items: CampaignContentQueueItem[];
  existing: boolean;
};
