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

export type WeeklySocialQueueGenerateRequest = {
  campaign_id?: string | null;
  platforms?: CampaignContentQueueItem['platform'][] | null;
  posts_per_platform?: number;
  include_facebook_groups?: boolean;
};

export type ManualSocialPostGenerateRequest = {
  campaign_id?: string | null;
  platform?: CampaignContentQueueItem['platform'] | null;
  post_type?: string;
};

export type SocialQueueGenerateResponse = {
  queue_items: CampaignContentQueueItem[];
  existing: boolean;
};
