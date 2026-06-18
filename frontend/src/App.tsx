import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import {
  ApiError,
  approveCampaignContent,
  approveContent,
  assignBusinessPublishTarget,
  createBusiness,
  createBusinessPhotoAsset,
  createFakeGoogleConnection,
  createFakeMetaConnection,
  createGeneratedPost,
  deleteBusinessPhotoAsset,
  deletePost,
  disconnectSocialConnection,
  generateAndSave,
  generateAndSaveCampaign,
  generateManualSocialPost,
  generateVisibilityContent,
  generateWeeklySocialPosts,
  getBusinessContext,
  listBusinessPhotoAssets,
  listBusinesses,
  listBusinessPublishTargets,
  listGeneratedPosts,
  listSocialConnections,
  listSocialTargets,
  getCampaignContentQueue,
  getCampaigns,
  getContentQueue,
  getJobs,
  getMediaUrl,
  getWeeklySocialQueue,
  markCampaignCopied,
  markCampaignPublished,
  markCampaignPosted,
  markCampaignSkipped,
  markPublished,
  previewCampaignDrafts,
  previewDraft,
  publishCampaignContent,
  rejectCampaignContent,
  rejectContent,
  restorePostToQueue,
  runDuePublishing,
  scheduleCampaignContent,
  unassignBusinessPublishTarget,
  upsertBusinessContext,
  updateBusiness,
  updatePostImage,
  updatePostDraftText,
  updatePostScheduledAt,
} from './api';
import type {
  BusinessProfile,
  Business,
  BusinessPayload,
  BusinessPublishTarget,
  BusinessContext,
  BusinessContextPayload,
  BusinessPhotoAsset,
  Campaign,
  CampaignContentQueueItem,
  CampaignDraftSet,
  CompletedJob,
  ContentDraft,
  ContentQueueItem,
  PhotoAsset,
  PhotoAssetCategory,
  PhotoAssetPayload,
  PhotoAssetQuality,
  GeneratedPost,
  GeneratedPostPayload,
  EmojiPreference,
  PublishTargetPlatform,
  SocialConnection,
  SocialTarget,
  VisibilityGenerationResponse,
  VisibilityPhotoAssetMetadata,
} from './types';

type BusyAction = string | null;
type PostAssistantCopiedAction = 'caption' | null;
type CalendarPlatform = 'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups' | 'Craigslist' | 'Nextdoor';
type WeeklySchedulePlatform = 'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups';
type AppSection = 'calendar' | 'visibility-tools' | 'business-profile' | 'photo-library' | 'jobs-queues' | 'settings';
type AppTheme = 'light' | 'dark';
type ToastType = 'success' | 'error' | 'warning' | 'info';
type VisibilityToolId =
  | 'local-reach-post'
  | 'recent-work-post'
  | 'review-request'
  | 'business-intro-post';
type LocalReachDestination =
  | 'Google Business Profile'
  | 'Facebook Group'
  | 'Craigslist'
  | 'General Copy/Paste'
  | 'Neighborhood Group'
  | 'General Social Post';
type LocalReachPostType =
  | 'Service promotion'
  | 'Seasonal reminder'
  | 'Recent project'
  | 'Limited availability'
  | 'New service area'
  | 'Before/after post'
  | 'Educational tip';
type LocalReachGoal =
  | 'Get estimate requests'
  | 'Build trust'
  | 'Show recent work'
  | 'Announce availability'
  | 'Improve local search visibility';
type LocalReachTone = 'Professional' | 'Friendly neighbor' | 'Simple/direct' | 'Premium' | 'Casual';
type VisibilityChannel =
  | 'Google Business Profile'
  | 'Facebook Groups'
  | 'Craigslist'
  | 'Neighborhood Groups'
  | 'General Social Post';
type SavedGeneratedPostFilter = 'all' | 'reach' | 'recent-work' | 'review' | 'intro';
type VisibilityRefinement = 'shorter' | 'friendlier' | 'professional' | 'stronger-cta';

const publishTargetPlatforms: PublishTargetPlatform[] = ['Facebook', 'Instagram', 'Google Business'];

type PublishTargetStateKind = 'assigned' | 'missing' | 'manual' | 'loading' | 'unavailable';

type PublishTargetState = {
  kind: PublishTargetStateKind;
  label: string;
  detail: string;
  targetName: string | null;
};

type AppToast = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  durationMs: number;
  exiting?: boolean;
};

type BusinessCreateDraft = {
  name: string;
  industry: string;
  location: string;
};

type ActiveBusinessProfileDraft = {
  name: string;
  industry: string;
  location: string;
  website_url: string;
  phone: string;
  email: string;
};

type BusinessContextDraft = {
  servicesText: string;
  target_customers: string;
  brand_voice: string;
  differentiatorsText: string;
  service_area: string;
  notes: string;
};

type PhotoAssetDraft = {
  image_url: string | null;
  image_path: string | null;
  image_data: string | null;
  image_filename: string | null;
  title: string;
  description: string;
  category: PhotoAssetCategory;
  service_type: string;
  location: string;
  tagsText: string;
  quality: PhotoAssetQuality;
};

type BulkPhotoImportStatus = {
  failed: number;
  failures: string[];
  imported: number;
  skipped: number;
  total: number;
};

type StoredPhotoAssetPayload = Partial<PhotoAssetPayload> & {
  id?: string;
  business_name?: string;
  image_path?: string | null;
  created_at?: string;
  updated_at?: string;
  used_count?: number;
};

type BodyScrollLockPreviousStyles = {
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  documentOverflow: string;
  documentOverscrollBehavior: string;
};

const bodyScrollLockState: {
  locks: Set<string>;
  previousStyles: BodyScrollLockPreviousStyles | null;
  scrollY: number;
} = {
  locks: new Set<string>(),
  previousStyles: null,
  scrollY: 0,
};

let bodyScrollLockId = 0;
const interactiveElementSelector = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'label',
  'summary',
  'option',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-no-drag]',
  '[data-interactive]',
].join(',');

type WeeklyScheduleSettings = {
  weekStartDate: string;
  contentDays: number;
  platforms: WeeklySchedulePlatform[];
  contentTypes: string[];
  campaignTheme: string;
};

type ManualPostSettings = {
  scheduledDate: string;
  title: string;
  platforms: WeeklySchedulePlatform[];
  contentType: string;
  campaignId: string;
};

type VisibilityToolCard = {
  id: VisibilityToolId;
  title: string;
  description: string;
  label: string;
  icon: IconName;
};

type VisibilityToolFormData = {
  destination: LocalReachDestination;
  postType: LocalReachPostType;
  goal: LocalReachGoal;
  serviceFocus: string;
  location: string;
  cta: string;
  photoAssetId: string;
  notes: string;
  tone: LocalReachTone | string;
  customerName: string;
  jobCompleted: string;
  reviewLink: string;
  servicesToMention: string;
  businessBackground: string;
  offerDetails: string;
  customerPainPoint: string;
  trustSignals: string;
  contact: string;
  selectedPhotoAssetIds: string[];
};

type QueueGroup = {
  jobId: string;
  items: ContentQueueItem[];
  latestCreatedAt: string;
  statusCounts: Record<string, number>;
};

type CampaignQueueGroup = {
  campaignId: string;
  items: CampaignContentQueueItem[];
  latestCreatedAt: string;
  statusCounts: Record<string, number>;
};

type PlatformPost = {
  id: string;
  platform: CalendarPlatform;
  sourcePlatform: CampaignContentQueueItem['platform'];
  item: CampaignContentQueueItem;
};

type ContentSlot = {
  id: string;
  campaignId: string;
  business: string;
  weekKey: string;
  title: string;
  contentType: string;
  dayIndex: number;
  scheduledAt: string | null;
  imageSource: string | null;
  statusSummary: string;
  sourceItems: CampaignContentQueueItem[];
  platformPosts: PlatformPost[];
};

type WeeklyCampaignCalendar = {
  campaignId: string;
  business: string;
  weekKey: string;
  contentSlots: ContentSlot[];
};

type WeeklyCalendarDay = {
  key: string;
  label: string;
  shortLabel: string;
  contentSlots: ContentSlot[];
};

type CalendarDragCandidate = {
  phase: 'pending' | 'dragging';
  slotId: string;
  originDayIndex: number;
  handleElement: HTMLElement;
  longPressTimerId: number | null;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  sourceWidth: number;
  sourceHeight: number;
};

type CalendarDragState = {
  phase: 'dragging';
  slotId: string;
  originDayIndex: number;
  pointerType: string;
  currentX: number;
  currentY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  sourceWidth: number;
  sourceHeight: number;
  overDayIndex: number | null;
  overTrash: boolean;
};

type CalendarDropTarget = {
  dayIndex: number | null;
  overTrash: boolean;
  dayElement: HTMLDetailsElement | null;
};

type AppNavItem = {
  key: AppSection;
  label: string;
  description: string;
};

type PlatformStatusRow = {
  platform: CalendarPlatform;
  label: string;
  status: string;
};

type WeeklyActionSummary = {
  totalPlatformPosts: number;
  publishedCount: number;
  draftCount: number;
  needsReviewCount: number;
  failedCount: number;
  readyCount: number;
  contentSlotCount: number;
  actionByPlatform: Array<{ platform: CalendarPlatform; label: string; count: number }>;
};

const draftFields: Array<[keyof ContentDraft, string]> = [
  ['facebook_post', 'Facebook'],
  ['google_business_post', 'Google Business'],
  ['instagram_caption', 'Instagram'],
  ['review_request_text', 'Review Request'],
];

const platformOrder: Record<ContentQueueItem['platform'], number> = {
  Facebook: 1,
  'Google Business': 2,
  Instagram: 3,
  'Review Request': 4,
};

const campaignDraftFields: Array<[keyof CampaignDraftSet, string]> = [
  ['facebook_post', 'Facebook'],
  ['facebook_group_post', 'Facebook Groups'],
  ['google_business_post', 'Google Business'],
  ['instagram_caption', 'Instagram'],
  ['craigslist_post', 'Craigslist'],
  ['nextdoor_post', 'Nextdoor'],
];

const campaignPlatformOrder: Record<CampaignContentQueueItem['platform'], number> = {
  Facebook: 1,
  'Facebook Page': 1,
  Instagram: 2,
  'Meta Dual': 3,
  'Google Business': 4,
  'Facebook Groups': 5,
  Craigslist: 6,
  Nextdoor: 7,
};

const calendarDays = [
  { key: 'monday', label: 'Monday', shortLabel: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', shortLabel: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', shortLabel: 'Wed' },
  { key: 'thursday', label: 'Thursday', shortLabel: 'Thu' },
  { key: 'friday', label: 'Friday', shortLabel: 'Fri' },
  { key: 'saturday', label: 'Saturday', shortLabel: 'Sat' },
  { key: 'sunday', label: 'Sunday', shortLabel: 'Sun' },
];

const calendarPlatformOrder: Record<CalendarPlatform, number> = {
  Facebook: 1,
  Instagram: 2,
  'Google Business': 3,
  'Facebook Groups': 4,
  Craigslist: 5,
  Nextdoor: 6,
};

const coreCalendarPlatforms: CalendarPlatform[] = ['Facebook', 'Instagram', 'Google Business', 'Facebook Groups'];

const weeklySchedulePlatformOptions: WeeklySchedulePlatform[] = [
  'Facebook',
  'Instagram',
  'Google Business',
  'Facebook Groups',
];
const defaultWeeklySchedulePlatforms: WeeklySchedulePlatform[] = ['Facebook', 'Instagram', 'Google Business'];

const weeklyScheduleContentTypeOptions = [
  'Seasonal Reminder',
  'Problem/Solution',
  'Trust Local Proof',
  'Before/After',
  'Service Education',
  'Free Estimate CTA',
];

const defaultWeeklyCampaignTheme = 'Weekly Local Business Content';
const businessProfileStorageKey = 'gomez-ops-business-profile-v1';
const activeBusinessIdStorageKey = 'gomez-ops-active-business-id-v1';
const photoLibraryStorageKey = 'gomez-ops-photo-library-v1';
const themeStorageKey = 'gomez-ops-theme';
const emojiPreferenceStorageKey = 'gomez-ops-emoji-preference-v1';
const maxPhotoAssetDataUrlLength = 2_800_000;
const toastExitAnimationMs = 260;
const defaultToastDurationMs = 5200;
const businessProfilePlatforms: BusinessProfile['platforms_used'] = [
  'Facebook',
  'Instagram',
  'Google Business',
  'Facebook Groups',
];
const defaultBusinessProfilePlatforms: BusinessProfile['platforms_used'] = ['Facebook', 'Instagram', 'Google Business'];
const visibilityChannelOptions: VisibilityChannel[] = [
  'Google Business Profile',
  'Facebook Groups',
  'Craigslist',
  'Neighborhood Groups',
  'General Social Post',
];
const defaultVisibilityChannels: VisibilityChannel[] = [
  'Google Business Profile',
  'Facebook Groups',
  'Neighborhood Groups',
  'General Social Post',
];

const photoAssetCategories: PhotoAssetCategory[] = [
  'Before',
  'After',
  'Before/After Pair',
  'Interior',
  'Exterior',
  'Cabinets',
  'Trim',
  'Drywall Repair',
  'Team / Work In Progress',
  'Finished Project',
];

const photoAssetQualityOptions: Array<{ value: PhotoAssetQuality; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'strong', label: 'Strong' },
  { value: 'hero', label: 'Hero' },
];
const photoAssetQualityScore: Record<PhotoAssetQuality, number> = {
  standard: 0,
  strong: 1,
  hero: 2,
};

const defaultBusinessProfile: BusinessProfile = {
  business_name: 'Marom Painting',
  industry: 'Residential painting',
  service_area_cities: ['Oak Park', 'River Forest', 'Forest Park'],
  services_offered: ['Interior painting', 'Exterior painting', 'Cabinet painting', 'Drywall repair'],
  website_url: 'https://marompainting.org',
  phone_number: '',
  email: '',
  brand_tone: 'Professional, helpful, local, and trustworthy',
  target_customer: 'Homeowners and property managers who want clean, reliable painting work',
  primary_cta: 'Request a free estimate',
  platforms_used: [...defaultBusinessProfilePlatforms],
  visibility_channels: [...defaultVisibilityChannels],
};

const defaultBusinessCreateDraft: BusinessCreateDraft = {
  name: '',
  industry: '',
  location: '',
};

const emptyActiveBusinessProfileDraft: ActiveBusinessProfileDraft = {
  name: '',
  industry: '',
  location: '',
  website_url: '',
  phone: '',
  email: '',
};

const emptyBusinessContextDraft: BusinessContextDraft = {
  servicesText: '',
  target_customers: '',
  brand_voice: '',
  differentiatorsText: '',
  service_area: '',
  notes: '',
};

const appNavItems: AppNavItem[] = [
  { key: 'calendar', label: 'Calendar', description: '' },
  { key: 'visibility-tools', label: 'Get Customers', description: '' },
  { key: 'business-profile', label: 'Business Profile', description: '' },
  { key: 'photo-library', label: 'Photo Library', description: '' },
  { key: 'jobs-queues', label: 'Jobs + Queues', description: '' },
];
const settingsNavItem: AppNavItem = { key: 'settings', label: 'Settings', description: '' };

const visibilityToolCards: VisibilityToolCard[] = [
  {
    id: 'local-reach-post',
    title: 'Get More Leads',
    description: 'Create a local post designed to get estimate requests, calls, or messages.',
    label: '',
    icon: 'megaphone',
  },
  {
    id: 'recent-work-post',
    title: 'Show Recent Work',
    description: 'Turn a project photo into a polished post that builds trust.',
    label: '',
    icon: 'image',
  },
  {
    id: 'review-request',
    title: 'Ask for a Review',
    description: 'Generate a short message asking a customer to leave a Google review.',
    label: '',
    icon: 'star',
  },
  {
    id: 'business-intro-post',
    title: 'Introduce My Business',
    description: 'Create a friendly local intro post for a business, service area, or new offer.',
    label: '',
    icon: 'store',
  },
];

const localReachDestinationOptions: LocalReachDestination[] = [
  'Facebook Group',
  'Google Business Profile',
  'Craigslist',
  'General Copy/Paste',
];

const localReachPostTypeOptions: LocalReachPostType[] = [
  'Service promotion',
  'Seasonal reminder',
  'Recent project',
  'Limited availability',
  'New service area',
  'Before/after post',
  'Educational tip',
];

const localReachGoalOptions: LocalReachGoal[] = [
  'Get estimate requests',
  'Build trust',
  'Show recent work',
  'Announce availability',
  'Improve local search visibility',
];

const localReachToneOptions: LocalReachTone[] = [
  'Professional',
  'Friendly neighbor',
  'Simple/direct',
  'Premium',
  'Casual',
];

type IconName =
  | 'check'
  | 'copy'
  | 'download'
  | 'edit'
  | 'image'
  | 'menu'
  | 'megaphone'
  | 'restore'
  | 'save'
  | 'settings'
  | 'skip'
  | 'star'
  | 'store'
  | 'trash'
  | 'x';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, JSX.Element> = {
    check: <path d="M20 6 9 17l-5-5" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8" cy="10" r="1.5" />
        <path d="m21 15-5-5L5 19" />
      </>
    ),
    megaphone: (
      <>
        <path d="m3 11 18-5v12L3 14v-3Z" />
        <path d="M7 14v4a2 2 0 0 0 2 2h1" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </>
    ),
    restore: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v6h6" />
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7.1 4l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
      </>
    ),
    skip: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </>
    ),
    star: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3Z" />
    ),
    store: (
      <>
        <path d="M4 10h16l-1.5-6h-13L4 10Z" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6 18 20H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="button-icon" fill="none" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function queueGroupDomId(jobId: string) {
  return `queue-group-${jobId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function campaignQueueGroupDomId(campaignId: string) {
  return `campaign-queue-group-${campaignId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function formatDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDefaultWeekStartDateInput() {
  const date = new Date();
  const day = date.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offsetToMonday);
  return formatDateInputValue(date);
}

function defaultWeeklyScheduleSettings(): WeeklyScheduleSettings {
  return {
    weekStartDate: getDefaultWeekStartDateInput(),
    contentDays: 5,
    platforms: [...defaultWeeklySchedulePlatforms],
    contentTypes: [...weeklyScheduleContentTypeOptions],
    campaignTheme: defaultWeeklyCampaignTheme,
  };
}

function defaultManualPostSettings(): ManualPostSettings {
  return {
    scheduledDate: formatDateInputValue(new Date()),
    title: '',
    platforms: [...defaultWeeklySchedulePlatforms],
    contentType: weeklyScheduleContentTypeOptions[0] ?? 'General',
    campaignId: '',
  };
}

function firstProfileValue(values: string[], fallback: string) {
  return values.find((value) => value.trim())?.trim() || fallback;
}

function createDefaultVisibilityToolFormData(
  toolId: VisibilityToolId,
  profile: BusinessProfile,
): VisibilityToolFormData {
  const defaultService = firstProfileValue(profile.services_offered, 'Interior painting');
  const defaultLocation = firstProfileValue(profile.service_area_cities, 'Oak Park');
  const defaultCta = profile.primary_cta.trim() || 'Request a free estimate';
  const defaultDestination = destinationFromVisibilityChannel(visibilityChannelsFromProfile(profile)[0] ?? 'Google Business Profile');

  return {
    destination: defaultDestination,
    postType: toolId === 'recent-work-post' ? 'Recent project' : 'Service promotion',
    goal: toolId === 'recent-work-post' ? 'Show recent work' : 'Get estimate requests',
    serviceFocus: defaultService,
    location: defaultLocation,
    cta: defaultCta,
    photoAssetId: '',
    notes: '',
    tone: toolId === 'review-request' ? 'Friendly' : 'Friendly neighbor',
    customerName: '',
    jobCompleted: defaultService,
    reviewLink: profile.website_url.trim(),
    servicesToMention: profile.services_offered.slice(0, 3).join(', ') || defaultService,
    businessBackground:
      profile.brand_tone.trim() || 'Local, reliable, and focused on clean, professional work.',
    offerDetails: '',
    customerPainPoint: '',
    trustSignals: 'Clean prep, clear estimates, local references, and tidy work areas',
    contact: profile.phone_number.trim() || profile.website_url.trim(),
    selectedPhotoAssetIds: [],
  };
}

function getVisibilityToolById(toolId: VisibilityToolId | null) {
  if (!toolId) return null;
  return visibilityToolCards.find((tool) => tool.id === toolId) ?? null;
}

function getVisibilityToolMobileLabel(toolId: VisibilityToolId) {
  if (toolId === 'local-reach-post') return 'Leads';
  if (toolId === 'recent-work-post') return 'Recent Work';
  if (toolId === 'review-request') return 'Reviews';
  if (toolId === 'business-intro-post') return 'Intro';
  return 'Start';
}

function visibilityToolSupportsPhoto(toolId: VisibilityToolId) {
  return toolId === 'local-reach-post' || toolId === 'recent-work-post';
}

function destinationFromVisibilityChannel(channel: VisibilityChannel): LocalReachDestination {
  if (channel === 'Facebook Groups') return 'Facebook Group';
  if (channel === 'Neighborhood Groups') return 'Neighborhood Group';
  if (channel === 'General Social Post') return 'General Copy/Paste';
  return channel;
}

function visibilityChannelFromDestination(destination: LocalReachDestination): VisibilityChannel {
  if (destination === 'Facebook Group') return 'Facebook Groups';
  if (destination === 'Neighborhood Group') return 'Neighborhood Groups';
  if (destination === 'General Copy/Paste') return 'General Social Post';
  return destination;
}

function visibilityChannelsFromProfile(profile: BusinessProfile): VisibilityChannel[] {
  const channels = (profile.visibility_channels ?? defaultVisibilityChannels).filter((channel): channel is VisibilityChannel =>
    visibilityChannelOptions.includes(channel as VisibilityChannel),
  );
  return channels.length > 0 ? channels : [...defaultVisibilityChannels];
}

function cleanSentencePart(value: string) {
  return value.trim().replace(/[.!?]+$/g, '');
}

function formatVisibilityPhotoContext(asset: PhotoAsset | null) {
  if (!asset) return '';
  const details = [asset.service_type, asset.location, asset.category].filter(Boolean).join(', ');
  return details
    ? `Selected photo: ${asset.title} (${details})`
    : `Selected photo: ${asset.title}`;
}

function getVisibilityBusinessName(profile: BusinessProfile, activeBusiness: Business | null) {
  return activeBusiness?.name?.trim() || profile.business_name.trim() || defaultBusinessProfile.business_name;
}

function getVisibilityIndustry(profile: BusinessProfile, activeBusiness: Business | null) {
  return activeBusiness?.industry?.trim() || profile.industry.trim() || defaultBusinessProfile.industry;
}

function getVisibilityWebsite(profile: BusinessProfile, activeBusiness: Business | null) {
  return activeBusiness?.website_url?.trim() || profile.website_url.trim();
}

function getVisibilityService(
  formData: VisibilityToolFormData,
  profile: BusinessProfile,
  context: BusinessContext | null,
) {
  return cleanSentencePart(
    formData.serviceFocus ||
      firstProfileValue(context?.services ?? [], '') ||
      firstProfileValue(profile.services_offered, 'painting services'),
  );
}

function getVisibilityLocation(
  formData: VisibilityToolFormData,
  profile: BusinessProfile,
  activeBusiness: Business | null,
  context: BusinessContext | null,
) {
  return cleanSentencePart(
    formData.location ||
      context?.service_area ||
      activeBusiness?.location ||
      firstProfileValue(profile.service_area_cities, 'the local area'),
  );
}

function formatBusinessContextTrust(profile: BusinessProfile, context: BusinessContext | null) {
  const targetCustomers = context?.target_customers?.trim() || profile.target_customer.trim();
  const differentiators = context?.differentiators?.map((item) => item.trim()).filter(Boolean) ?? [];
  const brandVoice = context?.brand_voice?.trim() || profile.brand_tone.trim();
  const notes = context?.notes?.trim();

  if (differentiators.length > 0 && targetCustomers) {
    return `We work with ${targetCustomers.toLowerCase()} and focus on ${differentiators.slice(0, 2).join(' and ').toLowerCase()}.`;
  }
  if (differentiators.length > 0) {
    return `We focus on ${differentiators.slice(0, 2).join(' and ').toLowerCase()}.`;
  }
  if (targetCustomers) {
    return `We work with ${targetCustomers.toLowerCase()} who want dependable, neat work.`;
  }
  if (brandVoice) {
    return `The tone is ${brandVoice.toLowerCase()}, with clear communication throughout.`;
  }
  if (notes) {
    return cleanSentencePart(notes);
  }
  return 'We focus on dependable, neat work and clear communication.';
}

function formatVisibilityCta(profile: BusinessProfile, cta: string, activeBusiness: Business | null = null) {
  const cleanCta = cleanSentencePart(cta || profile.primary_cta || 'Request a free estimate');
  const website = getVisibilityWebsite(profile, activeBusiness);
  return website ? `${cleanCta}: ${website}` : cleanCta;
}

function lowerFirst(value: string) {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function localReachHook(
  destination: LocalReachDestination,
  postType: LocalReachPostType,
  tone: string,
  service: string,
  location: string,
) {
  if (destination === 'Facebook Group' || destination === 'Neighborhood Group') {
    if (postType === 'Recent project') return `Hey neighbors - we recently wrapped up a ${lowerFirst(service)} project near ${location}.`;
    if (postType === 'Before/after post') return `Hey neighbors - sharing a quick before/after from a recent ${lowerFirst(service)} job around ${location}.`;
    if (postType === 'Educational tip') return `Hey neighbors - quick tip for anyone in ${location} thinking about ${lowerFirst(service)}.`;
    if (postType === 'Limited availability') return `Hey neighbors - we have a few openings coming up for ${lowerFirst(service)} around ${location}.`;
    if (postType === 'New service area') return `Hey neighbors - we are now helping more homeowners around ${location} with ${lowerFirst(service)}.`;
    if (postType === 'Seasonal reminder') return `Hey neighbors - this is a good time to think about ${lowerFirst(service)} before the season gets busy.`;
    return `Hey neighbors - if ${lowerFirst(service)} is on your list, we are helping homeowners around ${location}.`;
  }

  if (destination === 'Craigslist') {
    if (postType === 'Limited availability') return `Now booking ${lowerFirst(service)} in ${location}.`;
    if (postType === 'Recent project') return `Recent ${lowerFirst(service)} work completed in ${location}.`;
    return `${service} available in ${location}.`;
  }

  if (destination === 'Google Business Profile') {
    if (postType === 'Educational tip') return `Planning ${lowerFirst(service)} in ${location}?`;
    if (postType === 'Recent project') return `Recent ${lowerFirst(service)} work completed in ${location}.`;
    if (postType === 'New service area') return `Now serving more homeowners in ${location}.`;
    return `${service} for homeowners in ${location}.`;
  }

  if (tone === 'Premium') return `A clean, polished ${lowerFirst(service)} project can change how a home feels in ${location}.`;
  if (tone === 'Simple/direct') return `${service} in ${location}, handled cleanly and reliably.`;
  return `Thinking about ${lowerFirst(service)} in ${location}?`;
}

function localReachBody(
  destination: LocalReachDestination,
  postType: LocalReachPostType,
  goal: LocalReachGoal,
  tone: string,
  businessName: string,
  service: string,
  location: string,
  profile: BusinessProfile,
  context: BusinessContext | null,
  notes: string,
  photoContext: string,
) {
  const profileTrust = formatBusinessContextTrust(profile, context);
  const noteLine = notes ? ` ${cleanSentencePart(notes)}.` : '';
  const photoLine = photoContext ? ` ${photoContext}.` : '';

  if (destination === 'Google Business Profile') {
    const searchIntent =
      goal === 'Improve local search visibility'
        ? `${businessName} helps local homeowners with ${lowerFirst(service)} in ${location} and nearby communities.`
        : `${businessName} offers ${lowerFirst(service)} for homeowners in ${location} and the surrounding area.`;
    return `${searchIntent} ${profileTrust}${photoLine}${noteLine}`;
  }

  if (destination === 'Facebook Group' || destination === 'Neighborhood Group') {
    if (postType === 'Educational tip') {
      return `Small prep details can make a big difference, from surface repair to the right finish. ${businessName} is happy to answer questions or take a look if anyone nearby is planning a project.${photoLine}${noteLine}`;
    }
    if (goal === 'Build trust') {
      return `We try to keep the process straightforward: clear estimate, tidy work area, and a finish that fits the home. Happy to help if anyone nearby is comparing options.${photoLine}${noteLine}`;
    }
    if (goal === 'Show recent work') {
      return `The goal was a cleaner, fresher look without making the process stressful for the homeowner. We are always glad to share project examples or take a look at a similar space.${photoLine}${noteLine}`;
    }
    return `No hard sell - just local help for anyone who wants a room, exterior, cabinets, trim, or drywall looking better. ${businessName} can take a look and point you in the right direction.${photoLine}${noteLine}`;
  }

  if (destination === 'Craigslist') {
    const directOffer =
      postType === 'Limited availability'
        ? 'Limited upcoming openings are available for estimates and project scheduling.'
        : 'Interior, exterior, cabinet, trim, and drywall-related painting work available.';
    return `${businessName} provides reliable ${lowerFirst(service)} in ${location}. ${directOffer} Clear estimates, clean work, and service for local homeowners.${photoLine}${noteLine}`;
  }

  const toneLine =
    tone === 'Premium'
      ? 'The focus is a refined finish, careful prep, and a smoother experience from estimate to final walkthrough.'
      : tone === 'Casual'
        ? 'We keep things practical, clean, and easy to understand from the first look to the final touch-up.'
        : 'We focus on clean prep, reliable scheduling, and a result that feels right for the home.';
  return `${businessName} helps homeowners around ${location} with ${lowerFirst(service)}. ${toneLine}${photoLine}${noteLine}`;
}

function localReachShortVersion(
  destination: LocalReachDestination,
  businessName: string,
  service: string,
  location: string,
  ctaLine: string,
) {
  if (destination === 'Facebook Group' || destination === 'Neighborhood Group') {
    return `Hey neighbors - ${businessName} helps with ${lowerFirst(service)} around ${location}. Happy to take a look and give a free estimate.`;
  }
  if (destination === 'Craigslist') {
    return `${service} in ${location}. Clean work, clear estimates, local service. ${ctaLine}`;
  }
  if (destination === 'Google Business Profile') {
    return `${businessName} offers ${lowerFirst(service)} in ${location}. ${ctaLine}`;
  }
  return `${businessName} can help with ${lowerFirst(service)} in ${location}. ${ctaLine}`;
}

function localReachKeywords(
  destination: LocalReachDestination,
  service: string,
  location: string,
  businessName: string,
) {
  const baseKeywords = [
    `${service} ${location}`,
    businessName,
    `${location} painting contractor`,
  ];
  if (destination === 'Facebook Group' || destination === 'Neighborhood Group' || destination === 'General Social Post') {
    return `${baseKeywords.join(', ')}\n#${service.replace(/\s+/g, '')} #${location.replace(/\s+/g, '')} #LocalBusiness`;
  }
  if (destination === 'Craigslist') {
    return baseKeywords.concat(['free estimate', 'residential painting']).join(', ');
  }
  return baseKeywords.join(', ');
}

function visibilityEmojiCandidates(
  profile: BusinessProfile,
  activeBusiness: Business | null,
  context: BusinessContext | null,
) {
  const searchText = [
    activeBusiness?.name,
    activeBusiness?.industry,
    activeBusiness?.location,
    profile.business_name,
    profile.industry,
    ...profile.services_offered,
    context?.service_area,
    ...(context?.services ?? []),
    context?.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(garden|plant|plants|landscap|lawn|tree|flower|nursery)\b/.test(searchText)) {
    return ['🌿', '🪴', '🌱', '☀️', '✅', '📍'];
  }
  if (/\b(food|restaurant|cafe|coffee|catering|grill|kitchen|bakery|meal)\b/.test(searchText)) {
    return ['🍽️', '🔥', '😋', '✅', '📍'];
  }
  if (/\b(fitness|gym|workout|training|trainer|strength|yoga|pilates)\b/.test(searchText)) {
    return ['💪', '⚡', '🏋️', '✅', '📍'];
  }
  if (/\b(paint|painting|painter|drywall|cabinet|trim|stain|color)\b/.test(searchText)) {
    return ['🎨', '🏠', '🖌️', '✨', '✅', '📍'];
  }
  return ['✅', '📍', '💼', '✨'];
}

function visibilityEmojiPrefix(
  preference: EmojiPreference,
  profile: BusinessProfile,
  activeBusiness: Business | null,
  context: BusinessContext | null,
) {
  const emojiCount = preference === 'less' ? 1 : preference === 'more' ? 4 : 2;
  return `${visibilityEmojiCandidates(profile, activeBusiness, context).slice(0, emojiCount).join(' ')} `;
}

function buildLocalReachPostOutput(
  formData: VisibilityToolFormData,
  profile: BusinessProfile,
  activeBusiness: Business | null,
  context: BusinessContext | null,
  photoAsset: PhotoAsset | null,
  emojiPreference: EmojiPreference,
) {
  const businessName = getVisibilityBusinessName(profile, activeBusiness);
  const service = getVisibilityService(formData, profile, context);
  const location = getVisibilityLocation(formData, profile, activeBusiness, context);
  const ctaLine = formatVisibilityCta(profile, formData.cta, activeBusiness);
  const destination = formData.destination;
  const postType = formData.postType;
  const goal = formData.goal;
  const tone = formData.tone || 'Friendly neighbor';
  const photoContext = formatVisibilityPhotoContext(photoAsset);
  const emojiPrefix = visibilityEmojiPrefix(emojiPreference, profile, activeBusiness, context);
  const hook = localReachHook(destination, postType, tone, service, location);
  const body = localReachBody(destination, postType, goal, tone, businessName, service, location, profile, context, formData.notes, photoContext);
  const primaryPost =
    destination === 'Craigslist'
      ? `${emojiPrefix}${hook}\n\n${body}\n\n${ctaLine}`
      : `${emojiPrefix}${hook} ${body}\n\n${ctaLine}`;
  const shortVersion = `${emojiPrefix}${localReachShortVersion(destination, businessName, service, location, ctaLine)}`;
  const keywords = localReachKeywords(destination, service, location, businessName);

  return [
    'Primary post:',
    primaryPost,
    '',
    'Short version:',
    shortVersion,
    '',
    'CTA line:',
    ctaLine,
    '',
    'Suggested local keywords or hashtags:',
    keywords,
  ].join('\n');
}

function buildVisibilityToolOutput(
  toolId: VisibilityToolId,
  formData: VisibilityToolFormData,
  profile: BusinessProfile,
  activeBusiness: Business | null,
  context: BusinessContext | null,
  photoAsset: PhotoAsset | null,
  emojiPreference: EmojiPreference,
) {
  const businessName = getVisibilityBusinessName(profile, activeBusiness);
  const service = getVisibilityService(formData, profile, context);
  const location = getVisibilityLocation(formData, profile, activeBusiness, context);
  const ctaLine = formatVisibilityCta(profile, formData.cta, activeBusiness);
  const tone = formData.tone.toLowerCase();
  const emojiPrefix = visibilityEmojiPrefix(emojiPreference, profile, activeBusiness, context);

  if (toolId === 'local-reach-post' || toolId === 'recent-work-post') {
    return buildLocalReachPostOutput(formData, profile, activeBusiness, context, photoAsset, emojiPreference);
  }

  if (toolId === 'review-request') {
    const customerName = cleanSentencePart(formData.customerName || 'there');
    const jobCompleted = cleanSentencePart(formData.jobCompleted || service);
    const reviewLink = formData.reviewLink.trim();
    if (tone.includes('short')) {
      return `${emojiPrefix}Hi ${customerName}, thank you for choosing ${businessName} for ${jobCompleted}. If you have a minute, would you leave us a Google review? ${reviewLink || ctaLine}`;
    }
    if (tone.includes('warm')) {
      return `${emojiPrefix}Hi ${customerName}, it was a pleasure helping with ${jobCompleted}. Thank you again for trusting ${businessName}. If you have a minute, a Google review would mean a lot and helps other local homeowners find us. ${reviewLink || ctaLine}`;
    }
    return `${emojiPrefix}Hi ${customerName}, thank you again for choosing ${businessName} for ${jobCompleted}. If you have a minute, would you be willing to leave us a Google review? It helps local homeowners feel confident reaching out. ${reviewLink || ctaLine}`;
  }

  if (toolId === 'business-intro-post') {
    const services = cleanSentencePart(
      formData.servicesToMention || (context?.services ?? []).slice(0, 3).join(', ') || service,
    );
    const background = cleanSentencePart(formData.businessBackground || context?.notes || context?.brand_voice || profile.brand_tone);
    const differentiatorLine = context?.differentiators?.length
      ? ` What makes us different: ${context.differentiators.slice(0, 2).join(' and ')}.`
      : '';
    return `${emojiPrefix}Hey neighbors - we are ${businessName}, a local ${getVisibilityIndustry(profile, activeBusiness).toLowerCase()} business serving ${location}. We help with ${services}. ${background}.${differentiatorLine} If you are planning a project nearby, ${ctaLine}.`;
  }

  return '';
}

function photoAssetToVisibilityMetadata(asset: PhotoAsset): VisibilityPhotoAssetMetadata {
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    category: asset.category,
    service_type: asset.service_type,
    location: asset.location,
    tags: asset.tags,
    quality: asset.quality,
    image_filename: asset.image_filename,
    image_path: asset.image_path,
    image_url: asset.image_url,
  };
}

function businessPhotoAssetToPhotoAsset(asset: BusinessPhotoAsset): PhotoAsset {
  const metadata = parseBusinessPhotoAssetMetadata(asset.tags);
  const imageSource = asset.public_url || asset.storage_path;
  const imageUrl = asset.public_url || (/^https?:\/\//i.test(asset.storage_path) ? asset.storage_path : null);
  const imagePath = imageUrl === asset.storage_path ? null : asset.storage_path;
  const imageFilename = metadata.imageFilename || imageFilenameFromSource(imageSource);

  return {
    id: asset.id,
    business_id: asset.business_id,
    image_url: imageUrl,
    image_path: imagePath,
    image_filename: imageFilename,
    title: asset.caption?.trim() || imageFilename || 'Photo asset',
    description: metadata.description,
    category: metadata.category,
    service_type: asset.job_type?.trim() || '',
    location: metadata.location,
    tags: metadata.tags,
    quality: metadata.quality,
    used_count: 0,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
  };
}

function photoAssetDraftToBusinessPhotoAssetPayload(
  draft: PhotoAssetDraft,
): Omit<BusinessPhotoAsset, 'id' | 'business_id' | 'created_at' | 'updated_at'> {
  const imageSource = getPhotoAssetImageSource(draft)?.trim() || '';
  const publicUrl = draft.image_url?.trim() && /^https?:\/\//i.test(draft.image_url.trim())
    ? draft.image_url.trim()
    : null;

  return {
    storage_path: imageSource,
    public_url: publicUrl,
    caption: draft.title.trim(),
    tags: buildBusinessPhotoAssetTags({
      tags: normalizePhotoTags(draft.tagsText),
      category: draft.category,
      quality: draft.quality,
      location: draft.location,
      description: draft.description,
      imageFilename: draft.image_filename,
    }),
    job_type: draft.service_type.trim() || null,
  };
}

function photoAssetPayloadToBusinessPhotoAssetPayload(
  payload: PhotoAssetPayload,
): Omit<BusinessPhotoAsset, 'id' | 'business_id' | 'created_at' | 'updated_at'> {
  const imageSource = payload.image_data || payload.image_url || '';
  const publicUrl = payload.image_url?.trim() && /^https?:\/\//i.test(payload.image_url.trim())
    ? payload.image_url.trim()
    : null;

  return {
    storage_path: imageSource,
    public_url: publicUrl,
    caption: payload.title.trim(),
    tags: buildBusinessPhotoAssetTags({
      tags: payload.tags,
      category: payload.category,
      quality: payload.quality,
      location: payload.location,
      description: payload.description,
      imageFilename: payload.image_filename,
    }),
    job_type: payload.service_type.trim() || null,
  };
}

function buildBusinessPhotoAssetTags({
  category,
  description,
  imageFilename,
  location,
  quality,
  tags,
}: {
  category: PhotoAssetCategory;
  description: string;
  imageFilename?: string | null;
  location: string;
  quality: PhotoAssetQuality;
  tags: string[];
}) {
  const metadataTags = [
    `gomez:category=${category}`,
    `gomez:quality=${quality}`,
    location.trim() ? `gomez:location=${location.trim()}` : '',
    description.trim() ? `gomez:description=${description.trim()}` : '',
    imageFilename?.trim() ? `gomez:filename=${imageFilename.trim()}` : '',
  ].filter(Boolean);

  return [...tags.map((tag) => tag.trim()).filter(Boolean), ...metadataTags];
}

function parseBusinessPhotoAssetMetadata(tags: string[]) {
  const visibleTags: string[] = [];
  let category: PhotoAssetCategory = 'Finished Project';
  let quality: PhotoAssetQuality = 'standard';
  let location = '';
  let description = '';
  let imageFilename: string | null = null;

  for (const tag of tags) {
    if (tag.startsWith('gomez:category=')) {
      const value = tag.replace('gomez:category=', '');
      category = isPhotoAssetCategory(value) ? value : category;
    } else if (tag.startsWith('gomez:quality=')) {
      const value = tag.replace('gomez:quality=', '');
      quality = isPhotoAssetQuality(value) ? value : quality;
    } else if (tag.startsWith('gomez:location=')) {
      location = tag.replace('gomez:location=', '').trim();
    } else if (tag.startsWith('gomez:description=')) {
      description = tag.replace('gomez:description=', '').trim();
    } else if (tag.startsWith('gomez:filename=')) {
      imageFilename = tag.replace('gomez:filename=', '').trim() || null;
    } else {
      visibleTags.push(tag);
    }
  }

  return { category, description, imageFilename, location, quality, tags: visibleTags };
}

function fallbackVisibilityResponseFromText(text: string): VisibilityGenerationResponse {
  return {
    primary: text,
    generationMode: 'fallback',
  };
}

function formatVisibilityResponseForCopy(output: VisibilityGenerationResponse | null) {
  if (!output) return '';
  const lines: string[] = [];
  if (output.primary) lines.push('Primary:', output.primary);
  if (output.shortVersion) lines.push('', 'Short version:', output.shortVersion);
  if (output.ctaLine) lines.push('', 'CTA:', output.ctaLine);
  if (output.titles?.length) lines.push('', 'Titles:', ...output.titles.map((title) => `- ${title}`));
  if (output.hashtagsOrKeywords?.length) {
    lines.push('', 'Keywords / hashtags:', ...output.hashtagsOrKeywords.map((keyword) => `- ${keyword}`));
  }
  if (output.imageSuggestions?.length) {
    lines.push('', 'Image suggestions:', ...output.imageSuggestions.map((suggestion) => `- ${suggestion}`));
  }
  return lines.join('\n');
}

function parseBusinessContextList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function businessContextToDraft(context: BusinessContext | null): BusinessContextDraft {
  if (!context) return { ...emptyBusinessContextDraft };
  return {
    servicesText: context.services.join('\n'),
    target_customers: context.target_customers ?? '',
    brand_voice: context.brand_voice ?? '',
    differentiatorsText: context.differentiators.join('\n'),
    service_area: context.service_area ?? '',
    notes: context.notes ?? '',
  };
}

function businessContextDraftToPayload(draft: BusinessContextDraft): BusinessContextPayload {
  return {
    services: parseBusinessContextList(draft.servicesText),
    target_customers: draft.target_customers.trim() || null,
    brand_voice: draft.brand_voice.trim() || null,
    differentiators: parseBusinessContextList(draft.differentiatorsText),
    service_area: draft.service_area.trim() || null,
    notes: draft.notes.trim() || null,
  };
}

function activeBusinessToProfileDraft(business: Business | null): ActiveBusinessProfileDraft {
  if (!business) return { ...emptyActiveBusinessProfileDraft };
  return {
    name: business.name ?? '',
    industry: business.industry ?? '',
    location: business.location ?? '',
    website_url: business.website_url ?? '',
    phone: business.phone ?? '',
    email: business.email ?? '',
  };
}

function activeBusinessProfileDraftToPayload(draft: ActiveBusinessProfileDraft): BusinessPayload {
  return {
    name: draft.name.trim(),
    industry: draft.industry.trim() || null,
    location: draft.location.trim() || null,
    website_url: draft.website_url.trim() || null,
    phone: draft.phone.trim() || null,
    email: draft.email.trim() || null,
  };
}

function formatActiveBusinessValue(value: string | null | undefined, fallback = 'Not set') {
  return value?.trim() || fallback;
}

function createToastId() {
  return globalThis.crypto?.randomUUID?.() ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildActiveBusinessGenerationProfile(
  activeBusiness: Business | null,
  context: BusinessContext | null,
  fallbackProfile: BusinessProfile,
): BusinessProfile | null {
  if (!activeBusiness) return null;

  const services = context?.services.filter((service) => service.trim()) ?? [];
  const serviceAreas = context?.service_area
    ? context.service_area
        .split(',')
        .map((area) => area.trim())
        .filter(Boolean)
    : [];

  return {
    business_name: activeBusiness.name,
    industry: activeBusiness.industry?.trim() || fallbackProfile.industry,
    service_area_cities:
      serviceAreas.length > 0
        ? serviceAreas
        : activeBusiness.location?.trim()
          ? [activeBusiness.location.trim()]
          : fallbackProfile.service_area_cities,
    services_offered: services.length > 0 ? services : fallbackProfile.services_offered,
    website_url: activeBusiness.website_url?.trim() || fallbackProfile.website_url,
    phone_number: activeBusiness.phone?.trim() || fallbackProfile.phone_number,
    email: activeBusiness.email?.trim() || fallbackProfile.email,
    brand_tone: context?.brand_voice?.trim() || fallbackProfile.brand_tone,
    target_customer: context?.target_customers?.trim() || fallbackProfile.target_customer,
    primary_cta: fallbackProfile.primary_cta || 'Request a free estimate',
    platforms_used: fallbackProfile.platforms_used,
    visibility_channels: fallbackProfile.visibility_channels,
  };
}

function visibilityToolTypeForPost(toolId: VisibilityToolId): SavedGeneratedPostFilter | null {
  if (toolId === 'local-reach-post') return 'reach';
  if (toolId === 'recent-work-post') return 'recent-work';
  if (toolId === 'review-request') return 'review';
  if (toolId === 'business-intro-post') return 'intro';
  return null;
}

function visibilityPlatformForPost(toolId: VisibilityToolId, formData: VisibilityToolFormData) {
  if (toolId === 'local-reach-post' || toolId === 'recent-work-post') return formData.destination;
  if (toolId === 'review-request') return 'Review Request';
  if (toolId === 'business-intro-post') return 'General Social Post';
  return null;
}

function visibilityGeneratedPostTitle(toolId: VisibilityToolId, formData: VisibilityToolFormData) {
  if (toolId === 'local-reach-post') {
    return `Lead post - ${formData.destination}`;
  }
  if (toolId === 'recent-work-post') {
    return formData.location.trim() ? `Recent work - ${formData.location.trim()}` : 'Recent work';
  }
  if (toolId === 'review-request') {
    return formData.customerName.trim() ? `Review request - ${formData.customerName.trim()}` : 'Review request';
  }
  if (toolId === 'business-intro-post') {
    return formData.location.trim() ? `Business intro - ${formData.location.trim()}` : 'Business intro';
  }
  return 'Generated post';
}

function generatedPostToolLabel(toolType: string) {
  if (toolType === 'reach') return 'Leads';
  if (toolType === 'recent-work') return 'Recent Work';
  if (toolType === 'review') return 'Reviews';
  if (toolType === 'intro') return 'Intros';
  return toolType;
}

function formatGeneratedPostDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function appendVisibilityRefinementNote(notes: string, instruction: string) {
  const trimmedNotes = notes.trim();
  return trimmedNotes ? `${trimmedNotes}\n${instruction}` : instruction;
}

function visibilityRefinementInstruction(refinement: VisibilityRefinement) {
  if (refinement === 'shorter') return 'Refinement: make the copy shorter and easier to scan.';
  if (refinement === 'friendlier') return 'Refinement: make the copy warmer and more neighborly.';
  if (refinement === 'professional') return 'Refinement: make the copy more polished and professional.';
  return 'Refinement: add a clearer, stronger call to action.';
}

function parseEditableProfileList(value: string) {
  return value.split('\n');
}

function formatProfileList(values: string[]) {
  return values.join('\n');
}

function normalizeBusinessProfile(profile: Partial<BusinessProfile> | null | undefined): BusinessProfile {
  const platforms = (profile?.platforms_used ?? defaultBusinessProfile.platforms_used).filter((platform) =>
    businessProfilePlatforms.includes(platform),
  );
  const visibilityChannels = (
    profile?.visibility_channels ?? defaultBusinessProfile.visibility_channels ?? defaultVisibilityChannels
  ).filter((channel): channel is VisibilityChannel => visibilityChannelOptions.includes(channel as VisibilityChannel));

  return {
    business_name: profile?.business_name?.trim() || defaultBusinessProfile.business_name,
    industry: profile?.industry?.trim() || defaultBusinessProfile.industry,
    service_area_cities:
      profile?.service_area_cities?.map((city) => city.trim()).filter(Boolean) ??
      defaultBusinessProfile.service_area_cities,
    services_offered:
      profile?.services_offered?.map((service) => service.trim()).filter(Boolean) ??
      defaultBusinessProfile.services_offered,
    website_url: profile?.website_url?.trim() || defaultBusinessProfile.website_url,
    phone_number: profile?.phone_number?.trim() ?? defaultBusinessProfile.phone_number,
    email: profile?.email?.trim() ?? defaultBusinessProfile.email,
    brand_tone: profile?.brand_tone?.trim() || defaultBusinessProfile.brand_tone,
    target_customer: profile?.target_customer?.trim() || defaultBusinessProfile.target_customer,
    primary_cta: profile?.primary_cta?.trim() || defaultBusinessProfile.primary_cta,
    platforms_used: platforms.length > 0 ? platforms : [...defaultBusinessProfile.platforms_used],
    visibility_channels:
      visibilityChannels.length > 0
        ? visibilityChannels
        : [...(defaultBusinessProfile.visibility_channels ?? defaultVisibilityChannels)],
  };
}

function loadStoredBusinessProfile() {
  if (typeof window === 'undefined') return defaultBusinessProfile;

  try {
    const storedProfile = window.localStorage.getItem(businessProfileStorageKey);
    if (!storedProfile) return defaultBusinessProfile;
    return normalizeBusinessProfile(JSON.parse(storedProfile) as Partial<BusinessProfile>);
  } catch {
    return defaultBusinessProfile;
  }
}

function storeBusinessProfile(profile: BusinessProfile) {
  // TODO: Replace localStorage with GET/PUT /business-profile when backend settings persistence is added.
  window.localStorage.setItem(businessProfileStorageKey, JSON.stringify(profile));
}

function loadStoredActiveBusinessId() {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(activeBusinessIdStorageKey) ?? '';
  } catch {
    return '';
  }
}

function storeActiveBusinessId(businessId: string) {
  if (typeof window === 'undefined') return;

  try {
    if (businessId) {
      window.localStorage.setItem(activeBusinessIdStorageKey, businessId);
    } else {
      window.localStorage.removeItem(activeBusinessIdStorageKey);
    }
  } catch {
    // Active business persistence is nice to have; current session state still works.
  }
}

function normalizeStoredTheme(value: string | null): AppTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function loadStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';

  try {
    const storedTheme = normalizeStoredTheme(window.localStorage.getItem(themeStorageKey));
    if (storedTheme) return storedTheme;
  } catch {
    // Ignore localStorage failures and fall back to the system preference.
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storeTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Theme persistence is nice to have; the active theme still applies for this session.
  }
}

function normalizeEmojiPreference(value: string | null): EmojiPreference | null {
  return value === 'less' || value === 'default' || value === 'more' ? value : null;
}

function loadStoredEmojiPreference(): EmojiPreference {
  if (typeof window === 'undefined') return 'default';

  try {
    return normalizeEmojiPreference(window.localStorage.getItem(emojiPreferenceStorageKey)) ?? 'default';
  } catch {
    return 'default';
  }
}

function storeEmojiPreference(preference: EmojiPreference) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(emojiPreferenceStorageKey, preference);
  } catch {
    // Emoji preference persistence is optional; generation still uses in-memory state.
  }
}

function weeklyPlatformsFromBusinessProfile(profile: BusinessProfile): WeeklySchedulePlatform[] {
  return profile.platforms_used.filter((platform): platform is WeeklySchedulePlatform =>
    weeklySchedulePlatformOptions.includes(platform),
  );
}

function weeklyCampaignThemeFromBusinessProfile(profile: BusinessProfile) {
  return profile.business_name ? `${profile.business_name} Weekly Local Business Content` : defaultWeeklyCampaignTheme;
}

function isPhotoAssetCategory(value: unknown): value is PhotoAssetCategory {
  return typeof value === 'string' && photoAssetCategories.includes(value as PhotoAssetCategory);
}

function isPhotoAssetQuality(value: unknown): value is PhotoAssetQuality {
  return value === 'standard' || value === 'strong' || value === 'hero';
}

function normalizeStoredPhotoAssetPayload(rawAsset: StoredPhotoAssetPayload | null | undefined): PhotoAssetPayload | null {
  if (!rawAsset?.title || (!rawAsset.image_data && !rawAsset.image_url && !rawAsset.image_path)) return null;
  return {
    business_id: rawAsset.business_id?.trim() || null,
    image_url: rawAsset.image_url?.trim() || rawAsset.image_path?.trim() || null,
    image_data: rawAsset.image_data || null,
    image_filename: rawAsset.image_filename?.trim() || null,
    title: rawAsset.title.trim(),
    description: rawAsset.description?.trim() || '',
    category: isPhotoAssetCategory(rawAsset.category) ? rawAsset.category : 'Finished Project',
    service_type: rawAsset.service_type?.trim() || '',
    location: rawAsset.location?.trim() || '',
    tags: (rawAsset.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    quality: isPhotoAssetQuality(rawAsset.quality) ? rawAsset.quality : 'standard',
  };
}

function loadStoredPhotoAssets() {
  if (typeof window === 'undefined') return [];

  try {
    const storedAssets = window.localStorage.getItem(photoLibraryStorageKey);
    if (!storedAssets) return [];
    const parsedAssets = JSON.parse(storedAssets) as unknown;
    if (!Array.isArray(parsedAssets)) return [];
    return parsedAssets
      .map((asset) => normalizeStoredPhotoAssetPayload(asset as StoredPhotoAssetPayload))
      .filter((asset): asset is PhotoAssetPayload => Boolean(asset));
  } catch {
    return [];
  }
}

function createEmptyPhotoAssetDraft(): PhotoAssetDraft {
  return {
    image_url: null,
    image_path: null,
    image_data: null,
    image_filename: null,
    title: '',
    description: '',
    category: 'Finished Project',
    service_type: '',
    location: '',
    tagsText: '',
    quality: 'standard',
  };
}

function isInteractiveElement(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(interactiveElementSelector));
}

function restoreBodyScrollLockStyles() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const { body, documentElement } = document;
  const previousStyles = bodyScrollLockState.previousStyles;
  if (!previousStyles) {
    body.classList.remove('modal-open');
    return;
  }

  body.style.overflow = previousStyles.bodyOverflow;
  body.style.overscrollBehavior = previousStyles.bodyOverscrollBehavior;
  body.style.position = previousStyles.bodyPosition;
  body.style.top = previousStyles.bodyTop;
  body.style.width = previousStyles.bodyWidth;
  documentElement.style.overflow = previousStyles.documentOverflow;
  documentElement.style.overscrollBehavior = previousStyles.documentOverscrollBehavior;
  body.classList.remove('modal-open');
  window.scrollTo(0, bodyScrollLockState.scrollY);
  bodyScrollLockState.previousStyles = null;
  bodyScrollLockState.scrollY = 0;
}

function lockBodyScroll(reason: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (bodyScrollLockState.locks.has(reason)) return;

  if (bodyScrollLockState.locks.size === 0) {
    const { body } = document;
    const { documentElement } = document;
    bodyScrollLockState.scrollY = window.scrollY;
    bodyScrollLockState.previousStyles = {
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      documentOverflow: documentElement.style.overflow,
      documentOverscrollBehavior: documentElement.style.overscrollBehavior,
    };
    body.classList.add('modal-open');
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `-${bodyScrollLockState.scrollY}px`;
    body.style.width = '100%';
    documentElement.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';
  }

  bodyScrollLockState.locks.add(reason);
}

function unlockBodyScroll(reason: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  bodyScrollLockState.locks.delete(reason);
  if (bodyScrollLockState.locks.size === 0) {
    restoreBodyScrollLockStyles();
  }
}

function cleanupAllBodyScrollLocks() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  bodyScrollLockState.locks.clear();
  restoreBodyScrollLockStyles();
}

function clearBodyInteractionLocks() {
  cleanupAllBodyScrollLocks();
  if (typeof document !== 'undefined') {
    document.body.classList.remove('calendar-drag-active');
  }
}

function useBodyScrollLock(active = true) {
  const lockReasonRef = useRef<string | null>(null);
  if (lockReasonRef.current === null) {
    bodyScrollLockId += 1;
    lockReasonRef.current = `body-lock-${bodyScrollLockId}`;
  }

  useEffect(() => {
    const lockReason = lockReasonRef.current;
    if (!active || !lockReason) return undefined;

    lockBodyScroll(lockReason);
    return () => unlockBodyScroll(lockReason);
  }, [active]);
}

function createPhotoAssetDraft(asset: PhotoAsset): PhotoAssetDraft {
  return {
    image_url: asset.image_url,
    image_path: asset.image_path,
    image_data: null,
    image_filename: asset.image_filename,
    title: asset.title,
    description: asset.description,
    category: asset.category,
    service_type: asset.service_type,
    location: asset.location,
    tagsText: asset.tags.join(', '),
    quality: asset.quality,
  };
}

function normalizePhotoTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function getPhotoAssetImageSource(asset: PhotoAsset | PhotoAssetDraft) {
  const imageData = 'image_data' in asset ? asset.image_data : null;
  return imageData || asset.image_path || asset.image_url;
}

function getPhotoAssetPreviewUrl(asset: PhotoAsset | PhotoAssetDraft) {
  const imageSource = getPhotoAssetImageSource(asset);
  if (!imageSource) return null;
  if (/^(data:|https?:\/\/)/i.test(imageSource)) return imageSource;
  return getMediaUrl(imageSource);
}

function getPhotoAssetQualityLabel(quality: PhotoAssetQuality) {
  return photoAssetQualityOptions.find((option) => option.value === quality)?.label ?? 'Standard';
}

function formatPhotoAssetDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function photoFileBatchKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function photoTitleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || filename;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read image file.'));
      }
    });
    reader.addEventListener('error', () => reject(new Error('Unable to read image file.')));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('Unable to preview this image file.')));
    image.src = source;
  });
}

async function fileToPhotoAssetImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  let storedDataUrl = originalDataUrl;

  try {
    const image = await loadImageElement(originalDataUrl);
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / image.width, maxDimension / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.84);
      if (compressedDataUrl.length < storedDataUrl.length || storedDataUrl.length > maxPhotoAssetDataUrlLength) {
        storedDataUrl = compressedDataUrl;
      }
    }
  } catch {
    storedDataUrl = originalDataUrl;
  }

  if (storedDataUrl.length > maxPhotoAssetDataUrlLength) {
    throw new Error('This image is too large to upload through the current Photo Library API. Use a smaller image for now.');
  }

  return {
    image_data: storedDataUrl,
    image_filename: file.name,
  };
}

function selectPhotoAssetsForGeneratedPost(
  assets: PhotoAsset[],
  criteria: { category?: PhotoAssetCategory; serviceType?: string; tags?: string[] },
) {
  // Frontend mirror for preview counts; backend generation performs the authoritative asset selection.
  const serviceType = criteria.serviceType?.trim().toLowerCase();
  const requestedTags = new Set((criteria.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return assets.filter((asset) => {
    if (criteria.category && asset.category !== criteria.category) return false;
    if (serviceType && asset.service_type.toLowerCase() !== serviceType) return false;
    if (requestedTags.size > 0 && !asset.tags.some((tag) => requestedTags.has(tag.toLowerCase()))) return false;
    return true;
  });
}

function formatCampaignCopyPackage(item: CampaignContentQueueItem) {
  return [
    `Platform: ${formatPlatformLabel(item.platform)}`,
    `Business: ${getCampaignItemBusiness(item)}`,
    `Scheduled: ${formatDisplayDate(item.scheduled_at)}`,
    '',
    'Post:',
    item.draft_text,
    '',
    `CTA: ${item.cta}`,
    `URL: ${item.landing_page_url}`,
    `Image: ${item.image_filename ?? 'None selected'}`,
    `Image Path: ${item.image_path ?? 'None selected'}`,
    `Image URL: ${item.image_url ?? 'None selected'}`,
  ].join('\n');
}

function formatWeeklyPostPackage(item: CampaignContentQueueItem) {
  return [
    `${formatPlatformLabel(item.platform)} post`,
    `Business: ${getCampaignItemBusiness(item)}`,
    `Scheduled: ${formatDisplayDate(item.scheduled_at)}`,
    '',
    item.draft_text,
    '',
    `CTA: ${item.cta}`,
    `Landing Page: ${item.landing_page_url}`,
    `Image: ${item.image_url ?? item.image_path ?? item.image_filename ?? 'None selected'}`,
  ].join('\n');
}

function formatMetaBusinessSuitePackage(item: CampaignContentQueueItem) {
  const savedPackageIndex = item.notes.indexOf('Meta Business Suite Package');
  if (savedPackageIndex >= 0) {
    return item.notes.slice(savedPackageIndex).trim();
  }

  const targets = new Set(
    item.platform === 'Meta Dual'
      ? ['Facebook', 'Instagram']
      : item.platform === 'Instagram'
        ? ['Instagram']
        : ['Facebook'],
  );

  return [
    'Meta Business Suite Package',
    '',
    'Facebook caption:',
    targets.has('Facebook') ? item.draft_text : 'Not targeted by this row.',
    '',
    'Instagram caption:',
    targets.has('Instagram') ? item.draft_text : 'Not targeted by this row.',
    '',
    `Image URL/Path: ${item.image_url ?? item.image_path ?? 'None selected'}`,
    `CTA: ${item.cta}`,
    `Landing Page: ${item.landing_page_url}`,
    `Suggested Schedule Time: ${item.scheduled_at ?? 'Post when ready.'}`,
  ].join('\n');
}

function getCampaignItemImageSource(item: CampaignContentQueueItem) {
  return item.image_url ?? item.image_path;
}

function getCampaignItemImageFilename(item: CampaignContentQueueItem) {
  if (item.image_filename) return item.image_filename;
  const imageSource = getCampaignItemImageSource(item);
  if (!imageSource) return `${item.content_id}.jpg`;
  try {
    const parsedUrl = new URL(imageSource, window.location.origin);
    const filename = parsedUrl.pathname.split('/').filter(Boolean).pop();
    return filename || `${item.content_id}.jpg`;
  } catch {
    return imageSource.split('/').filter(Boolean).pop() || `${item.content_id}.jpg`;
  }
}

function normalizeImageReference(value: string | null | undefined) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) return null;

  try {
    const parsedUrl = new URL(trimmedValue, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    return /^https?:\/\//i.test(trimmedValue)
      ? `${parsedUrl.origin}${parsedUrl.pathname}`.toLowerCase()
      : parsedUrl.pathname.toLowerCase();
  } catch {
    return trimmedValue.split(/[?#]/, 1)[0].toLowerCase();
  }
}

function imageFilenameFromSource(value: string | null | undefined) {
  const normalizedReference = normalizeImageReference(value);
  return normalizedReference?.split('/').filter(Boolean).pop() ?? null;
}

function isPhotoLibraryImageSource(value: string | null | undefined) {
  return normalizeImageReference(value)?.includes('/media/photo-assets/') ?? false;
}

function getPhotoAssetImageFilename(asset: PhotoAsset) {
  return asset.image_filename || imageFilenameFromSource(asset.image_path || asset.image_url);
}

function findPhotoAssetByImage(
  assets: PhotoAsset[],
  imageSource: string | null | undefined,
  imageFilename: string | null | undefined,
) {
  const sourceReference = normalizeImageReference(imageSource);
  const filenameReference = normalizeImageReference(imageFilename);
  const directMatch = assets.find((asset) => {
    const assetPathReference = normalizeImageReference(asset.image_path);
    const assetUrlReference = normalizeImageReference(asset.image_url);
    return Boolean(
      sourceReference &&
        (sourceReference === assetPathReference || sourceReference === assetUrlReference),
    );
  });
  if (directMatch) return directMatch;

  if (!isPhotoLibraryImageSource(imageSource) || !filenameReference) return null;
  return (
    assets.find((asset) => {
      const assetFilename = normalizeImageReference(getPhotoAssetImageFilename(asset));
      return Boolean(assetFilename && assetFilename === filenameReference);
    }) ?? null
  );
}

function getCampaignItemPhotoAsset(item: CampaignContentQueueItem, assets: PhotoAsset[]) {
  return findPhotoAssetByImage(assets, getCampaignItemImageSource(item), item.image_filename);
}

function getContentSlotPhotoAsset(slot: ContentSlot, assets: PhotoAsset[]) {
  for (const item of slot.sourceItems) {
    const asset = getCampaignItemPhotoAsset(item, assets);
    if (asset) return asset;
  }
  return findPhotoAssetByImage(assets, slot.imageSource, imageFilenameFromSource(slot.imageSource));
}

function contentSlotUsesPhotoLibrary(slot: ContentSlot, assets: PhotoAsset[]) {
  return Boolean(
    getContentSlotPhotoAsset(slot, assets) ||
      slot.sourceItems.some((item) => isPhotoLibraryImageSource(getCampaignItemImageSource(item))) ||
      isPhotoLibraryImageSource(slot.imageSource),
  );
}

function photoAssetImageUpdatePayload(asset: PhotoAsset) {
  const imageSource = getPhotoAssetImageSource(asset);
  if (!imageSource) return null;

  return {
    image_filename: getPhotoAssetImageFilename(asset) ?? `${asset.id}.jpg`,
    image_path: asset.image_path,
    image_url: asset.image_url,
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function openMetaBusinessSuite(): WindowProxy | null {
  return window.open('https://business.facebook.com/latest/composer', '_blank', 'noopener,noreferrer');
}

function formatPlatformLabel(platform: CampaignContentQueueItem['platform'] | ContentQueueItem['platform']) {
  if (platform === 'Meta Dual') return 'Facebook + Instagram';
  if (platform === 'Facebook Page') return 'Facebook + Instagram';
  return platform;
}

function statusClassName(status: string) {
  return `status-pill status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function getCampaignItemBusiness(item: CampaignContentQueueItem) {
  return item.business ?? readNoteValue(item.notes, 'Business') ?? item.campaign_id;
}

function getCampaignItemBusinessId(item: CampaignContentQueueItem) {
  return readNoteValue(item.notes, 'Business ID');
}

function normalizeBusinessScopeValue(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function campaignItemBelongsToActiveBusiness(item: CampaignContentQueueItem, activeBusiness: Business | null) {
  if (!activeBusiness) return false;

  const itemBusinessId = getCampaignItemBusinessId(item);
  if (itemBusinessId) return itemBusinessId === activeBusiness.id;

  return normalizeBusinessScopeValue(getCampaignItemBusiness(item)) === normalizeBusinessScopeValue(activeBusiness.name);
}

function readNoteValue(notes: string, key: string) {
  const prefix = `${key.toLowerCase()}:`;
  const line = notes.split('\n').find((noteLine) => noteLine.trim().toLowerCase().startsWith(prefix));
  return line?.split(':', 2)[1]?.trim() || null;
}

function normalizeContentType(postType: string | null) {
  if (!postType) return 'Content Idea';

  const aliases: Record<string, string> = {
    'Before and After': 'Before/After',
    'Before/After': 'Before/After',
    'FAQ / Education': 'Service Education',
    'FAQ Education': 'Service Education',
    'Offer / CTA': 'CTA',
    'Offer CTA': 'CTA',
    'Free Estimate CTA': 'CTA',
    'Problem/Solution': 'Problem Solution',
    'Trust / Local Proof': 'Trust Local Proof',
  };

  return aliases[postType] ?? postType;
}

function getContentItemType(item: CampaignContentQueueItem) {
  return normalizeContentType(item.post_type ?? readNoteValue(item.notes, 'Post Type'));
}

function getContentItemWeekKey(item: CampaignContentQueueItem) {
  return readNoteValue(item.notes, 'Week') ?? 'Unscheduled';
}

function getContentItemSlotIndex(item: CampaignContentQueueItem) {
  const rawValue = readNoteValue(item.notes, 'Slot');
  if (!rawValue) return null;
  const slotIndex = Number.parseInt(rawValue, 10);
  return Number.isFinite(slotIndex) && slotIndex > 0 ? slotIndex : null;
}

function getContentItemScheduledAt(item: CampaignContentQueueItem) {
  if (item.scheduled_at) return item.scheduled_at;

  const scheduledDate = readNoteValue(item.notes, 'Scheduled Date');
  if (scheduledDate) return `${scheduledDate}T15:00:00Z`;

  return item.created_at;
}

function getContentItemDayIndex(item: CampaignContentQueueItem) {
  const dateValue = getContentItemScheduledAt(item);
  const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return 0;

  const [, year, month, dayOfMonth] = dateMatch;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(dayOfMonth)));
  if (Number.isNaN(date.getTime())) return 0;

  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 6 : utcDay - 1;
}

function getContentSlotTitle(items: CampaignContentQueueItem[]) {
  const titledItem = items.find((item) => readNoteValue(item.notes, 'Title') ?? readNoteValue(item.notes, 'Topic'));
  const explicitTitle = titledItem
    ? readNoteValue(titledItem.notes, 'Title') ?? readNoteValue(titledItem.notes, 'Topic')
    : null;
  if (explicitTitle) return explicitTitle;

  const firstItem = items[0];
  if (!firstItem) return 'Content Slot';

  const contentType = getContentItemType(firstItem);
  const business = getCampaignItemBusiness(firstItem);
  return business ? `${contentType}: ${business}` : contentType;
}

function getPlanningStatus(item: CampaignContentQueueItem) {
  if (item.status === 'Posted') return 'Posted';
  if (item.status === 'Published' || item.published === 'Yes') return 'Published';
  if (item.status === 'Scheduled') return 'Scheduled';
  if (item.status === 'Approved' || item.approved === 'Yes') return item.scheduled_at ? 'Scheduled' : 'Approved';
  return item.status || 'Draft';
}

function getContentSlotStatusSummary(items: CampaignContentQueueItem[]) {
  const counts = items.reduce(
    (currentCounts, item) => {
      const status = getPlanningStatus(item);
      currentCounts[status] = (currentCounts[status] ?? 0) + 1;
      return currentCounts;
    },
    {} as Record<string, number>,
  );
  const entries = Object.entries(counts);
  if (entries.length === 0) return 'Draft';
  if (entries.length === 1) return entries[0][0];
  return entries.map(([status, count]) => `${count} ${status}`).join(' · ');
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function isPublishedPlanningStatus(status: string) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'posted' || normalizedStatus === 'published';
}

function isDraftPlanningStatus(status: string) {
  return normalizeStatus(status) === 'draft';
}

function isReadyPlanningStatus(status: string) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'approved' || normalizedStatus === 'ready' || normalizedStatus === 'scheduled';
}

function isNeedsReviewPlanningStatus(status: string) {
  return normalizeStatus(status) === 'needs review';
}

function isFailedPlanningStatus(status: string) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus.includes('failed') || normalizedStatus.includes('error');
}

function isActionablePlanningStatus(status: string) {
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus !== 'posted' && normalizedStatus !== 'published' && normalizedStatus !== 'skipped';
}

function formatCalendarPlatformShortLabel(platform: CalendarPlatform) {
  if (platform === 'Facebook') return 'FB';
  if (platform === 'Instagram') return 'IG';
  if (platform === 'Google Business') return 'Google';
  if (platform === 'Facebook Groups') return 'Groups';
  return platform;
}

function getCalendarPlatformsForItem(item: CampaignContentQueueItem): CalendarPlatform[] {
  if (item.platform === 'Meta Dual' || item.platform === 'Facebook Page') return ['Facebook', 'Instagram'];
  if (item.platform === 'Facebook') return ['Facebook'];
  if (item.platform === 'Instagram') return ['Instagram'];
  if (item.platform === 'Google Business') return ['Google Business'];
  if (item.platform === 'Facebook Groups') return ['Facebook Groups'];
  if (item.platform === 'Craigslist') return ['Craigslist'];
  return ['Nextdoor'];
}

function buildPlatformPosts(items: CampaignContentQueueItem[]): PlatformPost[] {
  return items
    .flatMap((item) =>
      getCalendarPlatformsForItem(item).map((platform) => ({
        id: `${item.content_id}:${platform}`,
        platform,
        sourcePlatform: item.platform,
        item,
      })),
    )
    .sort((a, b) => {
      const platformCompare = calendarPlatformOrder[a.platform] - calendarPlatformOrder[b.platform];
      if (platformCompare !== 0) return platformCompare;
      return a.item.content_id.localeCompare(b.item.content_id);
    });
}

function getPlatformPostsForStatus(slot: ContentSlot, platform: CalendarPlatform) {
  return slot.platformPosts.filter((post) => {
    return post.platform === platform;
  });
}

function summarizePlatformStatus(posts: PlatformPost[]) {
  if (posts.length === 0) return 'Missing';

  const statuses = posts.map((post) => getPlanningStatus(post.item));
  if (statuses.some(isFailedPlanningStatus)) return 'Failed';
  if (statuses.some(isNeedsReviewPlanningStatus)) return 'Needs Review';
  if (statuses.every(isPublishedPlanningStatus)) return 'Posted';
  if (statuses.every((status) => normalizeStatus(status) === 'scheduled')) return 'Scheduled';
  if (statuses.every(isReadyPlanningStatus)) return 'Approved';
  if (statuses.every(isDraftPlanningStatus)) return 'Draft';
  if (statuses.some(isDraftPlanningStatus)) return 'Draft';
  return 'Mixed';
}

function getPlatformStatusRows(slot: ContentSlot): PlatformStatusRow[] {
  return coreCalendarPlatforms.map((platform) => ({
    platform,
    label: formatCalendarPlatformShortLabel(platform),
    status: summarizePlatformStatus(getPlatformPostsForStatus(slot, platform)),
  }));
}

function getContentSlotPlatformLabels(slot: ContentSlot) {
  const platformLabels = new Map<CalendarPlatform, string>();
  for (const post of slot.platformPosts) {
    platformLabels.set(post.platform, formatCalendarPlatformShortLabel(post.platform));
  }

  return Array.from(platformLabels.entries())
    .sort(([a], [b]) => calendarPlatformOrder[a] - calendarPlatformOrder[b])
    .map(([platform, label]) => ({ platform, label }));
}

function getCollapsedContentSlotStatus(slot: ContentSlot) {
  const statuses = slot.platformPosts.map((post) => getPlanningStatus(post.item));
  const platformCount = slot.platformPosts.length;
  const platformLabel = `${platformCount} platform${platformCount === 1 ? '' : 's'}`;

  if (statuses.length === 0) {
    return { label: 'Missing', status: 'Missing', detail: 'No platforms' };
  }
  if (statuses.some(isFailedPlanningStatus)) {
    return { label: 'Needs attention', status: 'Needs Attention', detail: platformLabel };
  }
  if (statuses.some(isNeedsReviewPlanningStatus)) {
    return { label: 'Needs review', status: 'Needs Review', detail: platformLabel };
  }
  if (statuses.some(isDraftPlanningStatus)) {
    const draftCount = statuses.filter(isDraftPlanningStatus).length;
    return {
      label: 'Draft',
      status: 'Draft',
      detail: draftCount === platformCount ? platformLabel : `${draftCount} draft / ${platformLabel}`,
    };
  }
  if (statuses.every(isPublishedPlanningStatus)) {
    return { label: 'Posted', status: 'Posted', detail: platformLabel };
  }
  if (statuses.every(isReadyPlanningStatus)) {
    return { label: 'Ready', status: 'Ready', detail: platformLabel };
  }

  return { label: slot.statusSummary, status: slot.statusSummary, detail: platformLabel };
}

function buildWeeklyActionSummary(slots: ContentSlot[]): WeeklyActionSummary {
  const actionCounts = coreCalendarPlatforms.reduce(
    (counts, platform) => {
      counts[platform] = 0;
      return counts;
    },
    {} as Record<CalendarPlatform, number>,
  );
  const statuses = slots.flatMap((slot) =>
    slot.platformPosts.map((post) => {
      const status = getPlanningStatus(post.item);
      if (coreCalendarPlatforms.includes(post.platform as WeeklySchedulePlatform) && isActionablePlanningStatus(status)) {
        actionCounts[post.platform] = (actionCounts[post.platform] ?? 0) + 1;
      }
      return status;
    }),
  );

  return {
    totalPlatformPosts: statuses.length,
    publishedCount: statuses.filter(isPublishedPlanningStatus).length,
    draftCount: statuses.filter(isDraftPlanningStatus).length,
    needsReviewCount: statuses.filter(isNeedsReviewPlanningStatus).length,
    failedCount: statuses.filter(isFailedPlanningStatus).length,
    readyCount: statuses.filter(isReadyPlanningStatus).length,
    contentSlotCount: slots.length,
    actionByPlatform: coreCalendarPlatforms.map((platform) => ({
      platform,
      label: formatCalendarPlatformShortLabel(platform),
      count: actionCounts[platform] ?? 0,
    })),
  };
}

function buildContentSlots(items: CampaignContentQueueItem[]): ContentSlot[] {
  const groups = new Map<string, CampaignContentQueueItem[]>();

  for (const item of items) {
    const slotIndex = getContentItemSlotIndex(item);
    // TODO: Replace this notes/content_id inference when the backend exposes first-class ContentSlot rows.
    const groupKey =
      slotIndex === null
        ? `${item.campaign_id}:${getContentItemWeekKey(item)}:${item.content_id}`
        : `${item.campaign_id}:${getContentItemWeekKey(item)}:${slotIndex}`;
    const groupItems = groups.get(groupKey) ?? [];
    groupItems.push(item);
    groups.set(groupKey, groupItems);
  }

  return Array.from(groups.entries())
    .map(([id, groupItems]) => {
      const sortedItems = [...groupItems].sort((a, b) => {
        const scheduledCompare = getContentItemScheduledAt(a).localeCompare(getContentItemScheduledAt(b));
        if (scheduledCompare !== 0) return scheduledCompare;
        return campaignPlatformOrder[a.platform] - campaignPlatformOrder[b.platform];
      });
      const firstItem = sortedItems[0];
      const imageItem = sortedItems.find((item) => getCampaignItemImageSource(item));

      return {
        id,
        campaignId: firstItem.campaign_id,
        business: getCampaignItemBusiness(firstItem),
        weekKey: getContentItemWeekKey(firstItem),
        title: getContentSlotTitle(sortedItems),
        contentType: getContentItemType(firstItem),
        dayIndex: getContentItemDayIndex(firstItem),
        scheduledAt: getContentItemScheduledAt(firstItem),
        imageSource: imageItem ? getCampaignItemImageSource(imageItem) : null,
        statusSummary: getContentSlotStatusSummary(sortedItems),
        sourceItems: sortedItems,
        platformPosts: buildPlatformPosts(sortedItems),
      };
    })
    .sort((a, b) => {
      const dayCompare = a.dayIndex - b.dayIndex;
      if (dayCompare !== 0) return dayCompare;
      return (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '');
    });
}

function buildWeeklyCampaignCalendars(items: CampaignContentQueueItem[]): WeeklyCampaignCalendar[] {
  const groups = new Map<string, CampaignContentQueueItem[]>();

  for (const item of items) {
    // TODO: Replace week grouping with backend Campaign.weekStart/weekEnd fields during the model migration.
    const groupKey = `${item.campaign_id}:${getContentItemWeekKey(item)}`;
    const groupItems = groups.get(groupKey) ?? [];
    groupItems.push(item);
    groups.set(groupKey, groupItems);
  }

  return Array.from(groups.entries())
    .map(([groupKey, groupItems]) => {
      const firstItem = groupItems[0];
      return {
        campaignId: firstItem.campaign_id,
        business: getCampaignItemBusiness(firstItem),
        weekKey: getContentItemWeekKey(firstItem),
        contentSlots: buildContentSlots(groupItems),
      };
    })
    .sort((a, b) => a.business.localeCompare(b.business) || a.weekKey.localeCompare(b.weekKey));
}

function getPlatformBadgeState(slot: ContentSlot, platform: CalendarPlatform) {
  return slot.platformPosts.some((post) => {
    return post.platform === platform;
  });
}

function publishTargetPlatformFromCalendarPlatform(platform: CalendarPlatform): PublishTargetPlatform | null {
  if (platform === 'Facebook' || platform === 'Instagram' || platform === 'Google Business') return platform;
  return null;
}

function getPublishTargetMissingMessage(platform: PublishTargetPlatform) {
  if (platform === 'Facebook') return 'Connect or assign Facebook Page in Settings';
  if (platform === 'Instagram') return 'Connect or assign Instagram Account in Settings';
  return 'Connect or assign Google Business Location in Settings';
}

function getPublishTargetState(
  platform: CalendarPlatform,
  socialTargets: SocialTarget[],
  businessPublishTargets: BusinessPublishTarget[],
  loading: boolean,
  error: string | null,
): PublishTargetState {
  if (platform === 'Facebook Groups') {
    return {
      kind: 'manual',
      label: 'Manual only',
      detail: 'Manual posting assistant only',
      targetName: null,
    };
  }

  const publishPlatform = publishTargetPlatformFromCalendarPlatform(platform);
  if (!publishPlatform) {
    return {
      kind: 'manual',
      label: 'Manual/export',
      detail: 'Manual or export workflow only',
      targetName: null,
    };
  }

  if (loading) {
    return {
      kind: 'loading',
      label: 'Checking target',
      detail: 'Checking publishing target status',
      targetName: null,
    };
  }

  if (error) {
    return {
      kind: 'unavailable',
      label: 'Target unavailable',
      detail: 'Publishing target status unavailable',
      targetName: null,
    };
  }

  const mapping = businessPublishTargets.find((item) => item.platform === publishPlatform);
  const target = mapping ? socialTargets.find((item) => item.id === mapping.social_target_id) : null;
  if (target) {
    return {
      kind: 'assigned',
      label: 'Assigned target',
      detail: `Target: ${target.display_name}`,
      targetName: target.display_name,
    };
  }

  return {
    kind: 'missing',
    label: 'Missing target',
    detail: getPublishTargetMissingMessage(publishPlatform),
    targetName: null,
  };
}

function getPublishTargetStateClassName(state: PublishTargetState) {
  return `target-state-${state.kind}`;
}

function getPublishTargetChipLabel(state: PublishTargetState) {
  if (state.kind === 'assigned') return state.targetName ? `Target: ${state.targetName}` : 'Target';
  if (state.kind === 'manual') return 'Manual';
  if (state.kind === 'loading') return 'Checking';
  if (state.kind === 'unavailable') return 'Unavailable';
  return 'Missing';
}

function formatDisplayDate(value: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function isMetaPlatform(platform: CampaignContentQueueItem['platform']) {
  return ['Facebook', 'Facebook Page', 'Instagram', 'Meta Dual'].includes(platform);
}

function isCampaignItemPublishable(item: CampaignContentQueueItem) {
  if (
    item.platform === 'Facebook Groups' ||
    item.status === 'Rejected' ||
    item.status === 'Needs Review' ||
    item.status === 'Draft' ||
    item.status === 'Copied' ||
    item.status === 'Posted' ||
    item.status === 'Skipped' ||
    item.status === 'Published' ||
    item.status === 'Publish Blocked' ||
    item.status === 'Ready for Manual Post' ||
    item.status === 'Ready for Meta Business Suite' ||
    item.published === 'Yes'
  ) {
    return false;
  }

  return item.status === 'Approved' || item.approved === 'Yes';
}

function toDatetimeLocalValue(isoValue: string | null) {
  if (!isoValue) return '';

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function datetimeLocalToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseDateInputAsUtc(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUtcDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function getCalendarWeekStartDateForDateInput(dateInput: string) {
  const referenceDate = parseDateInputAsUtc(dateInput) ?? parseDateInputAsUtc(getDefaultWeekStartDateInput());
  if (!referenceDate) return getDefaultWeekStartDateInput();

  const day = referenceDate.getUTCDay();
  const offsetToMonday = day === 0 ? 1 : 1 - day;
  const weekStartDate = new Date(referenceDate);
  weekStartDate.setUTCDate(referenceDate.getUTCDate() + offsetToMonday);
  return formatUtcDateInputValue(weekStartDate);
}

function dateInputToScheduledAt(dateInput: string) {
  const scheduledDate = parseDateInputAsUtc(dateInput);
  if (!scheduledDate) return null;

  scheduledDate.setUTCHours(15, 0, 0, 0);
  return scheduledDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function manualPostRequestPlatforms(platforms: WeeklySchedulePlatform[]): CampaignContentQueueItem['platform'][] {
  const requestPlatforms: CampaignContentQueueItem['platform'][] = [];
  const wantsMeta = platforms.includes('Facebook') || platforms.includes('Instagram');

  if (wantsMeta) {
    requestPlatforms.push(
      platforms.includes('Facebook') && platforms.includes('Instagram')
        ? 'Meta Dual'
        : platforms.includes('Facebook')
          ? 'Facebook'
          : 'Instagram',
    );
  }
  if (platforms.includes('Google Business')) {
    requestPlatforms.push('Google Business');
  }
  if (platforms.includes('Facebook Groups')) {
    requestPlatforms.push('Facebook Groups');
  }

  return requestPlatforms;
}

function getWeekdayDateInputValue(weekStartDate: string, dayIndex: number) {
  const calendarStart = parseDateInputAsUtc(weekStartDate) ?? parseDateInputAsUtc(getDefaultWeekStartDateInput());
  if (!calendarStart) return getDefaultWeekStartDateInput();

  const scheduledDate = new Date(calendarStart);
  scheduledDate.setUTCDate(calendarStart.getUTCDate() + dayIndex);
  return formatUtcDateInputValue(scheduledDate);
}

function getDateInputFromScheduledAt(scheduledAt: string | null) {
  if (!scheduledAt) return null;
  const dateMatch = scheduledAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
}

function getScheduledAtDayIndexInWeek(scheduledAt: string | null, weekStartDate: string) {
  const scheduledDateInput = getDateInputFromScheduledAt(scheduledAt);
  const scheduledDate = scheduledDateInput ? parseDateInputAsUtc(scheduledDateInput) : null;
  const weekStart = parseDateInputAsUtc(weekStartDate);
  if (!scheduledDate || !weekStart) return null;

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const dayIndex = Math.round((scheduledDate.getTime() - weekStart.getTime()) / millisecondsPerDay);
  return dayIndex >= 0 && dayIndex < calendarDays.length ? dayIndex : null;
}

function recalculateScheduledAtForWeekday(slot: ContentSlot, targetDayIndex: number, weekStartDate: string) {
  const scheduledDate = parseDateInputAsUtc(getWeekdayDateInputValue(weekStartDate, targetDayIndex));
  if (!scheduledDate) return null;

  const existingDate = slot.scheduledAt ? new Date(slot.scheduledAt) : null;
  const hasExistingTime = existingDate && !Number.isNaN(existingDate.getTime());

  scheduledDate.setUTCHours(
    hasExistingTime ? existingDate.getUTCHours() : 15,
    hasExistingTime ? existingDate.getUTCMinutes() : 0,
    hasExistingTime ? existingDate.getUTCSeconds() : 0,
    0,
  );
  return scheduledDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function moveContentSlotItemsToDay(
  items: CampaignContentQueueItem[],
  contentIds: Set<string>,
  scheduledAt: string,
) {
  return items.map((item) => (contentIds.has(item.content_id) ? { ...item, scheduled_at: scheduledAt } : item));
}

function getMissingContentIds(items: CampaignContentQueueItem[], contentIds: Set<string>) {
  const returnedIds = new Set(items.map((item) => item.content_id));
  return Array.from(contentIds).filter((contentId) => !returnedIds.has(contentId));
}

function findMoveTargetMismatch(
  items: CampaignContentQueueItem[],
  contentIds: Set<string>,
  targetDayIndex: number,
  weekStartDate: string,
) {
  return items.find((item) => {
    if (!contentIds.has(item.content_id)) return false;
    return getScheduledAtDayIndexInWeek(getContentItemScheduledAt(item), weekStartDate) !== targetDayIndex;
  });
}

function deleteContentSlotItems(items: CampaignContentQueueItem[], contentIds: Set<string>) {
  return items.filter((item) => !contentIds.has(item.content_id));
}

function updateContentSlotItemsImage(
  items: CampaignContentQueueItem[],
  contentIds: Set<string>,
  imagePayload: Pick<CampaignContentQueueItem, 'image_filename' | 'image_path' | 'image_url'>,
) {
  return items.map((item) => (contentIds.has(item.content_id) ? { ...item, ...imagePayload } : item));
}

function renderGoogleBusinessPublishStatus(item: CampaignContentQueueItem) {
  if (item.platform !== 'Google Business') return null;

  if (item.published === 'Yes' || item.status === 'Published') {
    return (
      <div className="publisher-status publisher-status-published">
        <strong>Published to Google Business</strong>
        {item.published_url ? (
          <a href={item.published_url} rel="noreferrer" target="_blank">
            View post
          </a>
        ) : null}
      </div>
    );
  }

  if (item.last_publish_error) {
    if (item.status === 'Ready for Manual Post') {
      return (
        <div className="publisher-status publisher-status-manual">
          <strong>Ready for Manual Post</strong>
          <span>Legacy Google My Business API publishing is unavailable. Use Copy Package.</span>
        </div>
      );
    }

    return (
      <div className="publisher-status publisher-status-failed">
        <strong>Google Business publish failed</strong>
        <span>{item.last_publish_error}</span>
      </div>
    );
  }

  if (isCampaignItemPublishable(item)) {
    return (
      <div className="publisher-status publisher-status-ready">
        <strong>Ready for Google Business publish</strong>
        <span>Approved and unpublished.</span>
      </div>
    );
  }

  return null;
}

function renderMetaPublishStatus(item: CampaignContentQueueItem) {
  if (!isMetaPlatform(item.platform)) return null;

  const facebookLine = item.notes
    .split('\n')
    .find((line) => line.trim().toLowerCase().startsWith('facebook:'));
  const instagramLine = item.notes
    .split('\n')
    .find((line) => line.trim().toLowerCase().startsWith('instagram:'));

  return (
    <div
      className={`publisher-status ${
        item.status === 'Publish Blocked'
          ? 'publisher-status-failed'
          : item.status === 'Ready for Meta Business Suite'
            ? 'publisher-status-manual'
            : 'publisher-status-ready'
      }`}
    >
      <strong>Meta publishing</strong>
      <span>Status: {item.status}</span>
      {item.status === 'Ready for Meta Business Suite' ? (
        <span>Copy the Meta package into Meta Business Suite.</span>
      ) : null}
      {facebookLine ? <span>Facebook result: {facebookLine.replace(/^Facebook:\s*/i, '')}</span> : null}
      {instagramLine ? <span>Instagram result: {instagramLine.replace(/^Instagram:\s*/i, '')}</span> : null}
      {item.external_post_id ? <span>External IDs: {item.external_post_id}</span> : null}
      {item.published_url ? <span>Published URLs: {item.published_url}</span> : null}
      {item.last_publish_error ? <span>Last error: {item.last_publish_error}</span> : null}
    </div>
  );
}

function App() {
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [queue, setQueue] = useState<ContentQueueItem[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignQueue, setCampaignQueue] = useState<CampaignContentQueueItem[]>([]);
  const [weeklyQueue, setWeeklyQueue] = useState<CampaignContentQueueItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingCampaignQueue, setLoadingCampaignQueue] = useState(true);
  const [loadingWeeklyQueue, setLoadingWeeklyQueue] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [activeSection, setActiveSection] = useState<AppSection>('calendar');
  const [theme, setTheme] = useState<AppTheme>(() => loadStoredTheme());
  const [emojiPreference, setEmojiPreference] = useState<EmojiPreference>(() => loadStoredEmojiPreference());
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(() => loadStoredBusinessProfile());
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState(() => loadStoredActiveBusinessId());
  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [businessCreateDraft, setBusinessCreateDraft] = useState<BusinessCreateDraft>(defaultBusinessCreateDraft);
  const [creatingBusiness, setCreatingBusiness] = useState(false);
  const [activeBusinessProfileDraft, setActiveBusinessProfileDraft] =
    useState<ActiveBusinessProfileDraft>(emptyActiveBusinessProfileDraft);
  const [savingActiveBusinessProfile, setSavingActiveBusinessProfile] = useState(false);
  const [activeBusinessProfileError, setActiveBusinessProfileError] = useState<string | null>(null);
  const [activeBusinessContext, setActiveBusinessContext] = useState<BusinessContext | null>(null);
  const [businessContextDraft, setBusinessContextDraft] = useState<BusinessContextDraft>(emptyBusinessContextDraft);
  const [loadingBusinessContext, setLoadingBusinessContext] = useState(false);
  const [savingBusinessContext, setSavingBusinessContext] = useState(false);
  const [businessContextError, setBusinessContextError] = useState<string | null>(null);
  const [publishSocialTargets, setPublishSocialTargets] = useState<SocialTarget[]>([]);
  const [activeBusinessPublishTargets, setActiveBusinessPublishTargets] = useState<BusinessPublishTarget[]>([]);
  const [loadingPublishTargets, setLoadingPublishTargets] = useState(false);
  const [publishTargetsError, setPublishTargetsError] = useState<string | null>(null);
  const [photoAssets, setPhotoAssets] = useState<PhotoAsset[]>([]);
  const [selectedVisibilityToolId, setSelectedVisibilityToolId] = useState<VisibilityToolId>('local-reach-post');
  const [visibilityToolFormData, setVisibilityToolFormData] = useState<VisibilityToolFormData>(() =>
    createDefaultVisibilityToolFormData('local-reach-post', loadStoredBusinessProfile()),
  );
  const [visibilityToolOutput, setVisibilityToolOutput] = useState<VisibilityGenerationResponse | null>(null);
  const [visibilityToolError, setVisibilityToolError] = useState<string | null>(null);
  const [visibilityToolGenerating, setVisibilityToolGenerating] = useState(false);
  const [visibilityToolSaving, setVisibilityToolSaving] = useState(false);
  const [visibilityToolCopied, setVisibilityToolCopied] = useState(false);
  const [savedGeneratedPosts, setSavedGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [loadingSavedGeneratedPosts, setLoadingSavedGeneratedPosts] = useState(false);
  const [savedGeneratedPostFilter, setSavedGeneratedPostFilter] = useState<SavedGeneratedPostFilter>('all');
  const [copiedPackageId, setCopiedPackageId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftTextEdits, setDraftTextEdits] = useState<Record<string, string>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [manualPostSettings, setManualPostSettings] = useState<ManualPostSettings>(() => defaultManualPostSettings());
  const [showManualPostModal, setShowManualPostModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showWeeklyScheduleModal, setShowWeeklyScheduleModal] = useState(false);
  const [calendarWeekStartDate, setCalendarWeekStartDate] = useState(() => getDefaultWeekStartDateInput());
  const [weeklyScheduleSettings, setWeeklyScheduleSettings] = useState<WeeklyScheduleSettings>(() =>
    defaultWeeklyScheduleSettings(),
  );
  const [showPreviousPosts, setShowPreviousPosts] = useState(false);
  const [expandedQueueJobs, setExpandedQueueJobs] = useState<Record<string, boolean>>({});
  const [expandedCampaignQueue, setExpandedCampaignQueue] = useState<Record<string, boolean>>({});
  const [selectedContentSlotId, setSelectedContentSlotId] = useState<string | null>(null);
  const [isMobileCalendar, setIsMobileCalendar] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 900px)').matches,
  );
  const [calendarDrag, setCalendarDrag] = useState<CalendarDragState | null>(null);
  const [pendingDeleteContentSlotId, setPendingDeleteContentSlotId] = useState<string | null>(null);
  const [photoPickerContentSlotId, setPhotoPickerContentSlotId] = useState<string | null>(null);
  const [postAssistantItem, setPostAssistantItem] = useState<CampaignContentQueueItem | null>(null);
  const [postAssistantCopiedAction, setPostAssistantCopiedAction] = useState<PostAssistantCopiedAction>(null);
  const [postAssistantError, setPostAssistantError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ job: CompletedJob; draft: ContentDraft } | null>(null);
  const [campaignPreview, setCampaignPreview] = useState<{ campaign: Campaign; draftSet: CampaignDraftSet } | null>(
    null,
  );
  const calendarDragCandidateRef = useRef<CalendarDragCandidate | null>(null);
  const suppressContentSlotClickRef = useRef(false);
  const businessContextLoadRequestRef = useRef(0);

  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === activeBusinessId) ?? null,
    [activeBusinessId, businesses],
  );
  const activeBusinessGenerationProfile = useMemo(
    () => buildActiveBusinessGenerationProfile(activeBusiness, activeBusinessContext, businessProfile),
    [activeBusiness, activeBusinessContext, businessProfile],
  );

  const dismissToast = useCallback((toastId: string) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === toastId ? { ...toast, exiting: true } : toast)),
    );
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== toastId));
    }, toastExitAnimationMs);
  }, []);

  const pushToast = useCallback(
    ({
      durationMs = defaultToastDurationMs,
      message,
      title,
      type,
    }: {
      durationMs?: number;
      message: string;
      title?: string;
      type: ToastType;
    }) => {
      const toast: AppToast = {
        id: createToastId(),
        durationMs,
        message,
        title,
        type,
      };
      setToasts((current) => [...current, toast].slice(-5));
      return toast.id;
    },
    [],
  );

  const handlePublishTargetStateChange = useCallback(
    (targets: SocialTarget[], mappings: BusinessPublishTarget[]) => {
      setPublishSocialTargets(targets);
      setActiveBusinessPublishTargets(mappings);
      setLoadingPublishTargets(false);
      setPublishTargetsError(null);
    },
    [],
  );

  useEffect(() => {
    if (!error) return;
    pushToast({ message: error, title: 'Error', type: 'error' });
    setError(null);
  }, [error, pushToast]);

  useEffect(() => {
    if (!warning) return;
    pushToast({ message: warning, title: 'Notice', type: 'warning' });
    setWarning(null);
  }, [pushToast, warning]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      setJobs(await getJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load completed jobs.');
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      setQueue(await getContentQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load content queue.');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      setCampaigns(await getCampaigns());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load campaigns.');
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  const loadCampaignQueue = useCallback(async () => {
    setLoadingCampaignQueue(true);
    try {
      setCampaignQueue(await getCampaignContentQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load campaign content queue.');
    } finally {
      setLoadingCampaignQueue(false);
    }
  }, []);

  const loadWeeklyQueue = useCallback(async (weekStartDate = calendarWeekStartDate) => {
    setLoadingWeeklyQueue(true);
    try {
      const loadedQueue = await getWeeklySocialQueue(weekStartDate);
      setWeeklyQueue(loadedQueue);
      return loadedQueue;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load weekly posting queue.');
      return null;
    } finally {
      setLoadingWeeklyQueue(false);
    }
  }, [calendarWeekStartDate]);

  const loadPhotoAssets = useCallback(async () => {
    if (!activeBusinessId) {
      setPhotoAssets([]);
      return;
    }

    try {
      const loadedAssets = await listBusinessPhotoAssets(activeBusinessId);
      setPhotoAssets(loadedAssets.map(businessPhotoAssetToPhotoAsset));
    } catch (err) {
      setWarning(err instanceof Error ? `Photo Library metadata unavailable. ${err.message}` : 'Photo Library metadata unavailable.');
    }
  }, [activeBusinessId]);

  const loadBusinesses = useCallback(async () => {
    setLoadingBusinesses(true);
    try {
      const loadedBusinesses = await listBusinesses();
      setBusinesses(loadedBusinesses);
      setWarning((current) =>
        current?.startsWith('Business persistence unavailable') ? null : current,
      );
      return loadedBusinesses;
    } catch (err) {
      setBusinesses([]);
      setSavedGeneratedPosts([]);
      setWarning(
        err instanceof Error
          ? `Business persistence unavailable. ${err.message}`
          : 'Business persistence unavailable.',
      );
      return [];
    } finally {
      setLoadingBusinesses(false);
    }
  }, []);

  const loadSavedGeneratedPosts = useCallback(async (businessId: string) => {
    if (!businessId) {
      setSavedGeneratedPosts([]);
      return;
    }

    setLoadingSavedGeneratedPosts(true);
    try {
      setSavedGeneratedPosts(await listGeneratedPosts(businessId));
    } catch (err) {
      setSavedGeneratedPosts([]);
      setWarning(err instanceof Error ? `Saved generated posts unavailable. ${err.message}` : 'Saved generated posts unavailable.');
    } finally {
      setLoadingSavedGeneratedPosts(false);
    }
  }, []);

  const loadActiveBusinessContext = useCallback(async (businessId: string) => {
    const requestId = businessContextLoadRequestRef.current + 1;
    businessContextLoadRequestRef.current = requestId;

    if (!businessId) {
      setActiveBusinessContext(null);
      setBusinessContextDraft({ ...emptyBusinessContextDraft });
      setBusinessContextError(null);
      return;
    }

    setLoadingBusinessContext(true);
    setBusinessContextError(null);
    setActiveBusinessContext(null);
    setBusinessContextDraft({ ...emptyBusinessContextDraft });
    try {
      const context = await getBusinessContext(businessId);
      if (businessContextLoadRequestRef.current !== requestId) return;
      setActiveBusinessContext(context);
      setBusinessContextDraft(businessContextToDraft(context));
    } catch (err) {
      if (businessContextLoadRequestRef.current !== requestId) return;
      if (err instanceof ApiError && err.status === 404) {
        setActiveBusinessContext(null);
        setBusinessContextDraft({ ...emptyBusinessContextDraft });
      } else {
        setActiveBusinessContext(null);
        setBusinessContextDraft({ ...emptyBusinessContextDraft });
        setBusinessContextError(err instanceof Error ? err.message : 'Unable to load business context.');
      }
    } finally {
      if (businessContextLoadRequestRef.current === requestId) {
        setLoadingBusinessContext(false);
      }
    }
  }, []);

  const loadActiveBusinessPublishTargets = useCallback(async (businessId = activeBusinessId) => {
    if (!businessId) {
      setPublishSocialTargets([]);
      setActiveBusinessPublishTargets([]);
      setPublishTargetsError(null);
      setLoadingPublishTargets(false);
      return;
    }

    setLoadingPublishTargets(true);
    setPublishTargetsError(null);
    try {
      const [targets, mappings] = await Promise.all([
        listSocialTargets(),
        listBusinessPublishTargets(businessId),
      ]);
      setPublishSocialTargets(targets);
      setActiveBusinessPublishTargets(mappings);
    } catch (err) {
      setPublishSocialTargets([]);
      setActiveBusinessPublishTargets([]);
      setPublishTargetsError(err instanceof Error ? err.message : 'Unable to load publishing target status.');
    } finally {
      setLoadingPublishTargets(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    void loadBusinesses();
    void loadCampaigns();
    void loadWeeklyQueue();
  }, [loadBusinesses, loadCampaigns, loadWeeklyQueue]);

  useEffect(() => {
    if (activeBusinessId && businesses.some((business) => business.id === activeBusinessId)) return;
    const firstBusinessId = businesses[0]?.id ?? '';
    if (firstBusinessId !== activeBusinessId) {
      setActiveBusinessId(firstBusinessId);
    }
  }, [activeBusinessId, businesses]);

  useEffect(() => {
    setActiveBusinessProfileDraft(activeBusinessToProfileDraft(activeBusiness));
    setActiveBusinessProfileError(null);
  }, [activeBusiness]);

  useEffect(() => {
    storeActiveBusinessId(activeBusinessId);
    void loadSavedGeneratedPosts(activeBusinessId);
    void loadActiveBusinessContext(activeBusinessId);
    void loadActiveBusinessPublishTargets(activeBusinessId);
    void loadWeeklyQueue(calendarWeekStartDate);
    setSelectedContentSlotId(null);
    setPendingDeleteContentSlotId(null);
    setPhotoPickerContentSlotId(null);
  }, [
    activeBusinessId,
    calendarWeekStartDate,
    loadActiveBusinessContext,
    loadActiveBusinessPublishTargets,
    loadSavedGeneratedPosts,
    loadWeeklyQueue,
  ]);

  useEffect(() => {
    setVisibilityToolFormData((current) => ({
      ...current,
      photoAssetId: '',
      selectedPhotoAssetIds: [],
    }));
    void loadPhotoAssets();
  }, [activeBusinessId, loadPhotoAssets]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    storeEmojiPreference(emojiPreference);
  }, [emojiPreference]);

  useEffect(() => {
    if (activeSection !== 'jobs-queues') return;

    void loadJobs();
    void loadQueue();
    void loadCampaigns();
    void loadCampaignQueue();
  }, [activeSection, loadCampaignQueue, loadCampaigns, loadJobs, loadQueue]);

  useEffect(() => {
    if (!postAssistantItem) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePostAssistant();
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [postAssistantItem]);

  useEffect(() => {
    if (!selectedContentSlotId) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeContentSlot();
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedContentSlotId]);

  useEffect(() => {
    const mobileCalendarQuery = window.matchMedia('(max-width: 900px)');
    const syncMobileCalendar = () => setIsMobileCalendar(mobileCalendarQuery.matches);

    syncMobileCalendar();
    mobileCalendarQuery.addEventListener('change', syncMobileCalendar);
    return () => mobileCalendarQuery.removeEventListener('change', syncMobileCalendar);
  }, []);

  useEffect(() => {
    if (!calendarDrag) {
      document.body.classList.remove('calendar-drag-active');
      return undefined;
    }

    document.body.classList.add('calendar-drag-active');
    return () => document.body.classList.remove('calendar-drag-active');
  }, [calendarDrag]);

  useEffect(() => {
    if (!calendarDrag) return undefined;

    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelCalendarDrag();
      }
    };

    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [calendarDrag]);

  useEffect(() => {
    return () => {
      cancelCalendarDrag();
      clearBodyInteractionLocks();
    };
  }, []);

  const queueCounts = useMemo(() => {
    return queue.reduce(
      (counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );
  }, [queue]);

  const campaignQueueCounts = useMemo(() => {
    return campaignQueue.reduce(
      (counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );
  }, [campaignQueue]);

  const weeklyQueueItems = useMemo(() => {
    return weeklyQueue.filter((item) => campaignItemBelongsToActiveBusiness(item, activeBusiness)).sort((a, b) => {
      const scheduledCompare = getContentItemScheduledAt(a).localeCompare(getContentItemScheduledAt(b));
      if (scheduledCompare !== 0) return scheduledCompare;
      return campaignPlatformOrder[a.platform] - campaignPlatformOrder[b.platform];
    });
  }, [activeBusiness, weeklyQueue]);

  const activeWeeklyQueueItems = useMemo(() => {
    return weeklyQueueItems.filter((item) => item.status !== 'Posted' && item.status !== 'Skipped');
  }, [weeklyQueueItems]);

  const weeklyCampaignCalendars = useMemo(() => {
    return buildWeeklyCampaignCalendars(weeklyQueueItems);
  }, [weeklyQueueItems]);

  const weeklyContentSlots = useMemo(() => {
    return weeklyCampaignCalendars
      .flatMap((campaignCalendar) => campaignCalendar.contentSlots)
      .sort((a, b) => {
        const dayCompare = a.dayIndex - b.dayIndex;
        if (dayCompare !== 0) return dayCompare;
        const scheduledCompare = (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '');
        if (scheduledCompare !== 0) return scheduledCompare;
        return a.business.localeCompare(b.business);
      });
  }, [weeklyCampaignCalendars]);

  const weeklyCalendarDays = useMemo<WeeklyCalendarDay[]>(() => {
    return calendarDays.map((day, dayIndex) => ({
      ...day,
      contentSlots: weeklyContentSlots.filter((slot) => slot.dayIndex === dayIndex),
    }));
  }, [weeklyContentSlots]);

  const weeklyActionSummary = useMemo(() => {
    return buildWeeklyActionSummary(weeklyContentSlots);
  }, [weeklyContentSlots]);

  const selectedContentSlot = useMemo(() => {
    if (!selectedContentSlotId) return null;
    return weeklyContentSlots.find((slot) => slot.id === selectedContentSlotId) ?? null;
  }, [selectedContentSlotId, weeklyContentSlots]);

  const pendingDeleteContentSlot = useMemo(() => {
    if (!pendingDeleteContentSlotId) return null;
    return weeklyContentSlots.find((slot) => slot.id === pendingDeleteContentSlotId) ?? null;
  }, [pendingDeleteContentSlotId, weeklyContentSlots]);

  const photoPickerContentSlot = useMemo(() => {
    if (!photoPickerContentSlotId) return null;
    return weeklyContentSlots.find((slot) => slot.id === photoPickerContentSlotId) ?? null;
  }, [photoPickerContentSlotId, weeklyContentSlots]);

  const appModalOpen = Boolean(
    showWeeklyScheduleModal ||
      showManualPostModal ||
      selectedContentSlot ||
      pendingDeleteContentSlot ||
      photoPickerContentSlot ||
      postAssistantItem ||
      preview ||
      campaignPreview,
  );

  useBodyScrollLock(appModalOpen);

  useEffect(() => {
    if (appModalOpen || activeSection !== 'calendar') {
      cancelCalendarDrag();
    }
  }, [activeSection, appModalOpen]);

  const previousWeeklyPosts = useMemo(() => {
    return weeklyQueueItems.filter((item) => item.status === 'Posted' || item.status === 'Skipped');
  }, [weeklyQueueItems]);

  const queueGroups = useMemo<QueueGroup[]>(() => {
    const groups = new Map<string, ContentQueueItem[]>();

    for (const item of queue) {
      const currentItems = groups.get(item.job_id) ?? [];
      currentItems.push(item);
      groups.set(item.job_id, currentItems);
    }

    return Array.from(groups.entries())
      .map(([jobId, items]) => {
        const sortedItems = [...items].sort((a, b) => platformOrder[a.platform] - platformOrder[b.platform]);
        const latestCreatedAt = sortedItems.reduce((latest, item) => {
          return item.created_at > latest ? item.created_at : latest;
        }, '');
        const statusCounts = sortedItems.reduce(
          (counts, item) => {
            counts[item.status] = (counts[item.status] ?? 0) + 1;
            return counts;
          },
          {} as Record<string, number>,
        );

        return {
          jobId,
          items: sortedItems,
          latestCreatedAt,
          statusCounts,
        };
      })
      .sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
  }, [queue]);

  const campaignQueueGroups = useMemo<CampaignQueueGroup[]>(() => {
    const groups = new Map<string, CampaignContentQueueItem[]>();

    for (const item of campaignQueue) {
      const currentItems = groups.get(item.campaign_id) ?? [];
      currentItems.push(item);
      groups.set(item.campaign_id, currentItems);
    }

    return Array.from(groups.entries())
      .map(([campaignId, items]) => {
        const sortedItems = [...items].sort(
          (a, b) => campaignPlatformOrder[a.platform] - campaignPlatformOrder[b.platform],
        );
        const latestCreatedAt = sortedItems.reduce((latest, item) => {
          return item.created_at > latest ? item.created_at : latest;
        }, '');
        const statusCounts = sortedItems.reduce(
          (counts, item) => {
            counts[item.status] = (counts[item.status] ?? 0) + 1;
            return counts;
          },
          {} as Record<string, number>,
        );

        return {
          campaignId,
          items: sortedItems,
          latestCreatedAt,
          statusCounts,
        };
      })
      .sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
  }, [campaignQueue]);

  function refreshActiveSection() {
    if (activeSection === 'jobs-queues') {
      return Promise.all([loadJobs(), loadQueue(), loadCampaigns(), loadCampaignQueue()]);
    }
    if (activeSection === 'calendar') {
      return Promise.all([loadCampaigns(), loadWeeklyQueue(), loadPhotoAssets(), loadActiveBusinessPublishTargets(activeBusinessId)]);
    }
    if (activeSection === 'visibility-tools') {
      return Promise.all([
        loadCampaigns(),
        loadWeeklyQueue(),
        loadPhotoAssets(),
        loadBusinesses(),
        loadActiveBusinessPublishTargets(activeBusinessId),
        loadSavedGeneratedPosts(activeBusinessId),
        loadActiveBusinessContext(activeBusinessId),
      ]);
    }
    if (activeSection === 'business-profile') {
      return Promise.all([loadBusinesses(), loadActiveBusinessContext(activeBusinessId)]);
    }
    if (activeSection === 'photo-library') {
      return loadPhotoAssets();
    }
    return Promise.resolve();
  }

  function openVisibilityTool(toolId: VisibilityToolId) {
    if (toolId === selectedVisibilityToolId) return;
    setSelectedVisibilityToolId(toolId);
    setVisibilityToolFormData(createDefaultVisibilityToolFormData(toolId, businessProfile));
    setVisibilityToolOutput(null);
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);
  }

  function closeVisibilityTool() {
    setVisibilityToolFormData(createDefaultVisibilityToolFormData(selectedVisibilityToolId, businessProfile));
    setVisibilityToolOutput(null);
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);
    setVisibilityToolGenerating(false);
  }

  function updateVisibilityToolFormData(field: keyof VisibilityToolFormData, value: string | string[]) {
    setVisibilityToolFormData((current) => ({
      ...current,
      [field]: value,
    }));
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);
  }

  async function handleGenerateVisibilityTool(nextFormData: VisibilityToolFormData = visibilityToolFormData) {
    setVisibilityToolGenerating(true);
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);

    const selectedAsset =
      photoAssets.find((asset) => asset.id === nextFormData.photoAssetId) ?? null;
    const selectedAssets = photoAssets.filter((asset) =>
      nextFormData.selectedPhotoAssetIds.includes(asset.id),
    );

    try {
      const result = await generateVisibilityContent({
        toolType:
          selectedVisibilityToolId === 'local-reach-post' || selectedVisibilityToolId === 'recent-work-post'
            ? 'local_reach_post'
            : selectedVisibilityToolId === 'review-request'
              ? 'review_request'
              : 'business_intro_post',
        destination: nextFormData.destination,
        postType: nextFormData.postType,
        activeBusiness,
        businessContext: activeBusinessContext,
        businessProfile,
        serviceFocus: nextFormData.serviceFocus,
        location: nextFormData.location,
        goal: nextFormData.goal,
        tone: nextFormData.tone,
        cta: nextFormData.cta,
        notes: nextFormData.notes,
        customerName: nextFormData.customerName,
        jobCompleted: nextFormData.jobCompleted,
        reviewLink: nextFormData.reviewLink,
        servicesToMention: nextFormData.servicesToMention,
        businessBackground: nextFormData.businessBackground,
        offerDetails: nextFormData.offerDetails,
        customerPainPoint: nextFormData.customerPainPoint,
        trustSignals: nextFormData.trustSignals,
        contact: nextFormData.contact,
        photoAsset: selectedAsset ? photoAssetToVisibilityMetadata(selectedAsset) : null,
        photoAssets: selectedAssets.map(photoAssetToVisibilityMetadata),
        emojiPreference,
        outputFormat: 'structured',
      });
      setVisibilityToolOutput(result);
    } catch (err) {
      const generatedText = buildVisibilityToolOutput(
        selectedVisibilityToolId,
        nextFormData,
        businessProfile,
        activeBusiness,
        activeBusinessContext,
        selectedAsset,
        emojiPreference,
      );
      setVisibilityToolOutput(fallbackVisibilityResponseFromText(generatedText));
      setVisibilityToolError(
        err instanceof Error
          ? `Backend generation unavailable. Showing fallback output. ${err.message}`
          : 'Backend generation unavailable. Showing fallback output.',
      );
    } finally {
      setVisibilityToolGenerating(false);
    }
  }

  async function handleRefineVisibilityToolOutput(refinement: VisibilityRefinement) {
    if (!formatVisibilityResponseForCopy(visibilityToolOutput).trim()) {
      setVisibilityToolError('Generate an output before refining.');
      return;
    }

    const nextFormData: VisibilityToolFormData = {
      ...visibilityToolFormData,
      notes: appendVisibilityRefinementNote(
        visibilityToolFormData.notes,
        visibilityRefinementInstruction(refinement),
      ),
      tone:
        refinement === 'friendlier'
          ? 'Friendly neighbor'
          : refinement === 'professional'
            ? 'Professional'
            : visibilityToolFormData.tone,
      cta:
        refinement === 'stronger-cta' && !/call|message|estimate|quote|book/i.test(visibilityToolFormData.cta)
          ? 'Call or message today to request a free estimate'
          : visibilityToolFormData.cta,
    };

    setVisibilityToolFormData(nextFormData);
    await handleGenerateVisibilityTool(nextFormData);
  }

  async function handleCopyVisibilityToolOutput() {
    setVisibilityToolError(null);

    try {
      const copyText = formatVisibilityResponseForCopy(visibilityToolOutput);
      if (!copyText.trim()) {
        throw new Error('Generate an output before copying.');
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(copyText);
      setVisibilityToolCopied(true);
      window.setTimeout(() => setVisibilityToolCopied(false), 1800);
    } catch (err) {
      setVisibilityToolError(
        err instanceof Error && err.message
          ? `Unable to copy output. ${err.message}`
          : 'Unable to copy output. Check browser clipboard permissions and try again.',
      );
    }
  }

  async function handleCreateBusiness() {
    const name = businessCreateDraft.name.trim();
    if (!name) {
      setError('Business name is required.');
      return;
    }

    setCreatingBusiness(true);
    setError(null);
    try {
      const createdBusiness = await createBusiness({
        name,
        industry: businessCreateDraft.industry.trim() || null,
        location: businessCreateDraft.location.trim() || null,
      });
      setBusinesses((current) => [createdBusiness, ...current.filter((business) => business.id !== createdBusiness.id)]);
      setActiveBusinessId(createdBusiness.id);
      setBusinessCreateDraft(defaultBusinessCreateDraft);
      pushToast({ message: `Active business set to ${createdBusiness.name}.`, title: 'Business created', type: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create business.');
    } finally {
      setCreatingBusiness(false);
    }
  }

  async function handleSaveActiveBusinessProfile() {
    if (!activeBusinessId || !activeBusiness) {
      setActiveBusinessProfileError('Select or create an active business before saving business details.');
      return;
    }

    const payload = activeBusinessProfileDraftToPayload(activeBusinessProfileDraft);
    if (!payload.name) {
      setActiveBusinessProfileError('Business name is required.');
      return;
    }

    setSavingActiveBusinessProfile(true);
    setActiveBusinessProfileError(null);
    try {
      const updatedBusiness = await updateBusiness(activeBusinessId, payload);
      setBusinesses((current) =>
        current.map((business) => (business.id === updatedBusiness.id ? updatedBusiness : business)),
      );
      pushToast({ message: `Business profile saved for ${updatedBusiness.name}.`, title: 'Business saved', type: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save active business profile.';
      setActiveBusinessProfileError(message);
      pushToast({ message, title: 'Business save failed', type: 'error' });
    } finally {
      setSavingActiveBusinessProfile(false);
    }
  }

  function handleCancelActiveBusinessProfileEdits() {
    setActiveBusinessProfileDraft(activeBusinessToProfileDraft(activeBusiness));
    setActiveBusinessProfileError(null);
  }

  async function handleSaveBusinessContext() {
    if (!activeBusinessId) {
      setBusinessContextError('Select or create an active business before saving context.');
      return;
    }

    setSavingBusinessContext(true);
    setBusinessContextError(null);
    try {
      const savedContext = await upsertBusinessContext(
        activeBusinessId,
        businessContextDraftToPayload(businessContextDraft),
      );
      setActiveBusinessContext(savedContext);
      setBusinessContextDraft(businessContextToDraft(savedContext));
      pushToast({ message: `Business context saved for ${activeBusiness?.name ?? 'active business'}.`, title: 'Context saved', type: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save business context.';
      setBusinessContextError(message);
      pushToast({ message, title: 'Context save failed', type: 'error' });
    } finally {
      setSavingBusinessContext(false);
    }
  }

  async function handleSaveVisibilityToolOutput() {
    const toolType = visibilityToolTypeForPost(selectedVisibilityToolId);
    if (!toolType) {
      setVisibilityToolError('Only Reach, Review, and Intro outputs can be saved in this step.');
      return;
    }
    if (!activeBusinessId) {
      setVisibilityToolError('Select or create an active business before saving generated posts.');
      return;
    }

    const content = visibilityToolOutput?.primary?.trim() || formatVisibilityResponseForCopy(visibilityToolOutput).trim();
    if (!content) {
      setVisibilityToolError('Generate an output before saving.');
      return;
    }

    const selectedAsset =
      photoAssets.find((asset) => asset.id === visibilityToolFormData.photoAssetId) ?? null;
    const selectedAssets = photoAssets.filter((asset) =>
      visibilityToolFormData.selectedPhotoAssetIds.includes(asset.id),
    );
    const payload: GeneratedPostPayload = {
      tool_type: toolType,
      platform: visibilityPlatformForPost(selectedVisibilityToolId, visibilityToolFormData),
      title: visibilityGeneratedPostTitle(selectedVisibilityToolId, visibilityToolFormData),
      content,
      status: 'saved',
      metadata: {
        source: 'visibility-tools',
        selected_tool_id: selectedVisibilityToolId,
        form_inputs: visibilityToolFormData,
        output: visibilityToolOutput,
        active_business: activeBusiness,
        business_profile: businessProfile,
        business_context: activeBusinessContext,
        emoji_preference: emojiPreference,
        photo_asset: selectedAsset ? photoAssetToVisibilityMetadata(selectedAsset) : null,
        photo_assets: selectedAssets.map(photoAssetToVisibilityMetadata),
      },
    };

    setVisibilityToolSaving(true);
    setVisibilityToolError(null);
    try {
      const savedPost = await createGeneratedPost(activeBusinessId, payload);
      setSavedGeneratedPosts((current) => [savedPost, ...current.filter((post) => post.id !== savedPost.id)]);
      pushToast({
        message: `Saved ${generatedPostToolLabel(savedPost.tool_type)} post to ${activeBusiness?.name ?? 'active business'}.`,
        title: 'Post saved',
        type: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? `Unable to save generated post. ${err.message}` : 'Unable to save generated post.';
      setVisibilityToolError(message);
      pushToast({ message, title: 'Post save failed', type: 'error' });
    } finally {
      setVisibilityToolSaving(false);
    }
  }

  function openWeeklyScheduleModal() {
    const scheduleProfile = activeBusinessGenerationProfile ?? businessProfile;
    const profilePlatforms = weeklyPlatformsFromBusinessProfile(scheduleProfile);
    setWeeklyScheduleSettings((current) => ({
      ...current,
      platforms: profilePlatforms.length > 0 ? profilePlatforms : current.platforms,
      campaignTheme:
        current.campaignTheme === defaultWeeklyCampaignTheme || !current.campaignTheme.trim()
          ? weeklyCampaignThemeFromBusinessProfile(scheduleProfile)
          : current.campaignTheme,
    }));
    setShowWeeklyScheduleModal(true);
  }

  function openManualPostModal() {
    const scheduleProfile = activeBusinessGenerationProfile ?? businessProfile;
    const profilePlatforms = weeklyPlatformsFromBusinessProfile(scheduleProfile);
    setManualPostSettings((current) => ({
      ...current,
      campaignId: selectedCampaignId,
      platforms: profilePlatforms.length > 0 ? profilePlatforms : current.platforms,
      scheduledDate: current.scheduledDate || formatDateInputValue(new Date()),
      contentType: current.contentType || weeklyScheduleContentTypeOptions[0] || 'General',
    }));
    setShowManualPostModal(true);
  }

  async function handlePreview(job: CompletedJob) {
    if (!job.job_id) return;
    const actionKey = `preview:${job.job_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      const draft = await previewDraft(job.job_id);
      setPreview({ job, draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview draft.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateAndSave(job: CompletedJob) {
    if (!job.job_id) return;
    const actionKey = `save:${job.job_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await generateAndSave(job.job_id);
      await loadQueue();
      setExpandedQueueJobs((current) => ({ ...current, [job.job_id as string]: true }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setWarning('Drafts already exist for this job. Review them in Content Queue instead of generating duplicates.');
        await loadQueue();
        setExpandedQueueJobs((current) => ({ ...current, [job.job_id as string]: true }));
      } else {
        setError(err instanceof Error ? err.message : 'Unable to generate and save drafts.');
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCampaignPreview(campaign: Campaign) {
    const actionKey = `campaign-preview:${campaign.campaign_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      const draftSet = await previewCampaignDrafts(campaign.campaign_id);
      setCampaignPreview({ campaign, draftSet });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview campaign drafts.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateAndSaveCampaign(campaign: Campaign) {
    const actionKey = `campaign-save:${campaign.campaign_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await generateAndSaveCampaign(campaign.campaign_id);
      await loadCampaignQueue();
      setExpandedCampaignQueue((current) => ({ ...current, [campaign.campaign_id]: true }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setWarning(
          'Campaign drafts already exist. Review them in Campaign Content Queue instead of generating duplicates.',
        );
        await loadCampaignQueue();
        setExpandedCampaignQueue((current) => ({ ...current, [campaign.campaign_id]: true }));
      } else {
        setError(err instanceof Error ? err.message : 'Unable to generate and save campaign drafts.');
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateWeeklyPosts(settings: WeeklyScheduleSettings) {
    if (!activeBusinessId || !activeBusinessGenerationProfile) {
      setError('Select or create an active business before generating calendar posts.');
      return;
    }
    if (settings.platforms.length === 0) {
      setError('Choose at least one platform for the weekly schedule.');
      return;
    }
    if (settings.contentTypes.length === 0) {
      setError('Choose at least one content type for the weekly schedule.');
      return;
    }
    if (!settings.weekStartDate) {
      setError('Choose a week start date for the weekly schedule.');
      return;
    }

    setBusyAction('generate-weekly-posts');
    setError(null);
    setWarning(null);
    const hadWeeklyPosts = activeWeeklyQueueItems.length > 0;
    const campaignTheme = settings.campaignTheme.trim() || defaultWeeklyCampaignTheme;
    try {
      const result = await generateWeeklySocialPosts({
        campaign_id: null,
        business_id: activeBusinessId,
        platforms: settings.platforms,
        posts_per_platform: settings.contentDays,
        content_days: settings.contentDays,
        week_start_date: settings.weekStartDate,
        content_types: settings.contentTypes,
        campaign_theme: campaignTheme,
        separate_meta_platforms: true,
        business_profile: activeBusinessGenerationProfile,
        emoji_preference: emojiPreference,
      });
      setCalendarWeekStartDate(settings.weekStartDate);
      await Promise.all([loadWeeklyQueue(settings.weekStartDate), loadCampaignQueue(), loadPhotoAssets()]);
      setShowWeeklyScheduleModal(false);
      pushToast({
        message: result.existing
          ? 'This weekly schedule already has all selected slots. Showing the existing queue.'
          : hadWeeklyPosts
            ? 'Generated missing scheduled posts for this week.'
            : 'Generated scheduled posts for this week.',
        title: result.existing ? 'Schedule already complete' : 'Weekly plan generated',
        type: result.existing ? 'info' : 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate weekly posts.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateManualPost(settings: ManualPostSettings) {
    if (!activeBusinessId || !activeBusinessGenerationProfile) {
      setError('Select or create an active business before generating calendar posts.');
      return;
    }
    if (!settings.scheduledDate) {
      setError('Choose a date for the post.');
      return;
    }
    if (settings.platforms.length === 0) {
      setError('Choose at least one platform for the post.');
      return;
    }
    if (!settings.contentType.trim()) {
      setError('Choose a content type for the post.');
      return;
    }

    const scheduledAt = dateInputToScheduledAt(settings.scheduledDate);
    if (!scheduledAt) {
      setError('Choose a valid post date.');
      return;
    }

    const requestPlatforms = manualPostRequestPlatforms(settings.platforms);
    if (requestPlatforms.length === 0) {
      setError('Choose at least one supported platform for the post.');
      return;
    }

    setBusyAction('generate-manual-post');
    setError(null);
    setWarning(null);
    try {
      const postType = settings.title.trim()
        ? `${settings.contentType.trim()}: ${settings.title.trim()}`
        : settings.contentType.trim();
      const results = await Promise.all(
        requestPlatforms.map((platform) =>
          generateManualSocialPost({
            campaign_id: null,
            business_id: activeBusinessId,
            platform,
            post_type: postType,
            business_profile: activeBusinessGenerationProfile,
            emoji_preference: emojiPreference,
          }),
        ),
      );
      const generatedItems = results.flatMap((result) => result.queue_items);
      await Promise.all(generatedItems.map((item) => updatePostScheduledAt(item.content_id, scheduledAt)));
      const targetWeekStart = getCalendarWeekStartDateForDateInput(settings.scheduledDate);
      setSelectedCampaignId(settings.campaignId);
      setCalendarWeekStartDate(targetWeekStart);
      await Promise.all([loadWeeklyQueue(targetWeekStart), loadCampaignQueue(), loadPhotoAssets()]);
      setShowManualPostModal(false);
      pushToast({
        message: `Generated ${generatedItems.length} post${generatedItems.length === 1 ? '' : 's'} for ${settings.scheduledDate}.`,
        title: 'Post generated',
        type: 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate a post.');
    } finally {
      setBusyAction(null);
    }
  }

  function toggleQueueGroup(jobId: string) {
    setExpandedQueueJobs((current) => ({
      ...current,
      [jobId]: !(current[jobId] ?? false),
    }));
  }

  function toggleCampaignQueueGroup(campaignId: string) {
    setExpandedCampaignQueue((current) => ({
      ...current,
      [campaignId]: !(current[campaignId] ?? false),
    }));
  }

  async function handleQueueAction(contentId: string, action: 'approve' | 'reject' | 'published') {
    const actionKey = `${action}:${contentId}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      if (action === 'approve') {
        await approveContent(contentId);
      } else if (action === 'reject') {
        await rejectContent(contentId);
      } else {
        await markPublished(contentId);
      }
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update content queue item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCampaignQueueAction(contentId: string, action: 'approve' | 'reject' | 'published') {
    const actionKey = `campaign-${action}:${contentId}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      if (action === 'approve') {
        await approveCampaignContent(contentId);
      } else if (action === 'reject') {
        await rejectCampaignContent(contentId);
      } else {
        await markCampaignPublished(contentId);
      }
      await loadCampaignQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update campaign content queue item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyCampaignPackage(item: CampaignContentQueueItem) {
    setError(null);
    setWarning(null);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(formatCampaignCopyPackage(item));
      setCopiedPackageId(item.content_id);
      window.setTimeout(() => {
        setCopiedPackageId((current) => (current === item.content_id ? null : current));
      }, 1800);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Unable to copy package to clipboard. ${err.message}`
          : 'Unable to copy package to clipboard. Check browser clipboard permissions and try again.',
      );
    }
  }

  async function handleCopyWeeklyPost(item: CampaignContentQueueItem) {
    const actionKey = `weekly-copy:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(formatWeeklyPostPackage(item));
      await markCampaignCopied(item.content_id);
      setCopiedPackageId(`weekly:${item.content_id}`);
      window.setTimeout(() => {
        setCopiedPackageId((current) => (current === `weekly:${item.content_id}` ? null : current));
      }, 1800);
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Unable to copy post. ${err.message}`
          : 'Unable to copy post. Check browser clipboard permissions and try again.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function updateWeeklyStatus(contentId: string, action: 'posted' | 'skipped') {
    if (action === 'posted') {
      await markCampaignPosted(contentId);
    } else {
      await markCampaignSkipped(contentId);
    }
    await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
  }

  async function handleWeeklyStatusAction(contentId: string, action: 'posted' | 'skipped') {
    const actionKey = `weekly-${action}:${contentId}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await updateWeeklyStatus(contentId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update weekly post.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApproveWeeklyPost(item: CampaignContentQueueItem) {
    const actionKey = `weekly-approve:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await approveCampaignContent(item.content_id);
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve weekly post.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegeneratePlatformPost(post: PlatformPost) {
    const actionKey = `weekly-regenerate:${post.id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      // TODO: Replace this additive generation call with a slot-aware regenerate endpoint that updates one PlatformPost.
      const result = await generateManualSocialPost({
        campaign_id: post.item.campaign_id.startsWith('BUSINESS-PROFILE') ? null : post.item.campaign_id,
        business_id: activeBusinessId || null,
        platform: post.sourcePlatform,
        post_type: getContentItemType(post.item),
        business_profile: activeBusinessGenerationProfile ?? businessProfile,
        emoji_preference: emojiPreference,
      });
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
      pushToast({
        message: `Generated ${result.queue_items.length} new draft candidate. Review it before posting.`,
        title: 'Draft generated',
        type: 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to regenerate weekly post.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreWeeklyPost(contentId: string) {
    const actionKey = `weekly-restore:${contentId}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await restorePostToQueue(contentId);
      await loadWeeklyQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to restore post to the queue.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteWeeklyPost(item: CampaignContentQueueItem) {
    const confirmed = window.confirm(
      [
        `Delete this ${formatPlatformLabel(item.platform)} post permanently?`,
        '',
        `Content ID: ${item.content_id}`,
        'This removes the row from the Posts sheet and cannot be undone.',
      ].join('\n'),
    );
    if (!confirmed) return;

    const actionKey = `weekly-delete:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await deletePost(item.content_id);
      await loadWeeklyQueue();
      setWarning('Post deleted from the queue.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete post.');
    } finally {
      setBusyAction(null);
    }
  }

  async function moveContentSlotToDay(slot: ContentSlot, targetDayIndex: number) {
    if (slot.dayIndex === targetDayIndex) return;

    const scheduledAt = recalculateScheduledAtForWeekday(slot, targetDayIndex, calendarWeekStartDate);
    if (!scheduledAt) {
      setError('Unable to calculate the target scheduled date.');
      return;
    }

    const previousWeeklyQueue = weeklyQueue;
    const contentIds = new Set(slot.sourceItems.map((item) => item.content_id));
    const targetDayLabel = calendarDays[targetDayIndex]?.label ?? 'the selected day';
    const optimisticWeeklyQueue = moveContentSlotItemsToDay(weeklyQueue, contentIds, scheduledAt);

    setError(null);
    setWarning(null);
    setWeeklyQueue((current) => moveContentSlotItemsToDay(current, contentIds, scheduledAt));

    try {
      // TODO: Replace per-platform post schedule updates with a backend ContentSlot move endpoint.
      const updatedItems = await Promise.all(slot.sourceItems.map((item) => updatePostScheduledAt(item.content_id, scheduledAt)));
      const returnedMismatch = findMoveTargetMismatch(updatedItems, contentIds, targetDayIndex, calendarWeekStartDate);
      if (returnedMismatch) {
        throw new Error(
          `Post ${returnedMismatch.content_id} saved outside ${targetDayLabel}. Backend returned scheduled_at ${getContentItemScheduledAt(
            returnedMismatch,
          )}.`,
        );
      }

      const refreshedQueue = await loadWeeklyQueue(calendarWeekStartDate);
      if (!refreshedQueue) {
        setWeeklyQueue(optimisticWeeklyQueue);
        setWarning(`Moved "${slot.title}" to ${targetDayLabel} (${formatDisplayDate(scheduledAt)}).`);
        return;
      }

      const missingContentIds = getMissingContentIds(refreshedQueue, contentIds);
      const refreshedMismatch = findMoveTargetMismatch(refreshedQueue, contentIds, targetDayIndex, calendarWeekStartDate);
      if (missingContentIds.length > 0 || refreshedMismatch) {
        setWeeklyQueue(optimisticWeeklyQueue);
        const detail = missingContentIds.length > 0
          ? `Missing after refetch: ${missingContentIds.join(', ')}.`
          : `Refetched scheduled_at: ${refreshedMismatch ? getContentItemScheduledAt(refreshedMismatch) : 'unknown'}.`;
        setError(`Move was saved, but the refreshed weekly queue did not keep the post on ${targetDayLabel}. ${detail}`);
        return;
      }

      const confirmedItem = refreshedQueue.find((item) => contentIds.has(item.content_id)) ?? updatedItems[0];
      const confirmedScheduledAt = getContentItemScheduledAt(confirmedItem);
      setWarning(`Moved "${slot.title}" to ${targetDayLabel} (${formatDisplayDate(confirmedScheduledAt)}).`);
    } catch (err) {
      setWeeklyQueue(previousWeeklyQueue);
      setError(err instanceof Error ? err.message : 'Unable to move content slot.');
    }
  }

  function openPhotoPicker(slot: ContentSlot) {
    setPhotoPickerContentSlotId(slot.id);
    setError(null);
    setWarning(null);
    void loadPhotoAssets();
  }

  async function handleSelectPhotoAssetForSlot(slot: ContentSlot, asset: PhotoAsset) {
    const imagePayload = photoAssetImageUpdatePayload(asset);
    if (!imagePayload) {
      setError('This Photo Library asset does not have a usable image.');
      return;
    }

    const previousWeeklyQueue = weeklyQueue;
    const contentIds = new Set(slot.sourceItems.map((item) => item.content_id));
    const actionKey = `change-photo:${slot.id}`;

    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    setWeeklyQueue((current) => updateContentSlotItemsImage(current, contentIds, imagePayload));
    setPostAssistantItem((current) => (current && contentIds.has(current.content_id) ? { ...current, ...imagePayload } : current));

    try {
      await Promise.all(slot.sourceItems.map((item) => updatePostImage(item.content_id, imagePayload)));
      await loadWeeklyQueue(calendarWeekStartDate);
      setPhotoPickerContentSlotId(null);
      setWarning(`Changed "${slot.title}" to Photo Library asset "${asset.title}".`);
    } catch (err) {
      setWeeklyQueue(previousWeeklyQueue);
      setPostAssistantItem((current) => {
        if (!current || !contentIds.has(current.content_id)) return current;
        const previousItem = previousWeeklyQueue.find((item) => item.content_id === current.content_id);
        return previousItem ?? current;
      });
      setError(err instanceof Error ? err.message : 'Unable to change the content slot photo.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmDeleteContentSlot() {
    const slot = pendingDeleteContentSlot;
    if (!slot) {
      setPendingDeleteContentSlotId(null);
      return;
    }

    const previousWeeklyQueue = weeklyQueue;
    const contentIds = new Set(slot.sourceItems.map((item) => item.content_id));

    setPendingDeleteContentSlotId(null);
    setError(null);
    setWarning(null);
    setWeeklyQueue((current) => deleteContentSlotItems(current, contentIds));

    try {
      await Promise.all(slot.sourceItems.map((item) => deletePost(item.content_id)));
      await loadWeeklyQueue();
      setWarning('Content slot deleted from the weekly calendar.');
    } catch (err) {
      setWeeklyQueue(previousWeeklyQueue);
      setError(err instanceof Error ? err.message : 'Unable to delete content slot.');
    }
  }

  function startEditingDraft(item: CampaignContentQueueItem) {
    setEditingDraftId(item.content_id);
    setDraftTextEdits((current) => ({
      ...current,
      [item.content_id]: current[item.content_id] ?? item.draft_text,
    }));
  }

  function cancelEditingDraft(contentId: string) {
    setEditingDraftId(null);
    setDraftTextEdits((current) => {
      const next = { ...current };
      delete next[contentId];
      return next;
    });
  }

  async function handleSaveDraftText(item: CampaignContentQueueItem) {
    const draftText = (draftTextEdits[item.content_id] ?? '').trim();
    if (!draftText) {
      setError('Draft text cannot be empty.');
      return;
    }

    const actionKey = `weekly-save-draft:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    try {
      await updatePostDraftText(item.content_id, draftText);
      setEditingDraftId(null);
      setDraftTextEdits((current) => {
        const next = { ...current };
        delete next[item.content_id];
        return next;
      });
      await loadWeeklyQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save draft text.');
    } finally {
      setBusyAction(null);
    }
  }

  async function shareOrSaveImage(item: CampaignContentQueueItem): Promise<void> {
    const imageSource = getCampaignItemImageSource(item);
    if (!imageSource) {
      const message = 'No image is attached to this post.';
      setPostAssistantError(message);
      setError(message);
      return;
    }

    setError(null);
    setPostAssistantError(null);
    const filename = getCampaignItemImageFilename(item);
    const imageUrl = getMediaUrl(imageSource);

    let blob: Blob;
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      blob = await response.blob();
    } catch {
      const message = 'Unable to share or download this image. Try opening the image manually.';
      setPostAssistantError(message);
      setError(message);
      return;
    }

    const file =
      typeof File !== 'undefined'
        ? new File([blob], filename, {
            type: blob.type || 'application/octet-stream',
          })
        : null;

    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: getCampaignItemBusiness(item),
          text: item.draft_text,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      downloadBlob(blob, filename);
    } catch {
      const message = 'Unable to share or download this image. Try opening the image manually.';
      setPostAssistantError(message);
      setError(message);
    }
  }

  function openPostAssistant(item: CampaignContentQueueItem) {
    setPostAssistantItem(item);
    setPostAssistantCopiedAction(null);
    setPostAssistantError(null);
    setError(null);
    setWarning(null);
  }

  function detectCalendarDropTarget(clientX: number, clientY: number): CalendarDropTarget {
    const element = document.elementFromPoint(clientX, clientY);
    if (!(element instanceof Element)) {
      return { dayIndex: null, overTrash: false, dayElement: null };
    }

    const overTrash = Boolean(element.closest('[data-calendar-trash-zone="true"]'));
    const dayElement = element.closest('[data-calendar-day-index]') as HTMLDetailsElement | null;
    const rawDayIndex = dayElement?.dataset.calendarDayIndex;
    const parsedDayIndex = rawDayIndex === undefined ? null : Number.parseInt(rawDayIndex, 10);
    const dayIndex = parsedDayIndex !== null && Number.isFinite(parsedDayIndex) ? parsedDayIndex : null;

    if (isMobileCalendar && dayElement instanceof HTMLDetailsElement) {
      dayElement.open = true;
    }

    return {
      dayIndex,
      overTrash,
      dayElement,
    };
  }

  function maybeAutoScrollCalendar(clientY: number) {
    const edgeSize = 76;
    const scrollStep = 18;

    if (clientY < edgeSize) {
      window.scrollBy({ top: -scrollStep, behavior: 'auto' });
    } else if (window.innerHeight - clientY < edgeSize) {
      window.scrollBy({ top: scrollStep, behavior: 'auto' });
    }
  }

  function updateCalendarDragTarget(clientX: number, clientY: number) {
    const target = detectCalendarDropTarget(clientX, clientY);
    maybeAutoScrollCalendar(clientY);

    setCalendarDrag((current) =>
      current
        ? {
            ...current,
            currentX: clientX,
            currentY: clientY,
            overDayIndex: target.overTrash ? null : target.dayIndex,
            overTrash: target.overTrash,
          }
        : current,
    );

    return target;
  }

  function releaseCalendarDragPointerCapture(candidate: CalendarDragCandidate) {
    try {
      if (candidate.handleElement.hasPointerCapture(candidate.pointerId)) {
        candidate.handleElement.releasePointerCapture(candidate.pointerId);
      }
    } catch {
      // Pointer capture can already be gone if the source element was unmounted.
    }
  }

  function clearCalendarDragCandidate() {
    const candidate = calendarDragCandidateRef.current;
    if (!candidate) return;

    if (candidate.longPressTimerId !== null) {
      window.clearTimeout(candidate.longPressTimerId);
    }
    releaseCalendarDragPointerCapture(candidate);
    calendarDragCandidateRef.current = null;
  }

  function cancelCalendarDrag() {
    clearCalendarDragCandidate();
    setCalendarDrag(null);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('calendar-drag-active');
    }
  }

  function startCalendarDrag(candidate: CalendarDragCandidate, clientX: number, clientY: number) {
    if (appModalOpen || activeSection !== 'calendar' || busyAction) {
      cancelCalendarDrag();
      return false;
    }

    if (candidate.longPressTimerId !== null) {
      window.clearTimeout(candidate.longPressTimerId);
      candidate.longPressTimerId = null;
    }
    candidate.phase = 'dragging';

    try {
      if (!candidate.handleElement.hasPointerCapture(candidate.pointerId)) {
        candidate.handleElement.setPointerCapture(candidate.pointerId);
      }
    } catch {
      // Pointer capture is a convenience here; the drag still cleans up without it.
    }

    suppressContentSlotClickRef.current = true;
    const target = detectCalendarDropTarget(clientX, clientY);
    setCalendarDrag({
      phase: 'dragging',
      slotId: candidate.slotId,
      originDayIndex: candidate.originDayIndex,
      pointerType: candidate.pointerType,
      currentX: clientX,
      currentY: clientY,
      grabOffsetX: candidate.grabOffsetX,
      grabOffsetY: candidate.grabOffsetY,
      sourceWidth: candidate.sourceWidth,
      sourceHeight: candidate.sourceHeight,
      overDayIndex: target.overTrash ? null : target.dayIndex,
      overTrash: target.overTrash,
    });
    return true;
  }

  function handleContentSlotDragHandlePointerDown(event: ReactPointerEvent<HTMLElement>, slot: ContentSlot) {
    if (!event.isPrimary || event.button !== 0 || busyAction || calendarDrag || appModalOpen || activeSection !== 'calendar') {
      return;
    }

    const targetElement = event.target instanceof Element ? event.target : null;
    if (targetElement && isInteractiveElement(targetElement) && !targetElement.closest('[data-calendar-drag-handle="true"]')) {
      return;
    }

    const sourceCard = event.currentTarget.closest('[data-content-slot-card="true"]');
    if (!(sourceCard instanceof HTMLElement)) return;

    event.stopPropagation();

    const sourceRect = sourceCard.getBoundingClientRect();
    const handleElement = event.currentTarget;
    const longPressTimerId =
      event.pointerType === 'touch' || event.pointerType === 'pen'
        ? window.setTimeout(() => {
            const pendingCandidate = calendarDragCandidateRef.current;
            if (!pendingCandidate || pendingCandidate.pointerId !== event.pointerId || pendingCandidate.phase !== 'pending') {
              return;
            }
            startCalendarDrag(pendingCandidate, pendingCandidate.startX, pendingCandidate.startY);
          }, 220)
        : null;

    calendarDragCandidateRef.current = {
      phase: 'pending',
      slotId: slot.id,
      originDayIndex: slot.dayIndex,
      handleElement,
      longPressTimerId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - sourceRect.left,
      grabOffsetY: event.clientY - sourceRect.top,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
    };
  }

  function handleContentSlotDragHandlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const candidate = calendarDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    event.stopPropagation();

    const deltaX = event.clientX - candidate.startX;
    const deltaY = event.clientY - candidate.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const movement = Math.hypot(deltaX, deltaY);
    const dragThreshold = event.pointerType === 'mouse' ? 8 : 11;

    if (candidate.phase === 'pending') {
      if (event.pointerType !== 'mouse' && absY > 10 && absY > absX * 1.35) {
        clearCalendarDragCandidate();
        return;
      }
      if (movement < dragThreshold) return;

      if (!startCalendarDrag(candidate, event.clientX, event.clientY)) return;
      event.preventDefault();
      return;
    }

    event.preventDefault();
    suppressContentSlotClickRef.current = true;
    updateCalendarDragTarget(event.clientX, event.clientY);
  }

  function handleContentSlotDragHandlePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const candidate = calendarDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    event.stopPropagation();

    const wasDragging = candidate.phase === 'dragging';
    const canceled = event.type === 'pointercancel';
    const target = wasDragging && !canceled ? detectCalendarDropTarget(event.clientX, event.clientY) : null;
    const activeSlotId = candidate.slotId;

    clearCalendarDragCandidate();

    if (!wasDragging) return;

    event.preventDefault();
    suppressContentSlotClickRef.current = true;
    window.setTimeout(() => {
      suppressContentSlotClickRef.current = false;
    }, 0);
    setCalendarDrag(null);
    if (canceled) return;

    const activeSlot = weeklyContentSlots.find((slot) => slot.id === activeSlotId);
    if (!activeSlot) return;

    if (target?.overTrash) {
      setPendingDeleteContentSlotId(activeSlot.id);
      return;
    }

    if (target?.dayIndex !== null && target?.dayIndex !== undefined) {
      void moveContentSlotToDay(activeSlot, target.dayIndex);
    }
  }

  function handleContentSlotDragHandleClick(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    const candidate = calendarDragCandidateRef.current;
    if (candidate?.phase === 'pending') {
      clearCalendarDragCandidate();
    }
  }

  function handleContentSlotClick(event: ReactMouseEvent<HTMLButtonElement>, slot: ContentSlot) {
    if (suppressContentSlotClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressContentSlotClickRef.current = false;
      return;
    }

    openContentSlot(slot);
  }

  function openContentSlot(slot: ContentSlot) {
    setSelectedContentSlotId(slot.id);
    setPostAssistantError(null);
    setError(null);
    setWarning(null);
  }

  function closeContentSlot() {
    setSelectedContentSlotId(null);
    setEditingDraftId(null);
  }

  function closePostAssistant() {
    setPostAssistantItem(null);
    setPostAssistantCopiedAction(null);
    setPostAssistantError(null);
  }

  async function copyPostAssistantCaption(item: CampaignContentQueueItem) {
    setError(null);
    setWarning(null);
    setPostAssistantError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(item.draft_text);
      setPostAssistantCopiedAction('caption');
      window.setTimeout(() => {
        setPostAssistantCopiedAction((current) => (current === 'caption' ? null : current));
      }, 1800);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? `Unable to copy caption. ${err.message}`
          : 'Unable to copy caption. Check browser clipboard permissions and try again.';
      setPostAssistantError(message);
      setError(message);
    }
  }

  async function handlePostAssistantShareImage(item: CampaignContentQueueItem) {
    if (!getCampaignItemImageSource(item)) {
      const message = 'No image is attached to this post.';
      setPostAssistantError(message);
      setError(message);
      return;
    }

    setPostAssistantError(null);
    await shareOrSaveImage(item);
  }

  function handleOpenMetaBusinessSuite() {
    setError(null);
    setPostAssistantError(null);
    const openedWindow = openMetaBusinessSuite();
    if (!openedWindow) {
      const message = 'Unable to open Meta Business Suite. Please open it manually.';
      setPostAssistantError(message);
      setError(message);
    }
  }

  async function handlePostAssistantStatusAction(item: CampaignContentQueueItem, action: 'posted' | 'skipped') {
    const actionKey = `assistant-${action}:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);
    setPostAssistantError(null);
    try {
      await updateWeeklyStatus(item.content_id, action);
      closePostAssistant();
      setWarning(action === 'posted' ? 'Post marked as posted.' : 'Post skipped.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update weekly post.';
      setPostAssistantError(message);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyMetaPackage(item: CampaignContentQueueItem) {
    setError(null);
    setWarning(null);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(formatMetaBusinessSuitePackage(item));
      setCopiedPackageId(`meta:${item.content_id}`);
      window.setTimeout(() => {
        setCopiedPackageId((current) => (current === `meta:${item.content_id}` ? null : current));
      }, 1800);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Unable to copy Meta package to clipboard. ${err.message}`
          : 'Unable to copy Meta package to clipboard. Check browser clipboard permissions and try again.',
      );
    }
  }

  async function handlePublishCampaignContent(item: CampaignContentQueueItem) {
    const actionKey = `campaign-publish:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);

    try {
      await publishCampaignContent(item.content_id);
      await loadCampaignQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to publish campaign content.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleScheduleCampaignContent(item: CampaignContentQueueItem) {
    const scheduledAtInput = scheduleInputs[item.content_id] ?? toDatetimeLocalValue(item.scheduled_at);
    const scheduledAt = datetimeLocalToIso(scheduledAtInput);
    if (!scheduledAt) {
      setError('Choose a valid scheduled publishing date and time.');
      return;
    }

    const actionKey = `campaign-schedule:${item.content_id}`;
    setBusyAction(actionKey);
    setError(null);
    setWarning(null);

    try {
      await scheduleCampaignContent(item.content_id, scheduledAt);
      setScheduleInputs((current) => {
        const next = { ...current };
        delete next[item.content_id];
        return next;
      });
      await loadCampaignQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to schedule campaign content.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRunDuePublishing() {
    setBusyAction('run-due-publishing');
    setError(null);
    setWarning(null);

    try {
      const result = await runDuePublishing();
      await loadCampaignQueue();
      const publishedCount = result.published_items.length;
      const failedCount = result.failed_items.length;
      setWarning(`Publishing run completed. Published: ${publishedCount}. Failed: ${failedCount}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run publishing.');
    } finally {
      setBusyAction(null);
    }
  }

  const postAssistantImageSource = postAssistantItem ? getCampaignItemImageSource(postAssistantItem) : null;
  const postAssistantContentSlot = postAssistantItem
    ? weeklyContentSlots.find((slot) => slot.sourceItems.some((item) => item.content_id === postAssistantItem.content_id)) ?? null
    : null;
  const postAssistantPhotoAsset = postAssistantItem
    ? getCampaignItemPhotoAsset(postAssistantItem, photoAssets) ??
      (postAssistantContentSlot ? getContentSlotPhotoAsset(postAssistantContentSlot, photoAssets) : null)
    : null;
  const postAssistantUsesPhotoLibrary = Boolean(
    postAssistantPhotoAsset ||
      isPhotoLibraryImageSource(postAssistantImageSource) ||
      (postAssistantContentSlot && contentSlotUsesPhotoLibrary(postAssistantContentSlot, photoAssets)),
  );
  const selectedVisibilityTool = getVisibilityToolById(selectedVisibilityToolId) ?? getVisibilityToolById('local-reach-post');
  const selectedVisibilityPhotoAsset =
    photoAssets.find((asset) => asset.id === visibilityToolFormData.photoAssetId) ?? null;
  const filteredSavedGeneratedPosts =
    savedGeneratedPostFilter === 'all'
      ? savedGeneratedPosts
      : savedGeneratedPosts.filter((post) => post.tool_type === savedGeneratedPostFilter);
  const enabledLocalReachDestinations = localReachDestinationOptions;
  const activeMainNavIndex = appNavItems.findIndex((item) => item.key === activeSection);
  const activeNavItem = activeSection === 'settings' ? settingsNavItem : appNavItems[Math.max(activeMainNavIndex, 0)] ?? appNavItems[0];
  const sidebarNavStyle = {
    '--active-index': Math.max(activeMainNavIndex, 0),
    '--active-opacity': activeMainNavIndex >= 0 ? 1 : 0,
  } as CSSProperties & Record<'--active-index' | '--active-opacity', number>;
  const businessSubtitle = businessProfile.business_name
    ? `${businessProfile.business_name} content operations`
    : 'Marom Painting content operations';

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen ? 'app-sidebar-open' : ''}`} aria-label="GomezOps navigation">
        <div className="sidebar-brand">
          <span>{activeBusiness?.name?.trim() || 'No business selected'}</span>
        </div>
        <nav className="sidebar-nav" style={sidebarNavStyle} aria-label="Primary">
          <span className="sidebar-active-indicator" aria-hidden="true" />
          {appNavItems.map((item) => (
            <button
              className={`sidebar-nav-button ${activeSection === item.key ? 'active' : ''}`}
              key={item.key}
              type="button"
              onClick={() => {
                setActiveSection(item.key);
                setMobileNavOpen(false);
              }}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-footer">
          <button
            className="sidebar-refresh-button"
            disabled={
              loadingWeeklyQueue ||
              loadingJobs ||
              loadingQueue ||
              loadingCampaigns ||
              loadingCampaignQueue
            }
            type="button"
            onClick={() => void refreshActiveSection()}
          >
            <Icon name="restore" />
            <span>Refresh</span>
          </button>
          <button
            className={`sidebar-refresh-button sidebar-settings-button ${activeSection === 'settings' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setActiveSection('settings');
              setMobileNavOpen(false);
            }}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      {mobileNavOpen ? (
        <button
          aria-label="Close navigation"
          className="mobile-sidebar-scrim"
          type="button"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <main className="app-main">
      <header className="page-header">
        <button
          aria-expanded={mobileNavOpen}
          aria-label="Open navigation"
          className="icon-button mobile-menu-button"
          title="Menu"
          type="button"
          onClick={() => setMobileNavOpen((current) => !current)}
        >
          <Icon name="menu" />
        </button>
        <div className="page-title-block">
          <h1>{activeNavItem.label}</h1>
        </div>
      </header>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      {activeSection === 'visibility-tools' ? (
        <section className="panel visibility-tools-panel">
          <div className="panel-heading weekly-heading">
            <div>
              <h2>Get Customers</h2>
              <p>Pick what you need, answer a few details, and generate copy.</p>
            </div>
            <div className="panel-heading-actions">
              {loadingCampaigns || loadingWeeklyQueue ? <span className="loading-label">Loading</span> : null}
            </div>
          </div>

          <div className="visibility-tool-grid">
            {visibilityToolCards.map((tool) => (
              <button
                aria-pressed={selectedVisibilityToolId === tool.id}
                className={`visibility-tool-card ${selectedVisibilityToolId === tool.id ? 'visibility-tool-card-active' : ''}`}
                data-tool-id={tool.id}
                key={tool.id}
                type="button"
                onClick={() => openVisibilityTool(tool.id)}
              >
                <span className="visibility-tool-icon">
                  <Icon name={tool.icon} />
                </span>
                <span className="visibility-tool-mobile-label">{getVisibilityToolMobileLabel(tool.id)}</span>
                <h3>{tool.title}</h3>
                <p>{tool.description}</p>
                <span className="visibility-tool-cta">Start</span>
              </button>
            ))}
          </div>
          {selectedVisibilityTool ? (
            <VisibilityToolModal
              key={selectedVisibilityTool.id}
              copied={visibilityToolCopied}
              error={visibilityToolError}
              formData={visibilityToolFormData}
              generating={visibilityToolGenerating}
              saving={visibilityToolSaving}
              output={visibilityToolOutput}
              photoAssets={photoAssets}
              photoAsset={selectedVisibilityPhotoAsset}
              profile={businessProfile}
              tool={selectedVisibilityTool}
              enabledDestinations={enabledLocalReachDestinations}
              onCancel={closeVisibilityTool}
              onChange={updateVisibilityToolFormData}
              onCopy={() => void handleCopyVisibilityToolOutput()}
              onGenerate={() => void handleGenerateVisibilityTool()}
              onRefine={(refinement) => void handleRefineVisibilityToolOutput(refinement)}
              onSave={() => void handleSaveVisibilityToolOutput()}
              onOutputChange={(output) => {
                setVisibilityToolCopied(false);
                setVisibilityToolOutput((current) => ({
                  ...(current ?? { generationMode: 'fallback' }),
                  primary: output,
                }));
              }}
            />
          ) : null}
          <SavedGeneratedPostsSection
            activeBusiness={activeBusiness}
            filter={savedGeneratedPostFilter}
            loading={loadingSavedGeneratedPosts}
            posts={filteredSavedGeneratedPosts}
            onFilterChange={setSavedGeneratedPostFilter}
          />
        </section>
      ) : null}

      {activeSection === 'calendar' ? (
      <section className="panel weekly-panel">
        <div className="panel-heading weekly-heading">
          <div>
            <h2>Weekly Content Calendar</h2>
          </div>
          <div className="panel-heading-actions">
            {loadingWeeklyQueue ? <span className="loading-label">Loading</span> : null}
            <button
              className="secondary-button"
              disabled={busyAction === 'generate-weekly-posts'}
              type="button"
              onClick={openWeeklyScheduleModal}
            >
              Generate Weekly Plan
            </button>
            <button
              disabled={busyAction === 'generate-manual-post'}
              type="button"
              onClick={openManualPostModal}
            >
              Generate Post
            </button>
          </div>
        </div>

        <div className="weekly-calendar-grid" aria-label="Weekly content calendar">
          {weeklyCalendarDays.map((day, dayIndex) => (
            <details
              className={`calendar-day-column ${
                calendarDrag?.overDayIndex === dayIndex && !calendarDrag.overTrash ? 'calendar-day-column-drop-target' : ''
              }`}
              data-calendar-day-index={dayIndex}
              key={day.key}
              open={isMobileCalendar ? undefined : true}
            >
              <summary className="calendar-day-heading">
                <span>{day.shortLabel}</span>
                <strong>{day.label}</strong>
                <em>{day.contentSlots.length}</em>
              </summary>
              {day.contentSlots.length > 0 ? (
                <div className="content-slot-list">
                  {day.contentSlots.map((slot) => {
                    const collapsedStatus = getCollapsedContentSlotStatus(slot);
                    const platformLabels = getContentSlotPlatformLabels(slot);
                    const slotPhotoAsset = getContentSlotPhotoAsset(slot, photoAssets);
                    const usesPhotoLibrary = contentSlotUsesPhotoLibrary(slot, photoAssets);
                    return (
                      <button
                        aria-label={`Open ${slot.title}, scheduled for ${formatDisplayDate(slot.scheduledAt)}`}
                        className={`content-slot-card ${calendarDrag?.slotId === slot.id ? 'content-slot-card-dragging' : ''}`}
                        data-content-slot-card="true"
                        key={slot.id}
                        type="button"
                        onClick={(event) => handleContentSlotClick(event, slot)}
                      >
                        <div className="content-slot-media">
                          {slot.imageSource ? (
                            <img alt={`${slot.title} image`} src={getMediaUrl(slot.imageSource)} />
                          ) : (
                            <span>No image</span>
                          )}
                        </div>
                        <div className="content-slot-body">
                          <div className="content-slot-title-row">
                            <h3>{slot.title}</h3>
                            <span className="content-type-pill">{slot.contentType}</span>
                          </div>
                          <div className="content-slot-meta">
                            <span>{formatDisplayDate(slot.scheduledAt)}</span>
                          </div>
                          <div className="content-slot-card-footer">
                            <div className="platform-chip-row" aria-label="Platforms">
                              {platformLabels.length > 0 ? (
                                platformLabels.map((platform) => {
                                  const targetState = getPublishTargetState(
                                    platform.platform,
                                    publishSocialTargets,
                                    activeBusinessPublishTargets,
                                    loadingPublishTargets,
                                    publishTargetsError,
                                  );
                                  return (
                                    <span
                                      className={`platform-chip platform-chip-with-target ${getPublishTargetStateClassName(
                                        targetState,
                                      )}`}
                                      key={platform.platform}
                                      title={targetState.detail}
                                    >
                                      <strong>{platform.label}</strong>
                                      <small>{getPublishTargetChipLabel(targetState)}</small>
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="platform-chip platform-chip-muted">No platform</span>
                              )}
                            </div>
                            <span className={`content-slot-status-pill ${statusClassName(collapsedStatus.status)}`}>
                              {collapsedStatus.label} / {collapsedStatus.detail}
                            </span>
                          </div>
                          {usesPhotoLibrary ? (
                            <div className="content-slot-photo-source">
                              <span>Photo Library</span>
                              <strong>{slotPhotoAsset?.title ?? 'Saved asset image'}</strong>
                              {slotPhotoAsset ? (
                                <em>
                                  {slotPhotoAsset.category} · {getPhotoAssetQualityLabel(slotPhotoAsset.quality)}
                                </em>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="platform-status-list" aria-label="Platform status">
                            {getPlatformStatusRows(slot).map((platformStatus) => (
                              <span
                                className={`platform-status-pill ${statusClassName(platformStatus.status)}`}
                                key={platformStatus.platform}
                              >
                                <strong>{platformStatus.label}</strong>
                                {platformStatus.status}
                              </span>
                            ))}
                          </div>
                          <div className="content-slot-status">
                            <span>{slot.platformPosts.length} platform posts</span>
                          </div>
                        </div>
                        <div
                          className="content-slot-drag-affordance"
                          data-calendar-drag-handle="true"
                          onClick={handleContentSlotDragHandleClick}
                          onPointerCancel={handleContentSlotDragHandlePointerEnd}
                          onPointerDown={(event) => handleContentSlotDragHandlePointerDown(event, slot)}
                          onPointerMove={handleContentSlotDragHandlePointerMove}
                          onPointerUp={handleContentSlotDragHandlePointerEnd}
                        >
                          <span>Move</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="calendar-empty-cell">No slots</div>
              )}
            </details>
          ))}
        </div>
        {calendarDrag ? (
          <CalendarTrashDropZone active={calendarDrag.overTrash} />
        ) : null}
        {calendarDrag ? (
          <CalendarDragPreview drag={calendarDrag} slot={weeklyContentSlots.find((slot) => slot.id === calendarDrag.slotId) ?? null} />
        ) : null}
        {!loadingWeeklyQueue && weeklyContentSlots.length === 0 ? (
          <div className="empty-cell">No content slots are queued for this week yet.</div>
        ) : null}
        <div className="previous-posts-section">
          <button
            className="previous-posts-toggle"
            aria-expanded={showPreviousPosts}
            onClick={() => setShowPreviousPosts((current) => !current)}
            type="button"
          >
            <span>Previous Posts</span>
            <span className="previous-posts-count">{previousWeeklyPosts.length}</span>
          </button>
          {showPreviousPosts ? (
            previousWeeklyPosts.length > 0 ? (
              <div className="previous-post-list">
                {previousWeeklyPosts.map((item) => {
                  const imageSource = getCampaignItemImageSource(item);
                  return (
                    <article className="previous-post-item" key={item.content_id}>
                      {imageSource ? (
                        <img
                          alt={item.image_filename ?? `${formatPlatformLabel(item.platform)} previous post image`}
                          src={getMediaUrl(imageSource)}
                        />
                      ) : null}
                      <div className="previous-post-content">
                        <div className="weekly-post-title-row">
                          <div>
                            <h3>{formatPlatformLabel(item.platform)}</h3>
                            <span>{getCampaignItemBusiness(item)}</span>
                          </div>
                          <span className={`status-pill status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="weekly-post-meta">
                          <span>
                            {item.status === 'Skipped' ? 'Skipped' : 'Posted'}:{' '}
                            {formatDisplayDate(item.published_at)}
                          </span>
                          <span>Scheduled: {formatDisplayDate(getContentItemScheduledAt(item))}</span>
                        </div>
                        <p>{item.draft_text}</p>
                      </div>
                      <div className="previous-post-actions">
                        <button
                          aria-label="Add back to queue"
                          className="icon-button"
                          disabled={busyAction === `weekly-restore:${item.content_id}`}
                          title="Add back to queue"
                          onClick={() => void handleRestoreWeeklyPost(item.content_id)}
                        >
                          <Icon name="restore" />
                        </button>
                        <button
                          aria-label="Share / Save Image"
                          className="icon-button image-download-button"
                          title="Share / Save Image. On iPhone, use the share sheet to save to Photos or send to another app. On desktop, the image will download."
                          type="button"
                          onClick={() => void shareOrSaveImage(item)}
                        >
                          <Icon name="download" />
                        </button>
                        <button
                          className="danger-button"
                          disabled={busyAction === `weekly-delete:${item.content_id}`}
                          type="button"
                          onClick={() => void handleDeleteWeeklyPost(item)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-cell">No previous posts yet.</div>
            )
          ) : null}
        </div>
      </section>
      ) : null}

      {activeSection === 'business-profile' ? (
        <>
          <BusinessProfileSection
            activeBusiness={activeBusiness}
            context={activeBusinessContext}
            draft={activeBusinessProfileDraft}
            error={activeBusinessProfileError}
            loadingContext={loadingBusinessContext}
            saving={savingActiveBusinessProfile}
            onCancel={handleCancelActiveBusinessProfileEdits}
            onChange={setActiveBusinessProfileDraft}
            onSave={() => void handleSaveActiveBusinessProfile()}
          />
          <BusinessContextSection
            activeBusiness={activeBusiness}
            draft={businessContextDraft}
            error={businessContextError}
            loading={loadingBusinessContext}
            saving={savingBusinessContext}
            savedContext={activeBusinessContext}
            onChange={setBusinessContextDraft}
            onReload={() => void loadActiveBusinessContext(activeBusinessId)}
            onSave={() => void handleSaveBusinessContext()}
          />
        </>
      ) : null}

      {activeSection === 'photo-library' ? (
        <PhotoLibrarySection
          businessId={activeBusinessId}
          businessName={activeBusiness?.name ?? businessProfile.business_name}
          serviceOptions={businessProfile.services_offered}
          onAssetsChange={setPhotoAssets}
          onNotify={pushToast}
        />
      ) : null}

      {activeSection === 'settings' ? (
        <SettingsSection
          activeBusiness={activeBusiness}
          activeBusinessId={activeBusinessId}
          businesses={businesses}
          businessDraft={businessCreateDraft}
          creatingBusiness={creatingBusiness}
          emojiPreference={emojiPreference}
          loadingBusinesses={loadingBusinesses}
          theme={theme}
          onBusinessCreate={() => void handleCreateBusiness()}
          onBusinessDraftChange={setBusinessCreateDraft}
          onBusinessSelect={setActiveBusinessId}
          onEmojiPreferenceChange={setEmojiPreference}
          onNotify={pushToast}
          onPublishTargetStateChange={handlePublishTargetStateChange}
          onThemeChange={(nextTheme) => setTheme(nextTheme)}
        />
      ) : null}

      {activeSection === 'jobs-queues' ? (
      <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Completed Jobs</h2>
          {loadingJobs ? <span className="loading-label">Loading</span> : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Location</th>
                <th>Completed</th>
                <th>Room/Area</th>
                <th>Colors</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const hasJobId = Boolean(job.job_id);
                return (
                  <tr key={job.job_id ?? `${job.customer}-${job.date_completed}`}>
                    <td>{job.job_id ?? 'Missing'}</td>
                    <td>{job.customer}</td>
                    <td>{job.job_type}</td>
                    <td>{job.location}</td>
                    <td>{job.date_completed}</td>
                    <td>{job.room_area ?? '—'}</td>
                    <td>{job.paint_colors ?? '—'}</td>
                    <td>
                      <div className="action-row">
                        <button
                          disabled={!hasJobId || busyAction === `preview:${job.job_id}`}
                          onClick={() => void handlePreview(job)}
                        >
                          Preview Draft
                        </button>
                        <button
                          disabled={!hasJobId || busyAction === `save:${job.job_id}`}
                          onClick={() => void handleGenerateAndSave(job)}
                        >
                          Generate + Save
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loadingJobs && jobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No completed jobs found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Campaigns</h2>
          {loadingCampaigns ? <span className="loading-label">Loading</span> : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign ID</th>
                <th>Name</th>
                <th>Service</th>
                <th>Location</th>
                <th>Target</th>
                <th>Offer</th>
                <th>CTA</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.campaign_id}>
                  <td>{campaign.campaign_id}</td>
                  <td>{campaign.campaign_name}</td>
                  <td>{campaign.service_focus}</td>
                  <td>{campaign.target_location}</td>
                  <td>{campaign.target_customer}</td>
                  <td>{campaign.offer ?? '-'}</td>
                  <td>
                    {campaign.cta}
                    <br />
                    <a href={campaign.landing_page_url} rel="noreferrer" target="_blank">
                      Quote form
                    </a>
                  </td>
                  <td>
                    {campaign.start_date}
                    <br />
                    {campaign.end_date}
                  </td>
                  <td>{campaign.status}</td>
                  <td>
                    <div className="action-row">
                      <button
                        disabled={busyAction === `campaign-preview:${campaign.campaign_id}`}
                        onClick={() => void handleCampaignPreview(campaign)}
                      >
                        Preview Drafts
                      </button>
                      <button
                        disabled={busyAction === `campaign-save:${campaign.campaign_id}`}
                        onClick={() => void handleGenerateAndSaveCampaign(campaign)}
                      >
                        Generate + Save
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loadingCampaigns && campaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-cell">
                    No campaigns found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Content Queue</h2>
          {loadingQueue ? <span className="loading-label">Loading</span> : null}
        </div>
        {queueGroups.length > 0 ? (
          <div className="queue-groups">
            {queueGroups.map((group) => {
              const expanded = expandedQueueJobs[group.jobId] ?? false;
              const groupBodyId = queueGroupDomId(group.jobId);
              return (
                <article className="queue-group" key={group.jobId}>
                  <button
                    className="queue-group-toggle"
                    aria-expanded={expanded}
                    aria-controls={groupBodyId}
                    onClick={() => toggleQueueGroup(group.jobId)}
                  >
                    <span className="queue-toggle-icon" aria-hidden="true">
                      {expanded ? '-' : '+'}
                    </span>
                    <span className="queue-group-title">
                      <strong>{group.jobId}</strong>
                      <span>
                        {group.items.length} drafts · Latest {group.latestCreatedAt}
                      </span>
                    </span>
                    <span className="queue-status-summary">
                      {Object.entries(group.statusCounts).map(([statusName, count]) => (
                        <span
                          className={`status-pill status-${statusName.toLowerCase().replace(/\s+/g, '-')}`}
                          key={statusName}
                        >
                          {statusName}: {count}
                        </span>
                      ))}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="queue-group-body" id={groupBodyId}>
                      {group.items.map((item) => (
                        <section className="queue-draft" key={item.content_id}>
                          <div className="queue-draft-main">
                            <div className="queue-draft-heading">
                              <div>
                                <h3>{item.platform}</h3>
                                <span className="mono">{item.content_id}</span>
                              </div>
                              <span className={`status-pill status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {item.status}
                              </span>
                            </div>
                            <p className="queue-draft-text">{item.draft_text}</p>
                            <div className="queue-draft-meta">
                              <span>Approved: {item.approved}</span>
                              <span>Published: {item.published}</span>
                              <span>Created: {item.created_at}</span>
                            </div>
                          </div>
                          <div className="action-row queue-actions">
                            <button
                              disabled={busyAction === `approve:${item.content_id}`}
                              onClick={() => void handleQueueAction(item.content_id, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyAction === `reject:${item.content_id}`}
                              onClick={() => void handleQueueAction(item.content_id, 'reject')}
                            >
                              Reject
                            </button>
                            <button
                              disabled={busyAction === `published:${item.content_id}`}
                              onClick={() => void handleQueueAction(item.content_id, 'published')}
                            >
                              Mark Published
                            </button>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
        {!loadingQueue && queueGroups.length === 0 ? <div className="empty-cell">No content queue items found.</div> : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Campaign Content Queue</h2>
          <div className="panel-heading-actions">
            {loadingCampaignQueue ? <span className="loading-label">Loading</span> : null}
            <button
              className="secondary-button"
              disabled={busyAction === 'run-due-publishing'}
              onClick={() => void handleRunDuePublishing()}
            >
              Run Publishing
            </button>
          </div>
        </div>
        {campaignQueueGroups.length > 0 ? (
          <div className="queue-groups">
            {campaignQueueGroups.map((group) => {
              const expanded = expandedCampaignQueue[group.campaignId] ?? false;
              const groupBodyId = campaignQueueGroupDomId(group.campaignId);
              return (
                <article className="queue-group" key={group.campaignId}>
                  <button
                    className="queue-group-toggle"
                    aria-expanded={expanded}
                    aria-controls={groupBodyId}
                    onClick={() => toggleCampaignQueueGroup(group.campaignId)}
                  >
                    <span className="queue-toggle-icon" aria-hidden="true">
                      {expanded ? '-' : '+'}
                    </span>
                    <span className="queue-group-title">
                      <strong>{group.campaignId}</strong>
                      <span>
                        {group.items.length} drafts · Latest {group.latestCreatedAt}
                      </span>
                    </span>
                    <span className="queue-status-summary">
                      {Object.entries(group.statusCounts).map(([statusName, count]) => (
                        <span
                          className={`status-pill status-${statusName.toLowerCase().replace(/\s+/g, '-')}`}
                          key={statusName}
                        >
                          {statusName}: {count}
                        </span>
                      ))}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="queue-group-body" id={groupBodyId}>
                      {group.items.map((item) => (
                        <section className="queue-draft" key={item.content_id}>
                          <div className="queue-draft-main">
                            <div className="queue-draft-heading">
                              <div>
                                <h3>{item.platform}</h3>
                                <span className="mono">{item.content_id}</span>
                              </div>
                              <span className={`status-pill status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {item.status}
                              </span>
                            </div>
                            <p className="queue-draft-text">{item.draft_text}</p>
                            <div className="queue-draft-meta">
                              {getCampaignItemImageSource(item) ? (
                                <a
                                  className="campaign-image-preview"
                                  href={getMediaUrl(getCampaignItemImageSource(item) as string)}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <img
                                    alt={item.image_filename ?? 'Campaign image'}
                                    src={getMediaUrl(getCampaignItemImageSource(item) as string)}
                                  />
                                </a>
                              ) : null}
                              <span>Image: {item.image_filename ?? 'None selected'}</span>
                              {item.image_path ? <span>Image Path: {item.image_path}</span> : null}
                              {item.image_url ? (
                                <span>
                                  Image URL:{' '}
                                  <a href={item.image_url} rel="noreferrer" target="_blank">
                                    {item.image_url}
                                  </a>
                                </span>
                              ) : null}
                              <span>CTA: {item.cta}</span>
                              <span>
                                URL:{' '}
                                <a href={item.landing_page_url} rel="noreferrer" target="_blank">
                                  {item.landing_page_url}
                                </a>
                              </span>
                              <span>Approved: {item.approved}</span>
                              <span>Published: {item.published}</span>
                              <span>Created: {item.created_at}</span>
                              <span>Scheduled At: {item.scheduled_at ?? 'Not scheduled'}</span>
                              {item.notes ? <span>Notes: {item.notes}</span> : null}
                              {item.published_at ? <span>Published At: {item.published_at}</span> : null}
                              <span>Publish Attempts: {item.publish_attempts}</span>
                              {item.external_post_id ? <span>External Post ID: {item.external_post_id}</span> : null}
                              {item.published_url ? (
                                <span>
                                  Published URL:{' '}
                                  <a href={item.published_url} rel="noreferrer" target="_blank">
                                    {item.published_url}
                                  </a>
                                </span>
                              ) : null}
                              {item.last_publish_error ? (
                                <span className="error-text">Last Publish Error: {item.last_publish_error}</span>
                              ) : null}
                            </div>
                            {renderGoogleBusinessPublishStatus(item)}
                            {renderMetaPublishStatus(item)}
                          </div>
                          <div className="action-row queue-actions">
                            {isCampaignItemPublishable(item) ? (
                              <div className="schedule-controls">
                                <input
                                  aria-label={`Schedule ${item.platform} publish time`}
                                  type="datetime-local"
                                  value={scheduleInputs[item.content_id] ?? toDatetimeLocalValue(item.scheduled_at)}
                                  onChange={(event) =>
                                    setScheduleInputs((current) => ({
                                      ...current,
                                      [item.content_id]: event.target.value,
                                    }))
                                  }
                                />
                                <button
                                  disabled={busyAction === `campaign-schedule:${item.content_id}`}
                                  onClick={() => void handleScheduleCampaignContent(item)}
                                >
                                  Schedule
                                </button>
                              </div>
                            ) : null}
                            <button onClick={() => void handleCopyCampaignPackage(item)}>
                              {copiedPackageId === item.content_id ? 'Copied!' : 'Copy Package'}
                            </button>
                            {isMetaPlatform(item.platform) ? (
                              <button onClick={() => void handleCopyMetaPackage(item)}>
                                {copiedPackageId === `meta:${item.content_id}` ? 'Copied!' : 'Copy Meta Package'}
                              </button>
                            ) : null}
                            {isCampaignItemPublishable(item) ? (
                              <button
                                disabled={busyAction === `campaign-publish:${item.content_id}`}
                                onClick={() => void handlePublishCampaignContent(item)}
                              >
                                {item.status === 'Publish Failed' || item.status === 'Partially Published'
                                  ? 'Retry Failed Targets'
                                  : 'Publish'}
                              </button>
                            ) : null}
                            <button
                              disabled={busyAction === `campaign-approve:${item.content_id}`}
                              onClick={() => void handleCampaignQueueAction(item.content_id, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyAction === `campaign-reject:${item.content_id}`}
                              onClick={() => void handleCampaignQueueAction(item.content_id, 'reject')}
                            >
                              Reject
                            </button>
                            <button
                              disabled={busyAction === `campaign-published:${item.content_id}`}
                              onClick={() => void handleCampaignQueueAction(item.content_id, 'published')}
                            >
                              Mark Published
                            </button>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
        {!loadingCampaignQueue && campaignQueueGroups.length === 0 ? (
          <div className="empty-cell">No campaign content queue items found.</div>
        ) : null}
      </section>
      </>
      ) : null}

      {preview ? <DraftPreview preview={preview} onClose={() => setPreview(null)} /> : null}
      {campaignPreview ? (
        <CampaignDraftPreview preview={campaignPreview} onClose={() => setCampaignPreview(null)} />
      ) : null}
      {showWeeklyScheduleModal ? (
        <WeeklyScheduleModal
          busy={busyAction === 'generate-weekly-posts'}
          settings={weeklyScheduleSettings}
          onCancel={() => setShowWeeklyScheduleModal(false)}
          onChange={setWeeklyScheduleSettings}
          onGenerate={(settings) => void handleGenerateWeeklyPosts(settings)}
        />
      ) : null}
      {showManualPostModal ? (
        <ManualPostModal
          busy={busyAction === 'generate-manual-post'}
          campaigns={campaigns}
          settings={manualPostSettings}
          onCancel={() => setShowManualPostModal(false)}
          onChange={setManualPostSettings}
          onGenerate={(settings) => void handleGenerateManualPost(settings)}
        />
      ) : null}
      {selectedContentSlot ? (
        <ContentSlotDetailModal
          busyAction={busyAction}
          draftTextEdits={draftTextEdits}
          editingDraftId={editingDraftId}
          loadingPublishTargets={loadingPublishTargets}
          photoAsset={getContentSlotPhotoAsset(selectedContentSlot, photoAssets)}
          publishTargetsError={publishTargetsError}
          slot={selectedContentSlot}
          businessPublishTargets={activeBusinessPublishTargets}
          socialTargets={publishSocialTargets}
          usesPhotoLibrary={contentSlotUsesPhotoLibrary(selectedContentSlot, photoAssets)}
          onApprove={handleApproveWeeklyPost}
          onCancelEdit={cancelEditingDraft}
          onChangePhoto={openPhotoPicker}
          onClose={closeContentSlot}
          onDelete={handleDeleteWeeklyPost}
          onDraftTextChange={(contentId, draftText) =>
            setDraftTextEdits((current) => ({
              ...current,
              [contentId]: draftText,
            }))
          }
          onPost={openPostAssistant}
          onOpenSettings={() => {
            closeContentSlot();
            setActiveSection('settings');
          }}
          onRegenerate={handleRegeneratePlatformPost}
          onSaveDraft={handleSaveDraftText}
          onStartEdit={startEditingDraft}
        />
      ) : null}
      {pendingDeleteContentSlot ? (
        <DeleteContentSlotConfirmModal
          slot={pendingDeleteContentSlot}
          onCancel={() => setPendingDeleteContentSlotId(null)}
          onConfirm={() => void handleConfirmDeleteContentSlot()}
        />
      ) : null}
      {photoPickerContentSlot ? (
        <PhotoAssetPickerModal
          assets={photoAssets}
          busy={busyAction === `change-photo:${photoPickerContentSlot.id}`}
          currentAsset={getContentSlotPhotoAsset(photoPickerContentSlot, photoAssets)}
          slot={photoPickerContentSlot}
          onCancel={() => setPhotoPickerContentSlotId(null)}
          onSelect={(asset) => void handleSelectPhotoAssetForSlot(photoPickerContentSlot, asset)}
        />
      ) : null}
      {postAssistantItem ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closePostAssistant}>
          <section
            className="modal-panel post-assistant-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-assistant-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id="post-assistant-title">Post Assistant</h2>
              </div>
              <button
                aria-label="Close Post Assistant"
                className="icon-button post-assistant-close-button"
                title="Close"
                type="button"
                onClick={closePostAssistant}
              >
                <Icon name="x" />
              </button>
            </div>

            <div className="post-assistant-summary">
              <span>{getCampaignItemBusiness(postAssistantItem)}</span>
              <span>{formatPlatformLabel(postAssistantItem.platform)}</span>
              <span>{formatDisplayDate(getContentItemScheduledAt(postAssistantItem))}</span>
              {postAssistantItem.post_type ? <span>{postAssistantItem.post_type}</span> : null}
              {getCalendarPlatformsForItem(postAssistantItem).map((platform) => {
                const targetState = getPublishTargetState(
                  platform,
                  publishSocialTargets,
                  activeBusinessPublishTargets,
                  loadingPublishTargets,
                  publishTargetsError,
                );
                return (
                  <span
                    className={`post-assistant-target-state ${getPublishTargetStateClassName(targetState)}`}
                    key={platform}
                    title={targetState.detail}
                  >
                    {formatCalendarPlatformShortLabel(platform)}: {getPublishTargetChipLabel(targetState)}
                  </span>
                );
              })}
            </div>

            {postAssistantError ? (
              <div className="post-assistant-error" role="alert">
                {postAssistantError}
              </div>
            ) : null}

            <div className="post-assistant-layout">
              <div className="post-assistant-preview">
                {postAssistantImageSource ? (
                  <img
                    alt={postAssistantItem.image_filename ?? `${formatPlatformLabel(postAssistantItem.platform)} post image`}
                    src={getMediaUrl(postAssistantImageSource)}
                  />
                ) : (
                  <span>No image attached</span>
                )}
              </div>

              <div className="post-assistant-details">
                <label>
                  <span>Caption</span>
                  <textarea readOnly value={postAssistantItem.draft_text} />
                </label>
                <div className="post-assistant-meta">
                  <span>
                    <strong>CTA:</strong> {postAssistantItem.cta}
                  </span>
                  <span>
                    <strong>Landing page:</strong>{' '}
                    <a href={postAssistantItem.landing_page_url} rel="noreferrer" target="_blank">
                      {postAssistantItem.landing_page_url}
                    </a>
                  </span>
                </div>
                {postAssistantUsesPhotoLibrary ? (
                  <PhotoLibraryAssetSummary
                    asset={postAssistantPhotoAsset}
                    title="Photo Library Asset"
                    onChangePhoto={
                      postAssistantContentSlot ? () => openPhotoPicker(postAssistantContentSlot) : undefined
                    }
                  />
                ) : null}
              </div>
            </div>

            <div className="post-assistant-steps">
              <button type="button" onClick={() => void copyPostAssistantCaption(postAssistantItem)}>
                <span>Step 1</span>
                {postAssistantCopiedAction === 'caption' ? 'Caption copied' : 'Copy Caption'}
              </button>
              <button type="button" onClick={() => void handlePostAssistantShareImage(postAssistantItem)}>
                <span>Step 2</span>
                Share / Save Image
              </button>
              <button type="button" onClick={handleOpenMetaBusinessSuite}>
                <span>Step 3</span>
                Open Meta Business Suite
              </button>
              <button
                className="secondary-button"
                disabled={busyAction === `assistant-posted:${postAssistantItem.content_id}`}
                type="button"
                onClick={() => void handlePostAssistantStatusAction(postAssistantItem, 'posted')}
              >
                <span>Step 4</span>
                Mark as Posted
              </button>
            </div>

            <div className="post-assistant-footer">
              <button type="button" onClick={closePostAssistant}>
                Close
              </button>
              <button
                disabled={busyAction === `assistant-skipped:${postAssistantItem.content_id}`}
                type="button"
                onClick={() => void handlePostAssistantStatusAction(postAssistantItem, 'skipped')}
              >
                Skip Post
              </button>
            </div>
          </section>
        </div>
      ) : null}
      </main>
    </div>
  );
}

function BusinessProfileSection({
  activeBusiness,
  context,
  draft,
  error,
  loadingContext,
  saving,
  onCancel,
  onChange,
  onSave,
}: {
  activeBusiness: Business | null;
  context: BusinessContext | null;
  draft: ActiveBusinessProfileDraft;
  error: string | null;
  loadingContext: boolean;
  saving: boolean;
  onCancel: () => void;
  onChange: (draft: ActiveBusinessProfileDraft) => void;
  onSave: () => void;
}) {
  const updateField = <Key extends keyof ActiveBusinessProfileDraft>(field: Key, value: ActiveBusinessProfileDraft[Key]) => {
    onChange({ ...draft, [field]: value });
  };
  const disabled = !activeBusiness || saving;

  return (
    <section className="panel business-profile-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Business Profile</h2>
          <p>
            {activeBusiness
              ? `Active profile for ${activeBusiness.name}.`
              : 'Select or create an active business before editing profile details.'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="photo-library-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!activeBusiness ? (
        <div className="photo-library-empty">
          <strong>No active business selected.</strong>
          <span>Create or select a business above to view and edit its profile.</span>
        </div>
      ) : (
        <div className="business-profile-layout">
          <aside className="business-profile-summary" aria-label="Active business profile">
            <span>Active Business Profile</span>
            <h3>{activeBusiness.name}</h3>
            <p>{formatActiveBusinessValue(activeBusiness.industry)}</p>
            <div className="business-profile-summary-lines">
              <span>Location: {formatActiveBusinessValue(activeBusiness.location)}</span>
              <span>Website: {formatActiveBusinessValue(activeBusiness.website_url)}</span>
              <span>Phone: {formatActiveBusinessValue(activeBusiness.phone)}</span>
              <span>Email: {formatActiveBusinessValue(activeBusiness.email)}</span>
            </div>
            <div className="business-profile-pill-list">
              <strong>Services</strong>
              {context?.services.length ? (
                context.services.map((service) => <span key={service}>{service}</span>)
              ) : (
                <span>Not set</span>
              )}
            </div>
            <div className="business-profile-pill-list">
              <strong>Differentiators</strong>
              {context?.differentiators.length ? (
                context.differentiators.map((item) => <span key={item}>{item}</span>)
              ) : (
                <span>Not set</span>
              )}
            </div>
            <div className="business-profile-summary-lines">
              <span>Service area: {formatActiveBusinessValue(context?.service_area)}</span>
              <span>Target: {formatActiveBusinessValue(context?.target_customers)}</span>
              <span>Voice: {formatActiveBusinessValue(context?.brand_voice)}</span>
              <span>Notes: {formatActiveBusinessValue(context?.notes)}</span>
              {loadingContext ? <span>Context: Loading</span> : null}
            </div>
          </aside>

          <details className="business-profile-edit-panel">
            <summary>Edit Business Details</summary>
            <form
              className="business-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!disabled) onSave();
              }}
            >
              <label className="form-field">
                <span>Business name</span>
                <input
                  disabled={disabled}
                  value={draft.name}
                  onChange={(event) => updateField('name', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Industry / category</span>
                <input
                  disabled={disabled}
                  value={draft.industry}
                  onChange={(event) => updateField('industry', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Location</span>
                <input
                  disabled={disabled}
                  value={draft.location}
                  onChange={(event) => updateField('location', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Website URL</span>
                <input
                  disabled={disabled}
                  value={draft.website_url}
                  onChange={(event) => updateField('website_url', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Phone</span>
                <input
                  disabled={disabled}
                  value={draft.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  disabled={disabled}
                  value={draft.email}
                  onChange={(event) => updateField('email', event.target.value)}
                />
              </label>
            </form>

            <div className="business-profile-actions">
              <button disabled={saving} type="button" onClick={onCancel}>
                Cancel
              </button>
              <button className="secondary-button" disabled={disabled} type="button" onClick={onSave}>
                {saving ? 'Saving...' : 'Save Business'}
              </button>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function BusinessContextSection({
  activeBusiness,
  draft,
  error,
  loading,
  saving,
  savedContext,
  onChange,
  onReload,
  onSave,
}: {
  activeBusiness: Business | null;
  draft: BusinessContextDraft;
  error: string | null;
  loading: boolean;
  saving: boolean;
  savedContext: BusinessContext | null;
  onChange: (draft: BusinessContextDraft) => void;
  onReload: () => void;
  onSave: () => void;
}) {
  const disabled = !activeBusiness || loading || saving;
  const updateField = <Key extends keyof BusinessContextDraft>(field: Key, value: BusinessContextDraft[Key]) => {
    onChange({ ...draft, [field]: value });
  };

  return (
    <section className="panel business-context-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Business Context</h2>
          <p>
            {activeBusiness
              ? `Memory for ${activeBusiness.name}.`
              : 'Select or create an active business before editing context.'}
          </p>
        </div>
        <div className="panel-heading-actions">
          {loading ? <span className="loading-label">Loading</span> : null}
          <button className="secondary-button" disabled={!activeBusiness || loading || saving} type="button" onClick={onReload}>
            Reload
          </button>
          <button disabled={disabled} type="button" onClick={onSave}>
            {saving ? 'Saving...' : 'Save Context'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="photo-library-alert" role="alert">
          {error}
        </div>
      ) : null}

      {!activeBusiness ? (
        <div className="photo-library-empty">
          <strong>No active business selected.</strong>
          <span>Create or select a business above to load and save context.</span>
        </div>
      ) : (
        <div className="business-context-layout">
          <div className="business-context-summary">
            <span>Saved Context</span>
            <strong>{savedContext ? 'Stored for this business' : 'No saved context yet'}</strong>
            {savedContext?.services.length ? <p>Services: {savedContext.services.join(', ')}</p> : null}
            {savedContext?.service_area ? <p>Service area: {savedContext.service_area}</p> : null}
            {savedContext?.brand_voice ? <p>Voice: {savedContext.brand_voice}</p> : null}
          </div>
          <form
            className="business-context-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!disabled) onSave();
            }}
          >
            <label className="form-field form-field-wide">
              <span>Services</span>
              <textarea
                disabled={disabled}
                placeholder="One service per line"
                value={draft.servicesText}
                onChange={(event) => updateField('servicesText', event.target.value)}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>Target customers</span>
              <textarea
                disabled={disabled}
                value={draft.target_customers}
                onChange={(event) => updateField('target_customers', event.target.value)}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>Brand voice</span>
              <textarea
                disabled={disabled}
                value={draft.brand_voice}
                onChange={(event) => updateField('brand_voice', event.target.value)}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>Differentiators</span>
              <textarea
                disabled={disabled}
                placeholder="One differentiator per line"
                value={draft.differentiatorsText}
                onChange={(event) => updateField('differentiatorsText', event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Service area</span>
              <input
                disabled={disabled}
                value={draft.service_area}
                onChange={(event) => updateField('service_area', event.target.value)}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>Notes</span>
              <textarea
                disabled={disabled}
                value={draft.notes}
                onChange={(event) => updateField('notes', event.target.value)}
              />
            </label>
          </form>
        </div>
      )}
    </section>
  );
}

function SettingsSection({
  activeBusiness,
  activeBusinessId,
  businesses,
  businessDraft,
  creatingBusiness,
  emojiPreference,
  loadingBusinesses,
  theme,
  onBusinessCreate,
  onBusinessDraftChange,
  onBusinessSelect,
  onEmojiPreferenceChange,
  onNotify,
  onPublishTargetStateChange,
  onThemeChange,
}: {
  activeBusiness: Business | null;
  activeBusinessId: string;
  businesses: Business[];
  businessDraft: BusinessCreateDraft;
  creatingBusiness: boolean;
  emojiPreference: EmojiPreference;
  loadingBusinesses: boolean;
  theme: AppTheme;
  onBusinessCreate: () => void;
  onBusinessDraftChange: (draft: BusinessCreateDraft) => void;
  onBusinessSelect: (businessId: string) => void;
  onEmojiPreferenceChange: (preference: EmojiPreference) => void;
  onNotify?: (toast: { durationMs?: number; message: string; title?: string; type: ToastType }) => string;
  onPublishTargetStateChange?: (targets: SocialTarget[], mappings: BusinessPublishTarget[]) => void;
  onThemeChange: (theme: AppTheme) => void;
}) {
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [socialTargets, setSocialTargets] = useState<SocialTarget[]>([]);
  const [businessPublishTargets, setBusinessPublishTargets] = useState<BusinessPublishTarget[]>([]);
  const [loadingPublishingIntegrations, setLoadingPublishingIntegrations] = useState(false);
  const [loadedPublishingIntegrationsBusinessId, setLoadedPublishingIntegrationsBusinessId] = useState<string | null>(null);
  const [publishingIntegrationsError, setPublishingIntegrationsError] = useState<string | null>(null);
  const [publishingIntegrationsNotice, setPublishingIntegrationsNotice] = useState<string | null>(null);
  const [publishingIntegrationsBusyAction, setPublishingIntegrationsBusyAction] = useState<string | null>(null);
  const darkModeEnabled = theme === 'dark';
  const emojiOptions: Array<{ label: string; value: EmojiPreference }> = [
    { label: 'Less', value: 'less' },
    { label: 'Default', value: 'default' },
    { label: 'More', value: 'more' },
  ];
  const metaConnection = socialConnections.find((connection) => connection.provider === 'meta') ?? null;
  const googleConnection = socialConnections.find((connection) => connection.provider === 'google_business') ?? null;
  const activePublishingIntegrationsBusinessKey = activeBusinessId ?? 'none';
  const showPublishingIntegrationsLoading =
    loadingPublishingIntegrations && loadedPublishingIntegrationsBusinessId !== activePublishingIntegrationsBusinessKey;

  const loadPublishingIntegrations = useCallback(async () => {
    const loadBusinessKey = activeBusinessId ?? 'none';
    setLoadingPublishingIntegrations(true);
    setPublishingIntegrationsError(null);
    try {
      const [connections, targets, mappings] = await Promise.all([
        listSocialConnections(),
        listSocialTargets(),
        activeBusinessId ? listBusinessPublishTargets(activeBusinessId) : Promise.resolve([]),
      ]);
      setSocialConnections(connections);
      setSocialTargets(targets);
      setBusinessPublishTargets(mappings);
      onPublishTargetStateChange?.(targets, mappings);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load publishing integrations.';
      setPublishingIntegrationsError(message);
      setSocialConnections([]);
      setSocialTargets([]);
      setBusinessPublishTargets([]);
      onPublishTargetStateChange?.([], []);
    } finally {
      setLoadedPublishingIntegrationsBusinessId(loadBusinessKey);
      setLoadingPublishingIntegrations(false);
    }
  }, [activeBusinessId, onPublishTargetStateChange]);

  useEffect(() => {
    void loadPublishingIntegrations();
  }, [loadPublishingIntegrations]);

  function notifyIntegration(message: string, title: string, type: ToastType) {
    setPublishingIntegrationsNotice(type === 'success' ? message : null);
    onNotify?.({ message, title, type });
  }

  async function handleCreateFakeConnection(provider: 'meta' | 'google_business') {
    const actionKey = provider === 'meta' ? 'connect-fake-meta' : 'connect-fake-google';
    setPublishingIntegrationsBusyAction(actionKey);
    setPublishingIntegrationsError(null);
    setPublishingIntegrationsNotice(null);
    try {
      await (provider === 'meta' ? createFakeMetaConnection() : createFakeGoogleConnection());
      await loadPublishingIntegrations();
      notifyIntegration(
        provider === 'meta' ? 'Fake Meta targets are available.' : 'Fake Google Business target is available.',
        'Connection created',
        'success',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create fake connection.';
      setPublishingIntegrationsError(message);
      notifyIntegration(message, 'Connection failed', 'error');
    } finally {
      setPublishingIntegrationsBusyAction(null);
    }
  }

  async function handleDisconnectConnection(connection: SocialConnection) {
    const confirmed = window.confirm(`Disconnect ${connection.account_label}? Assigned targets from this connection will be removed.`);
    if (!confirmed) return;
    setPublishingIntegrationsBusyAction(`disconnect:${connection.id}`);
    setPublishingIntegrationsError(null);
    setPublishingIntegrationsNotice(null);
    try {
      await disconnectSocialConnection(connection.id);
      await loadPublishingIntegrations();
      notifyIntegration(`${connection.account_label} disconnected.`, 'Connection disconnected', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to disconnect connection.';
      setPublishingIntegrationsError(message);
      notifyIntegration(message, 'Disconnect failed', 'error');
    } finally {
      setPublishingIntegrationsBusyAction(null);
    }
  }

  async function handleAssignBusinessTarget(platform: PublishTargetPlatform, socialTargetId: string) {
    if (!activeBusinessId) {
      setPublishingIntegrationsError('Select or create an active business before assigning publish targets.');
      return;
    }
    const existingMapping = businessPublishTargets.find((mapping) => mapping.platform === platform);
    if (!socialTargetId) {
      if (existingMapping) {
        await handleUnassignBusinessTarget(platform);
      }
      return;
    }
    setPublishingIntegrationsBusyAction(`assign:${platform}`);
    setPublishingIntegrationsError(null);
    setPublishingIntegrationsNotice(null);
    try {
      await assignBusinessPublishTarget(activeBusinessId, platform, socialTargetId);
      await loadPublishingIntegrations();
      notifyIntegration(`${platform} target assigned to ${activeBusiness?.name ?? 'active business'}.`, 'Target assigned', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : `Unable to assign ${platform} target.`;
      setPublishingIntegrationsError(message);
      notifyIntegration(message, 'Assignment failed', 'error');
    } finally {
      setPublishingIntegrationsBusyAction(null);
    }
  }

  async function handleUnassignBusinessTarget(platform: PublishTargetPlatform) {
    if (!activeBusinessId) return;
    const existingMapping = businessPublishTargets.find((mapping) => mapping.platform === platform);
    if (!existingMapping) return;
    setPublishingIntegrationsBusyAction(`unassign:${platform}`);
    setPublishingIntegrationsError(null);
    setPublishingIntegrationsNotice(null);
    try {
      await unassignBusinessPublishTarget(activeBusinessId, platform);
      await loadPublishingIntegrations();
      notifyIntegration(`${platform} target removed from ${activeBusiness?.name ?? 'active business'}.`, 'Target removed', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : `Unable to remove ${platform} target.`;
      setPublishingIntegrationsError(message);
      notifyIntegration(message, 'Remove target failed', 'error');
    } finally {
      setPublishingIntegrationsBusyAction(null);
    }
  }

  function getTargetsForPlatform(platform: PublishTargetPlatform) {
    return socialTargets.filter((target) => target.platform === platform);
  }

  function getAssignedTarget(platform: PublishTargetPlatform) {
    const mapping = businessPublishTargets.find((item) => item.platform === platform);
    if (!mapping) return null;
    return socialTargets.find((target) => target.id === mapping.social_target_id) ?? null;
  }

  function scrollToAssignments() {
    document.getElementById('publish-target-assignments')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Settings</h2>
          <p>Manage app preferences.</p>
        </div>
      </div>
      <div className="settings-list">
        <div className="settings-row settings-business-row">
          <div>
            <strong>Active Business</strong>
            <span>Switch or create the business used by calendar, photos, context, and saved posts.</span>
          </div>
          <BusinessSelector
            activeBusiness={activeBusiness}
            activeBusinessId={activeBusinessId}
            businesses={businesses}
            creating={creatingBusiness}
            draft={businessDraft}
            loading={loadingBusinesses}
            onCreate={onBusinessCreate}
            onDraftChange={onBusinessDraftChange}
            onSelect={onBusinessSelect}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Emoji use in generated posts</strong>
            <span>Controls how many emojis GomezOps uses in captions and post copy.</span>
          </div>
          <div className="settings-segmented-control" role="group" aria-label="Emoji use in generated posts">
            {emojiOptions.map((option) => (
              <button
                aria-pressed={emojiPreference === option.value}
                className={emojiPreference === option.value ? 'active' : ''}
                key={option.value}
                type="button"
                onClick={() => onEmojiPreferenceChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-row">
          <div>
            <strong>Dark Mode</strong>
            <span>Switch the dashboard to a darker color theme.</span>
          </div>
          <input
            aria-label="Dark Mode"
            checked={darkModeEnabled}
            type="checkbox"
            onChange={(event) => onThemeChange(event.currentTarget.checked ? 'dark' : 'light')}
          />
        </label>
        <div className="settings-row settings-integrations-row">
          <div className="settings-integrations-heading">
            <strong>Publishing Integrations</strong>
            <span>Connect fake provider accounts and choose publish targets for the active business.</span>
          </div>

          <div className="settings-integrations-status-row">
            {showPublishingIntegrationsLoading ? <span className="loading-label">Loading integrations</span> : null}
            {publishingIntegrationsNotice ? <span className="settings-integrations-notice">{publishingIntegrationsNotice}</span> : null}
          </div>

          {publishingIntegrationsError ? (
            <div className="photo-library-alert" role="alert">
              {publishingIntegrationsError}
            </div>
          ) : null}

          <div className="publishing-integration-grid">
            <article className="publishing-integration-card">
              <div>
                <strong>Meta Business</strong>
                <span>Facebook Pages + Instagram Professional Accounts</span>
              </div>
              <div className="publishing-integration-targets">
                <span>Fake targets</span>
                {socialTargets.filter((target) => target.provider === 'meta').length > 0 ? (
                  <ul>
                    {socialTargets
                      .filter((target) => target.provider === 'meta')
                      .map((target) => (
                        <li key={target.id}>{target.display_name}</li>
                      ))}
                  </ul>
                ) : (
                  <em>Connect Fake Meta to create fake page and Instagram targets.</em>
                )}
              </div>
              <div className="publishing-integration-actions">
                {metaConnection ? (
                  <>
                    <button type="button" onClick={scrollToAssignments}>
                      Manage/Assign targets
                    </button>
                    <button
                      disabled={publishingIntegrationsBusyAction === `disconnect:${metaConnection.id}`}
                      type="button"
                      onClick={() => void handleDisconnectConnection(metaConnection)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    disabled={publishingIntegrationsBusyAction === 'connect-fake-meta'}
                    type="button"
                    onClick={() => void handleCreateFakeConnection('meta')}
                  >
                    {publishingIntegrationsBusyAction === 'connect-fake-meta' ? 'Connecting...' : 'Connect Fake Meta'}
                  </button>
                )}
              </div>
            </article>

            <article className="publishing-integration-card">
              <div>
                <strong>Google Business Profile</strong>
                <span>Google locations and local posts</span>
              </div>
              <div className="publishing-integration-targets">
                <span>Fake targets</span>
                {socialTargets.filter((target) => target.provider === 'google_business').length > 0 ? (
                  <ul>
                    {socialTargets
                      .filter((target) => target.provider === 'google_business')
                      .map((target) => (
                        <li key={target.id}>{target.display_name}</li>
                      ))}
                  </ul>
                ) : (
                  <em>Connect Fake Google Business to create a fake location target.</em>
                )}
              </div>
              <div className="publishing-integration-actions">
                {googleConnection ? (
                  <>
                    <button type="button" onClick={scrollToAssignments}>
                      Manage/Assign target
                    </button>
                    <button
                      disabled={publishingIntegrationsBusyAction === `disconnect:${googleConnection.id}`}
                      type="button"
                      onClick={() => void handleDisconnectConnection(googleConnection)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    disabled={publishingIntegrationsBusyAction === 'connect-fake-google'}
                    type="button"
                    onClick={() => void handleCreateFakeConnection('google_business')}
                  >
                    {publishingIntegrationsBusyAction === 'connect-fake-google'
                      ? 'Connecting...'
                      : 'Connect Fake Google Business'}
                  </button>
                )}
              </div>
            </article>

            <article className="publishing-integration-card publishing-integration-card-manual">
              <div>
                <strong>Facebook Groups</strong>
                <span>Manual posting assistant only</span>
              </div>
              <p>Use the current copy/share/manual assistant for Facebook Groups. No automatic publish target is created.</p>
              <span className="manual-post-pill">Manual only</span>
            </article>
          </div>

          <div className="publish-target-assignment-panel" id="publish-target-assignments">
            <div className="publish-target-assignment-heading">
              <div>
                <strong>{activeBusiness ? `Assigned targets for ${activeBusiness.name}` : 'Assigned targets'}</strong>
                <span>Each business chooses its own targets from the owner's fake connections.</span>
              </div>
            </div>
            <div className="publish-target-state-grid">
              {publishTargetPlatforms.map((platform) => {
                const assignedTarget = getAssignedTarget(platform);
                return (
                  <div className="publish-target-state-card" key={platform}>
                    <span>{platform}</span>
                    <strong>{assignedTarget ? assignedTarget.display_name : 'Missing'}</strong>
                  </div>
                );
              })}
              <div className="publish-target-state-card publish-target-state-card-manual">
                <span>Facebook Groups</span>
                <strong>Manual only</strong>
              </div>
            </div>
            <div className="publish-target-selector-grid">
              {publishTargetPlatforms.map((platform) => {
                const assignedTarget = getAssignedTarget(platform);
                const platformTargets = getTargetsForPlatform(platform);
                const busy =
                  publishingIntegrationsBusyAction === `assign:${platform}` ||
                  publishingIntegrationsBusyAction === `unassign:${platform}`;
                return (
                  <label className="form-field" key={platform}>
                    <span>{platform}</span>
                    <select
                      disabled={!activeBusinessId || busy || platformTargets.length === 0}
                      value={assignedTarget?.id ?? ''}
                      onChange={(event) => void handleAssignBusinessTarget(platform, event.currentTarget.value)}
                    >
                      <option value="">Missing target</option>
                      {platformTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.display_name}
                        </option>
                      ))}
                    </select>
                    <small>
                      {platformTargets.length === 0
                        ? 'Connect a fake provider first.'
                        : assignedTarget
                          ? 'Assigned for this business.'
                          : 'No target assigned for this business.'}
                    </small>
                    <button
                      disabled={!activeBusinessId || busy || !assignedTarget}
                      type="button"
                      onClick={() => void handleUnassignBusinessTarget(platform)}
                    >
                      Unassign
                    </button>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhotoLibrarySection({
  businessId,
  businessName,
  onNotify,
  onAssetsChange,
  serviceOptions,
}: {
  businessId: string;
  businessName: string;
  onNotify?: (toast: { durationMs?: number; message: string; title?: string; type: ToastType }) => string;
  onAssetsChange?: (assets: PhotoAsset[]) => void;
  serviceOptions: string[];
}) {
  const [photoAssets, setPhotoAssets] = useState<PhotoAsset[]>([]);
  const [photoDraft, setPhotoDraft] = useState<PhotoAssetDraft>(() => createEmptyPhotoAssetDraft());
  const [showPhotoAssetModal, setShowPhotoAssetModal] = useState(false);
  const [editingPhotoAssetId, setEditingPhotoAssetId] = useState<string | null>(null);
  const [pendingDeletePhotoAssetId, setPendingDeletePhotoAssetId] = useState<string | null>(null);
  const [photoAssetBusyAction, setPhotoAssetBusyAction] = useState<'image' | 'save' | 'import' | 'bulk' | 'delete' | null>(null);
  const [photoAssetError, setPhotoAssetError] = useState<string | null>(null);
  const [photoAssetNotice, setPhotoAssetNotice] = useState<string | null>(null);
  const [bulkImportStatus, setBulkImportStatus] = useState<BulkPhotoImportStatus | null>(null);
  const [loadingPhotoAssets, setLoadingPhotoAssets] = useState(true);
  const [localPhotoImportCount, setLocalPhotoImportCount] = useState(() => loadStoredPhotoAssets().length);
  const photoAssetSavingRef = useRef(false);
  const bulkPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const folderPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const loadBackendPhotoAssets = useCallback(async () => {
    if (!businessId) {
      setPhotoAssets([]);
      onAssetsChange?.([]);
      setLoadingPhotoAssets(false);
      setPhotoAssetError(null);
      return;
    }

    setLoadingPhotoAssets(true);
    try {
      const loadedAssets = await listBusinessPhotoAssets(businessId);
      const normalizedAssets = loadedAssets.map(businessPhotoAssetToPhotoAsset);
      setPhotoAssets(normalizedAssets);
      onAssetsChange?.(normalizedAssets);
      setPhotoAssetError(null);
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to load photo assets from the backend.');
    } finally {
      setLoadingPhotoAssets(false);
    }
  }, [businessId, onAssetsChange]);

  useEffect(() => {
    void loadBackendPhotoAssets();
  }, [loadBackendPhotoAssets]);

  useEffect(() => {
    const folderInput = folderPhotoInputRef.current;
    if (!folderInput) return;

    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, []);

  const sortedPhotoAssets = useMemo(() => {
    return [...photoAssets].sort((a, b) => {
      const qualityCompare =
        photoAssetQualityOptions.findIndex((option) => option.value === b.quality) -
        photoAssetQualityOptions.findIndex((option) => option.value === a.quality);
      if (qualityCompare !== 0) return qualityCompare;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [photoAssets]);
  const editingPhotoAsset = editingPhotoAssetId
    ? photoAssets.find((asset) => asset.id === editingPhotoAssetId) ?? null
    : null;
  const pendingDeletePhotoAsset = pendingDeletePhotoAssetId
    ? photoAssets.find((asset) => asset.id === pendingDeletePhotoAssetId) ?? null
    : null;
  const heroAssetCount = photoAssets.filter((asset) => asset.quality === 'hero').length;
  const usedAssetCount = photoAssets.reduce((count, asset) => count + asset.used_count, 0);
  const primaryService = serviceOptions[0]?.trim();
  const futureGenerationMatches = primaryService
    ? selectPhotoAssetsForGeneratedPost(photoAssets, {
        serviceType: primaryService,
      }).length
    : 0;
  const modalBusyAction =
    photoAssetBusyAction === 'image' || photoAssetBusyAction === 'save' ? photoAssetBusyAction : null;

  function openAddPhotoModal() {
    if (!businessId) {
      setPhotoAssetError('Select or create an active business before adding photos.');
      return;
    }
    setPhotoDraft(createEmptyPhotoAssetDraft());
    setEditingPhotoAssetId(null);
    setShowPhotoAssetModal(true);
    setPhotoAssetError(null);
    setPhotoAssetNotice(null);
  }

  function openEditPhotoModal(asset: PhotoAsset) {
    if (!businessId) {
      setPhotoAssetError('Select or create an active business before editing photos.');
      return;
    }
    setPhotoDraft(createPhotoAssetDraft(asset));
    setEditingPhotoAssetId(asset.id);
    setShowPhotoAssetModal(true);
    setPhotoAssetError(null);
    setPhotoAssetNotice(null);
  }

  function closePhotoModal() {
    setShowPhotoAssetModal(false);
    setEditingPhotoAssetId(null);
    setPhotoDraft(createEmptyPhotoAssetDraft());
    setPhotoAssetError(null);
  }

  function updatePhotoDraft<Key extends keyof PhotoAssetDraft>(field: Key, value: PhotoAssetDraft[Key]) {
    setPhotoDraft((current) => ({ ...current, [field]: value }));
  }

  async function handlePhotoFileSelect(files: File[]) {
    const [file] = files;
    if (!file) return;
    if (files.length > 1) {
      closePhotoModal();
      await handleBulkPhotoFiles(files);
      return;
    }

    setPhotoAssetBusyAction('image');
    setPhotoAssetError(null);
    try {
      const imagePayload = await fileToPhotoAssetImage(file);
      setPhotoDraft((current) => ({
        ...current,
        image_data: imagePayload.image_data,
        image_url: null,
        image_filename: imagePayload.image_filename,
        title: current.title || photoTitleFromFilename(file.name),
      }));
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to load this image.');
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleBulkPhotoFiles(files: File[]) {
    if (!businessId) {
      const message = 'Select or create an active business before uploading photos.';
      setPhotoAssetError(message);
      onNotify?.({ message, title: 'Upload disabled', type: 'warning' });
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      const message = 'Choose one or more image files to upload.';
      setPhotoAssetError(message);
      onNotify?.({ message, title: 'No images selected', type: 'warning' });
      return;
    }

    const existingImageReferences = new Set(
      photoAssets
        .map((asset) => normalizeImageReference(getPhotoAssetImageSource(asset)))
        .filter((value): value is string => Boolean(value)),
    );
    const existingFilenames = new Set(
      photoAssets
        .map((asset) => asset.image_filename?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    );
    const seenBatchKeys = new Set<string>();
    const failures: string[] = [];
    const importedAssets: PhotoAsset[] = [];
    let skipped = files.length - imageFiles.length;

    setPhotoAssetBusyAction('bulk');
    setPhotoAssetError(null);
    setBulkImportStatus({ failed: 0, failures: [], imported: 0, skipped, total: files.length });

    try {
      for (const file of imageFiles) {
        const batchKey = photoFileBatchKey(file);
        const normalizedFilename = file.name.trim().toLowerCase();
        if (seenBatchKeys.has(batchKey) || existingFilenames.has(normalizedFilename)) {
          skipped += 1;
          setBulkImportStatus((current) =>
            current ? { ...current, skipped } : { failed: failures.length, failures, imported: importedAssets.length, skipped, total: files.length },
          );
          continue;
        }
        seenBatchKeys.add(batchKey);

        try {
          const imagePayload = await fileToPhotoAssetImage(file);
          const imageReference = normalizeImageReference(imagePayload.image_data);
          if (imageReference && existingImageReferences.has(imageReference)) {
            skipped += 1;
            setBulkImportStatus((current) =>
              current ? { ...current, skipped } : { failed: failures.length, failures, imported: importedAssets.length, skipped, total: files.length },
            );
            continue;
          }

          const savedBusinessAsset = await createBusinessPhotoAsset(
            businessId,
            photoAssetDraftToBusinessPhotoAssetPayload({
              ...createEmptyPhotoAssetDraft(),
              image_data: imagePayload.image_data,
              image_filename: imagePayload.image_filename,
              title: photoTitleFromFilename(file.name),
            }),
          );
          const savedAsset = businessPhotoAssetToPhotoAsset(savedBusinessAsset);
          importedAssets.push(savedAsset);
          existingFilenames.add(normalizedFilename);
          const savedReference = normalizeImageReference(getPhotoAssetImageSource(savedAsset));
          if (savedReference) existingImageReferences.add(savedReference);
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Unable to import this photo.'}`);
        }

        setBulkImportStatus((current) =>
          current
            ? { ...current, failed: failures.length, failures: failures.slice(0, 5), imported: importedAssets.length, skipped }
            : { failed: failures.length, failures: failures.slice(0, 5), imported: importedAssets.length, skipped, total: files.length },
        );
      }

      if (importedAssets.length > 0) {
        setPhotoAssets((currentAssets) => {
          const nextAssets = [...importedAssets, ...currentAssets];
          onAssetsChange?.(nextAssets);
          return nextAssets;
        });
      }

      const messageParts = [`Imported ${importedAssets.length} photo${importedAssets.length === 1 ? '' : 's'}`];
      if (skipped > 0) messageParts.push(`skipped ${skipped}`);
      if (failures.length > 0) messageParts.push(`failed ${failures.length}`);
      const message = `${messageParts.join(', ')}.`;
      setPhotoAssetNotice(message);
      onNotify?.({
        message,
        title: failures.length > 0 ? 'Photo import completed with issues' : 'Photos imported',
        type: failures.length > 0 ? 'warning' : 'success',
      });
      if (failures.length > 0 && importedAssets.length === 0) {
        setPhotoAssetError(failures.slice(0, 3).join(' '));
      }
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  function handleBulkPhotoInputChange(event: ReactChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void handleBulkPhotoFiles(files);
  }

  async function handleSavePhotoAsset() {
    if (photoAssetSavingRef.current || photoAssetBusyAction === 'save') return;

    if (!businessId) {
      setPhotoAssetError('Select or create an active business before saving photos.');
      return;
    }

    const title = photoDraft.title.trim();
    if (!title) {
      setPhotoAssetError('Photo title is required.');
      return;
    }
    if (!getPhotoAssetImageSource(photoDraft)) {
      setPhotoAssetError('Please upload an image for this photo asset.');
      return;
    }

    const existingAsset = editingPhotoAsset;
    const payload = photoAssetDraftToBusinessPhotoAssetPayload({
      ...photoDraft,
      title,
      description: photoDraft.description.trim(),
      service_type: photoDraft.service_type.trim(),
      location: photoDraft.location.trim(),
    });

    setPhotoAssetBusyAction('save');
    setPhotoAssetError(null);
    photoAssetSavingRef.current = true;
    try {
      const savedBusinessAsset = await createBusinessPhotoAsset(businessId, payload);
      const savedAsset = businessPhotoAssetToPhotoAsset(savedBusinessAsset);
      if (existingAsset) {
        await deleteBusinessPhotoAsset(businessId, existingAsset.id);
      }
      setPhotoAssets((currentAssets) => {
        const nextAssets = existingAsset
          ? currentAssets.map((asset) => (asset.id === existingAsset.id ? savedAsset : asset))
          : [savedAsset, ...currentAssets];
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      const message = existingAsset ? 'Photo asset updated.' : 'Photo asset added to the library.';
      setPhotoAssetNotice(message);
      onNotify?.({ message, title: existingAsset ? 'Photo updated' : 'Photo added', type: 'success' });
      closePhotoModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save this photo asset.';
      setPhotoAssetError(message);
      onNotify?.({ message, title: 'Photo save failed', type: 'error' });
    } finally {
      photoAssetSavingRef.current = false;
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleConfirmDeletePhotoAsset() {
    if (!pendingDeletePhotoAsset) return;
    if (!businessId) {
      setPhotoAssetError('Select or create an active business before deleting photos.');
      return;
    }

    setPhotoAssetBusyAction('delete');
    setPhotoAssetError(null);
    try {
      await deleteBusinessPhotoAsset(businessId, pendingDeletePhotoAsset.id);
      setPhotoAssets((currentAssets) => {
        const nextAssets = currentAssets.filter((asset) => asset.id !== pendingDeletePhotoAsset.id);
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      setPhotoAssetNotice('Photo asset deleted.');
      onNotify?.({ message: 'Photo asset deleted.', title: 'Photo deleted', type: 'success' });
      setPendingDeletePhotoAssetId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete this photo asset.';
      setPhotoAssetError(message);
      onNotify?.({ message, title: 'Photo delete failed', type: 'error' });
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleImportStoredPhotoAssets() {
    if (!businessId) {
      setPhotoAssetError('Select or create an active business before importing local photos.');
      return;
    }

    const storedPayloads = loadStoredPhotoAssets();
    if (storedPayloads.length === 0) {
      setLocalPhotoImportCount(0);
      setPhotoAssetNotice('No local Photo Library assets were found to import.');
      return;
    }

    const existingImageReferences = new Set(
      photoAssets
        .map((asset) => normalizeImageReference(getPhotoAssetImageSource(asset)))
        .filter((value): value is string => Boolean(value)),
    );
    const importablePayloads = storedPayloads.filter((payload) => {
      const imageSource = payload.image_data || payload.image_url;
      if (!imageSource) return false;
      const imageReference = normalizeImageReference(imageSource);
      return !imageReference || !existingImageReferences.has(imageReference);
    });

    if (importablePayloads.length === 0) {
      setPhotoAssetNotice('No importable local photos remain for this active business.');
      return;
    }

    setPhotoAssetBusyAction('import');
    setPhotoAssetError(null);
    try {
      const importedBusinessAssets = await Promise.all(
        importablePayloads.map((payload) =>
          createBusinessPhotoAsset(businessId, photoAssetPayloadToBusinessPhotoAssetPayload(payload)),
        ),
      );
      const importedAssets = importedBusinessAssets.map(businessPhotoAssetToPhotoAsset);
      setPhotoAssets((currentAssets) => {
        const nextAssets = [...importedAssets, ...currentAssets];
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      window.localStorage.removeItem(photoLibraryStorageKey);
      setLocalPhotoImportCount(0);
      const skippedCount = storedPayloads.length - importablePayloads.length;
      const message =
        skippedCount > 0
          ? `Imported ${importedAssets.length} photo assets. Skipped ${skippedCount} assets without image data.`
          : `Imported ${importedAssets.length} photo assets into backend storage.`;
      setPhotoAssetNotice(message);
      onNotify?.({ message, title: 'Photos imported', type: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to import local Photo Library assets.';
      setPhotoAssetError(message);
      onNotify?.({ message, title: 'Photo import failed', type: 'error' });
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  return (
    <section className="panel photo-library-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Photo Library</h2>
          <p>
            {businessId
              ? `Reusable ${businessName || 'business'} project photos for content planning and weekly generation.`
              : 'Select or create an active business before adding Photo Library metadata.'}
          </p>
        </div>
        <div className="panel-heading-actions">
          <input
            accept="image/*"
            className="photo-bulk-input"
            multiple
            ref={bulkPhotoInputRef}
            type="file"
            onChange={handleBulkPhotoInputChange}
          />
          <input
            accept="image/*"
            className="photo-bulk-input"
            multiple
            ref={folderPhotoInputRef}
            type="file"
            onChange={handleBulkPhotoInputChange}
          />
          {localPhotoImportCount > 0 ? (
            <button
              className="secondary-button"
              disabled={photoAssetBusyAction !== null || !businessId}
              type="button"
              onClick={() => void handleImportStoredPhotoAssets()}
            >
              {photoAssetBusyAction === 'import' ? 'Importing...' : `Import ${localPhotoImportCount} Local`}
            </button>
          ) : null}
          <button
            className="secondary-button"
            disabled={!businessId || photoAssetBusyAction !== null}
            type="button"
            onClick={() => bulkPhotoInputRef.current?.click()}
          >
            {photoAssetBusyAction === 'bulk' ? 'Uploading...' : 'Upload photos'}
          </button>
          <button
            className="secondary-button"
            disabled={!businessId || photoAssetBusyAction !== null}
            type="button"
            onClick={() => folderPhotoInputRef.current?.click()}
          >
            Import folder
          </button>
          <button className="secondary-button" disabled={!businessId} type="button" onClick={openAddPhotoModal}>
            Add Photo
          </button>
        </div>
      </div>

      {photoAssetError ? (
        <div className="photo-library-alert" role="alert">
          {photoAssetError}
        </div>
      ) : null}
      {photoAssetNotice ? <div className="photo-library-notice">{photoAssetNotice}</div> : null}
      {bulkImportStatus ? (
        <div className="photo-library-bulk-status" role="status">
          <strong>
            Imported {bulkImportStatus.imported} of {bulkImportStatus.total} selected photo
            {bulkImportStatus.total === 1 ? '' : 's'}.
          </strong>
          <span>
            {bulkImportStatus.skipped > 0 ? `${bulkImportStatus.skipped} skipped. ` : ''}
            {bulkImportStatus.failed > 0 ? `${bulkImportStatus.failed} failed.` : ''}
          </span>
          {bulkImportStatus.failures.length > 0 ? (
            <ul>
              {bulkImportStatus.failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!businessId ? (
        <div className="photo-library-empty">
          <strong>No active business selected.</strong>
          <span>Create or select a business above to load, import, add, or delete business-scoped photos.</span>
        </div>
      ) : loadingPhotoAssets ? (
        <div className="photo-library-empty">
          <strong>Loading backend photo assets...</strong>
          <span>Gomez Ops is reading the saved Photo Library for {businessName || 'this business'}.</span>
        </div>
      ) : sortedPhotoAssets.length > 0 ? (
        <div className="photo-library-grid">
          {sortedPhotoAssets.map((asset) => {
            const imageSource = getPhotoAssetPreviewUrl(asset);
            return (
              <article className="photo-asset-card" key={asset.id}>
                <div className="photo-asset-preview">
                  {imageSource ? <img alt={asset.title} src={imageSource} /> : <span>No image</span>}
                  <span className={`photo-quality-badge photo-quality-${asset.quality}`}>
                    {getPhotoAssetQualityLabel(asset.quality)}
                  </span>
                </div>
                <div className="photo-asset-body">
                  <div className="photo-asset-title-row">
                    <div>
                      <h3>{asset.title}</h3>
                      <span>{asset.category}</span>
                    </div>
                    <em>{asset.used_count} used</em>
                  </div>
                  {asset.description ? <p>{asset.description}</p> : null}
                  <div className="photo-asset-meta">
                    {asset.service_type ? <span>{asset.service_type}</span> : null}
                    {asset.location ? <span>{asset.location}</span> : null}
                    <span>Updated {formatPhotoAssetDate(asset.updated_at)}</span>
                  </div>
                  {asset.tags.length > 0 ? (
                    <div className="photo-tag-row" aria-label="Photo tags">
                      {asset.tags.map((tag) => (
                        <span key={`${asset.id}:${tag}`}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="photo-asset-actions">
                    <button type="button" onClick={() => openEditPhotoModal(asset)}>
                      Edit
                    </button>
                    <button className="danger-button" type="button" onClick={() => setPendingDeletePhotoAssetId(asset.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="photo-library-empty">
          <strong>Upload project photos to give Gomez Ops reusable assets for generated posts.</strong>
          <span>Add finished projects, before/after shots, work-in-progress photos, and team photos with service tags.</span>
          <button className="secondary-button" type="button" onClick={openAddPhotoModal}>
            Add Photo
          </button>
        </div>
      )}

      {showPhotoAssetModal ? (
        <PhotoAssetModal
          busyAction={modalBusyAction}
          draft={photoDraft}
          editing={Boolean(editingPhotoAsset)}
          error={photoAssetError}
          serviceOptions={serviceOptions}
          onCancel={closePhotoModal}
          onChange={updatePhotoDraft}
          onFileSelect={handlePhotoFileSelect}
          onSave={() => void handleSavePhotoAsset()}
        />
      ) : null}
      {pendingDeletePhotoAsset ? (
        <DeletePhotoAssetConfirmModal
          asset={pendingDeletePhotoAsset}
          busy={photoAssetBusyAction === 'delete'}
          onCancel={() => setPendingDeletePhotoAssetId(null)}
          onConfirm={() => void handleConfirmDeletePhotoAsset()}
        />
      ) : null}
    </section>
  );
}

function PhotoAssetModal({
  busyAction,
  draft,
  editing,
  error,
  serviceOptions,
  onCancel,
  onChange,
  onFileSelect,
  onSave,
}: {
  busyAction: 'image' | 'save' | null;
  draft: PhotoAssetDraft;
  editing: boolean;
  error: string | null;
  serviceOptions: string[];
  onCancel: () => void;
  onChange: <Key extends keyof PhotoAssetDraft>(field: Key, value: PhotoAssetDraft[Key]) => void;
  onFileSelect: (files: File[]) => Promise<void>;
  onSave: () => void;
}) {
  const photoAssetFormId = 'photo-asset-modal-form';

  return (
    <StandardModal
      className="photo-asset-modal"
      labelledBy="photo-asset-modal-title"
      title={editing ? 'Edit Photo Asset' : 'Add Photo Asset'}
      description="Store reusable photo context for future post generation and campaign planning."
      onClose={onCancel}
      actions={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="secondary-button"
            disabled={busyAction === 'save' || busyAction === 'image'}
            form={photoAssetFormId}
            type="submit"
          >
            {busyAction === 'save' ? 'Saving...' : 'Save Photo'}
          </button>
        </>
      }
    >
      {error ? (
        <div className="photo-asset-modal-error" role="alert">
          {error}
        </div>
      ) : null}

      <PhotoAssetForm
        busyAction={busyAction}
        draft={draft}
        editing={editing}
        formId={photoAssetFormId}
        serviceOptions={serviceOptions}
        onChange={onChange}
        onFileSelect={onFileSelect}
        onSave={onSave}
      />
    </StandardModal>
  );
}

function PhotoAssetForm({
  busyAction,
  draft,
  editing,
  formId,
  serviceOptions,
  onChange,
  onFileSelect,
  onSave,
}: {
  busyAction: 'image' | 'save' | null;
  draft: PhotoAssetDraft;
  editing: boolean;
  formId: string;
  serviceOptions: string[];
  onChange: <Key extends keyof PhotoAssetDraft>(field: Key, value: PhotoAssetDraft[Key]) => void;
  onFileSelect: (files: File[]) => Promise<void>;
  onSave: () => void;
}) {
  const imageSource = getPhotoAssetPreviewUrl(draft);

  return (
    <form
      className="photo-asset-form"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="photo-asset-preview-panel">
        <div className="photo-upload-preview">
          {imageSource ? <img alt={draft.title || 'Selected photo asset'} src={imageSource} /> : <span>No image selected</span>}
        </div>
        <label className="form-field">
          <span>Image file</span>
          <input
            accept="image/*"
            multiple
            type="file"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void onFileSelect(files);
            }}
          />
          <small>
            {busyAction === 'image'
              ? 'Preparing image preview...'
              : editing
                ? 'Current image is retained unless a new file is selected.'
                : 'File uploads are saved as metadata previews until Supabase Storage is wired.'}
          </small>
        </label>
        <label className="form-field">
          <span>Image URL</span>
          <input
            placeholder="https://..."
            value={draft.image_url ?? ''}
            onChange={(event) => {
              onChange('image_url', event.target.value || null);
              onChange('image_data', null);
              onChange('image_path', null);
            }}
          />
          <small>Use a public URL for durable production photos.</small>
        </label>
      </div>
      <div className="photo-asset-fields">
        <label className="form-field">
          <span>Title</span>
          <input value={draft.title} onChange={(event) => onChange('title', event.target.value)} />
        </label>
        <label className="form-field">
          <span>Category</span>
          <select value={draft.category} onChange={(event) => onChange('category', event.target.value as PhotoAssetCategory)}>
            {photoAssetCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Service type</span>
          <input
            list="photo-service-options"
            value={draft.service_type}
            onChange={(event) => onChange('service_type', event.target.value)}
          />
          <datalist id="photo-service-options">
            {serviceOptions.map((service) => (
              <option key={service} value={service} />
            ))}
          </datalist>
        </label>
        <label className="form-field">
          <span>Location / city</span>
          <input value={draft.location} onChange={(event) => onChange('location', event.target.value)} />
        </label>
        <label className="form-field">
          <span>Quality / usefulness</span>
          <select value={draft.quality} onChange={(event) => onChange('quality', event.target.value as PhotoAssetQuality)}>
            {photoAssetQualityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field form-field-wide">
          <span>Tags</span>
          <input
            placeholder="kitchen, neutral colors, oak park"
            value={draft.tagsText}
            onChange={(event) => onChange('tagsText', event.target.value)}
          />
        </label>
        <label className="form-field form-field-wide">
          <span>Description / context</span>
          <textarea
            value={draft.description}
            onChange={(event) => onChange('description', event.target.value)}
            placeholder="What makes this photo useful for future posts?"
          />
        </label>
      </div>
    </form>
  );
}

function DeletePhotoAssetConfirmModal({
  asset,
  busy,
  onCancel,
  onConfirm,
}: {
  asset: PhotoAsset;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <StandardModal
      className="delete-confirm-modal"
      labelledBy="delete-photo-asset-title"
      title="Delete this photo?"
      description={asset.title}
      onClose={onCancel}
      actions={
        <>
          <button disabled={busy} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" disabled={busy} type="button" onClick={onConfirm}>
            {busy ? 'Deleting...' : 'Delete Photo'}
          </button>
        </>
      }
    >
      <p className="delete-confirm-message">
        This will remove the photo asset from backend storage. Generated posts that already reference images are not changed.
      </p>
    </StandardModal>
  );
}

function CalendarTrashDropZone({ active }: { active: boolean }) {
  return (
    <div
      className={`calendar-trash-zone ${active ? 'calendar-trash-zone-active' : ''}`}
      data-calendar-trash-zone="true"
      role="button"
      aria-label="Drop content slot here to delete it"
      aria-live="polite"
    >
      <Icon name="trash" />
      <div>
        <strong>Drop to delete</strong>
        <span>Confirmation required</span>
      </div>
    </div>
  );
}

function CalendarDragPreview({ drag, slot }: { drag: CalendarDragState; slot: ContentSlot | null }) {
  if (!slot) return null;

  const isTouchDrag = drag.pointerType !== 'mouse';
  const previewScale = isTouchDrag ? 0.86 : 0.9;
  const previewWidth = drag.sourceWidth * previewScale;
  const previewHeight = drag.sourceHeight * previewScale;
  const viewportWidth = typeof window === 'undefined' ? drag.sourceWidth : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? drag.sourceHeight : window.innerHeight;
  const rawX = isTouchDrag ? drag.currentX - previewWidth / 2 : drag.currentX - drag.grabOffsetX * previewScale;
  const rawY = isTouchDrag ? drag.currentY - previewHeight - 18 : drag.currentY - drag.grabOffsetY * previewScale;
  const previewX = Math.max(8, Math.min(rawX, viewportWidth - previewWidth - 8));
  const previewY = Math.max(8, Math.min(rawY, viewportHeight - previewHeight - 8));

  const preview = (
    <div
      className="calendar-drag-preview"
      style={{
        height: drag.sourceHeight,
        transform: `translate3d(${previewX}px, ${previewY}px, 0) scale(${previewScale})`,
        width: drag.sourceWidth,
      }}
      aria-hidden="true"
    >
      <div className="content-slot-media">
        {slot.imageSource ? <img alt="" src={getMediaUrl(slot.imageSource)} /> : <span>No image</span>}
      </div>
      <div className="content-slot-body">
        <div className="content-slot-title-row">
          <h3>{slot.title}</h3>
          <span className="content-type-pill">{slot.contentType}</span>
        </div>
        <div className="content-slot-meta">
          <span>{slot.business}</span>
          <span>{formatDisplayDate(slot.scheduledAt)}</span>
        </div>
      </div>
      <div className="content-slot-drag-affordance" data-calendar-drag-handle="true" />
    </div>
  );

  return typeof document === 'undefined' ? preview : createPortal(preview, document.body);
}

function DeleteContentSlotConfirmModal({
  slot,
  onCancel,
  onConfirm,
}: {
  slot: ContentSlot;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useBodyScrollLock();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-content-slot-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="delete-content-slot-title">Delete this post?</h2>
            <p>{slot.title}</p>
          </div>
        </div>
        <p className="delete-confirm-message">
          This will remove the content slot and its platform posts from the weekly calendar.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Delete Post
          </button>
        </div>
      </section>
    </div>
  );
}

function StandardModal({
  actions,
  children,
  className = '',
  description,
  labelledBy,
  onClose,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  labelledBy: string;
  onClose: () => void;
  title: string;
}) {
  useBodyScrollLock();
  const backdropPointerStartedRef = useRef(false);

  const modal = (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        backdropPointerStartedRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPointerStartedRef.current && event.target === event.currentTarget) {
          onClose();
        }
        backdropPointerStartedRef.current = false;
      }}
    >
      <section
        className={`modal-panel standard-modal ${className}`}
        data-interactive="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onPointerDown={(event) => {
          backdropPointerStartedRef.current = false;
          event.stopPropagation();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="standard-modal-header">
          <div>
            <h2 id={labelledBy}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="standard-modal-body">{children}</div>
        {actions ? <div className="standard-modal-actions">{actions}</div> : null}
      </section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}

function ToastViewport({ toasts, onDismiss }: { toasts: AppToast[]; onDismiss: (toastId: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: AppToast; onDismiss: (toastId: string) => void }) {
  useEffect(() => {
    if (toast.exiting) return undefined;
    const timeoutId = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [onDismiss, toast.durationMs, toast.exiting, toast.id]);

  const title = toast.title ?? toast.type.charAt(0).toUpperCase() + toast.type.slice(1);

  return (
    <section
      className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exiting' : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      style={{ '--toast-duration': `${toast.durationMs}ms` } as CSSProperties & Record<'--toast-duration', string>}
    >
      <div className="toast-accent" aria-hidden="true" />
      <div className="toast-content">
        <div className="toast-heading">
          <strong>{title}</strong>
          <button aria-label="Dismiss notification" type="button" onClick={() => onDismiss(toast.id)}>
            <Icon name="x" />
          </button>
        </div>
        <p>{toast.message}</p>
      </div>
      <div className="toast-progress" aria-hidden="true" />
    </section>
  );
}

function BusinessSelector({
  activeBusiness,
  activeBusinessId,
  businesses,
  creating,
  draft,
  loading,
  onCreate,
  onDraftChange,
  onSelect,
}: {
  activeBusiness: Business | null;
  activeBusinessId: string;
  businesses: Business[];
  creating: boolean;
  draft: BusinessCreateDraft;
  loading: boolean;
  onCreate: () => void;
  onDraftChange: (draft: BusinessCreateDraft) => void;
  onSelect: (businessId: string) => void;
}) {
  return (
    <section className="business-selector-bar" aria-label="Active business">
      <div className="business-selector-current">
        <span>Active business</span>
        <strong>{activeBusiness?.name ?? (loading ? 'Loading...' : 'None selected')}</strong>
        {activeBusiness ? (
          <small>{[activeBusiness.industry, activeBusiness.location].filter(Boolean).join(' / ') || 'Business scoped'}</small>
        ) : (
          <small>Saved generated posts require a business.</small>
        )}
      </div>
      <label className="form-field business-selector-select">
        <span>Switch business</span>
        <select
          disabled={loading || businesses.length === 0}
          value={activeBusinessId}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">No business selected</option>
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
      </label>
      <div className="business-create-fields">
        <label className="form-field">
          <span>Name</span>
          <input
            placeholder="Business name"
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Industry</span>
          <input
            placeholder="Painting"
            value={draft.industry}
            onChange={(event) => onDraftChange({ ...draft, industry: event.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Location</span>
          <input
            placeholder="Chicago, IL"
            value={draft.location}
            onChange={(event) => onDraftChange({ ...draft, location: event.target.value })}
          />
        </label>
        <button disabled={creating || !draft.name.trim()} type="button" onClick={onCreate}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </section>
  );
}

function SavedGeneratedPostsSection({
  activeBusiness,
  filter,
  loading,
  posts,
  onFilterChange,
}: {
  activeBusiness: Business | null;
  filter: SavedGeneratedPostFilter;
  loading: boolean;
  posts: GeneratedPost[];
  onFilterChange: (filter: SavedGeneratedPostFilter) => void;
}) {
  const filters: SavedGeneratedPostFilter[] = ['all', 'reach', 'review', 'intro', 'recent-work'];

  return (
    <section className="saved-posts-section" aria-labelledby="saved-posts-title">
      <div className="saved-posts-heading">
        <div>
          <h3 id="saved-posts-title">Saved Posts</h3>
          <p>{activeBusiness ? activeBusiness.name : 'Select a business to load saved posts.'}</p>
        </div>
        {loading ? <span className="loading-label">Loading</span> : null}
      </div>
      <div className="saved-post-filter-row" role="group" aria-label="Filter saved posts">
        {filters.map((option) => (
          <button
            className={filter === option ? 'secondary-button saved-post-filter-active' : 'secondary-button'}
            key={option}
            type="button"
            onClick={() => onFilterChange(option)}
          >
            {option === 'all' ? 'All' : generatedPostToolLabel(option)}
          </button>
        ))}
      </div>
      {posts.length > 0 ? (
        <div className="saved-post-list">
          {posts.map((post) => (
            <article className="saved-post-item" key={post.id}>
              <div className="saved-post-item-heading">
                <div>
                  <span>{generatedPostToolLabel(post.tool_type)}</span>
                  <h4>{post.title || 'Untitled saved post'}</h4>
                </div>
                <small>{formatGeneratedPostDate(post.created_at)}</small>
              </div>
              <div className="saved-post-meta">
                {post.platform ? <span>{post.platform}</span> : null}
                <span>{post.status}</span>
              </div>
              <p>{post.content}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-cell">
          {activeBusiness ? 'No saved posts for this filter yet.' : 'No active business selected.'}
        </div>
      )}
    </section>
  );
}

function VisibilityToolModal({
  copied,
  error,
  formData,
  generating,
  saving,
  output,
  photoAssets,
  photoAsset,
  profile,
  tool,
  enabledDestinations,
  onCancel,
  onChange,
  onCopy,
  onGenerate,
  onRefine,
  onSave,
  onOutputChange,
}: {
  copied: boolean;
  error: string | null;
  formData: VisibilityToolFormData;
  generating: boolean;
  saving: boolean;
  output: VisibilityGenerationResponse | null;
  photoAssets: PhotoAsset[];
  photoAsset: PhotoAsset | null;
  profile: BusinessProfile;
  tool: VisibilityToolCard;
  enabledDestinations: LocalReachDestination[];
  onCancel: () => void;
  onChange: (field: keyof VisibilityToolFormData, value: string | string[]) => void;
  onCopy: () => void;
  onGenerate: () => void;
  onRefine: (refinement: VisibilityRefinement) => void;
  onSave: () => void;
  onOutputChange: (output: string) => void;
}) {
  const serviceOptions = profile.services_offered.filter((service) => service.trim());
  const locationOptions = profile.service_area_cities.filter((location) => location.trim());
  const supportsPhoto = visibilityToolSupportsPhoto(tool.id);
  const serviceListId = `visibility-services-${tool.id}`;
  const locationListId = `visibility-locations-${tool.id}`;
  const selectedPhotoLabel = photoAsset
    ? [photoAsset.title, photoAsset.service_type, photoAsset.location].filter(Boolean).join(' - ')
    : '';
  const localReachDestinations = enabledDestinations.length > 0 ? enabledDestinations : localReachDestinationOptions;
  const supportsSaving = Boolean(visibilityToolTypeForPost(tool.id));
  const hasOutput = Boolean(formatVisibilityResponseForCopy(output).trim());
  const reviewToneOptions = ['Friendly', 'Professional', 'Short'];
  const readableOutput = output?.primary ?? '';
  const photoSelectionLabel = tool.id === 'recent-work-post' ? 'Select photo/project' : 'Choose a photo to include';

  function renderChoiceChips<T extends string>(
    label: string,
    value: T | string,
    options: T[],
    onSelect: (nextValue: T) => void,
  ) {
    return (
      <fieldset className="visibility-choice-group">
        <legend>{label}</legend>
        <div className="visibility-chip-row">
          {options.map((option) => (
            <button
              aria-pressed={value === option}
              className={`choice-chip ${value === option ? 'choice-chip-active' : ''}`}
              key={option}
              type="button"
              onClick={() => onSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  function renderPhotoSelector(label: string) {
    return (
      <fieldset className="photo-selector-field">
        <legend>{label}</legend>
        {photoAssets.length > 0 ? (
          <div className="photo-selector-grid">
            {photoAssets.map((asset) => {
              const previewUrl = getPhotoAssetPreviewUrl(asset);
              const assetLabel = [asset.title, asset.service_type, asset.location].filter(Boolean).join(' - ');
              return (
                <button
                  aria-pressed={formData.photoAssetId === asset.id}
                  className={`photo-selector-card ${formData.photoAssetId === asset.id ? 'photo-selector-card-active' : ''}`}
                  key={asset.id}
                  type="button"
                  onClick={() => onChange('photoAssetId', formData.photoAssetId === asset.id ? '' : asset.id)}
                >
                  {previewUrl ? <img alt="" src={previewUrl} /> : <span className="photo-selector-placeholder">Photo</span>}
                  <span>{assetLabel || 'Photo asset'}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-cell">No photo assets available yet.</p>
        )}
        {selectedPhotoLabel ? <small>{selectedPhotoLabel}</small> : null}
      </fieldset>
    );
  }

  return (
    <section className="visibility-tool-workbench" aria-labelledby="visibility-tool-title">
      <div className="visibility-workbench-heading">
        <div>
          <h2 id="visibility-tool-title">{tool.title}</h2>
          <p>{tool.description}</p>
        </div>
        {tool.id === 'local-reach-post' && formData.destination === 'Facebook Group' ? (
          <span className="manual-post-pill">Manual posting only</span>
        ) : null}
      </div>

        <datalist id={serviceListId}>
          {serviceOptions.map((service) => (
            <option key={service} value={service} />
          ))}
        </datalist>
        <datalist id={locationListId}>
          {locationOptions.map((location) => (
            <option key={location} value={location} />
          ))}
        </datalist>

        <div className="visibility-tool-form">
          {tool.id === 'local-reach-post' ? (
            <>
              {renderChoiceChips('Where do you want to post this?', formData.destination, localReachDestinations, (destination) =>
                onChange('destination', destination),
              )}
              <div className="visibility-form-section">
                <h3>What should the post focus on?</h3>
              </div>
              <label className="form-field">
                <span>Service</span>
                <input
                  list={serviceListId}
                  value={formData.serviceFocus}
                  onChange={(event) => onChange('serviceFocus', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Area</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Anything specific to mention?</span>
                <textarea
                  value={formData.notes}
                  onChange={(event) => onChange('notes', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tool.id === 'recent-work-post' ? (
            <>
              {supportsPhoto ? renderPhotoSelector(photoSelectionLabel) : null}
              <label className="form-field">
                <span>Service</span>
                <input
                  list={serviceListId}
                  value={formData.serviceFocus}
                  onChange={(event) => onChange('serviceFocus', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Area</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>What was done?</span>
                <textarea
                  value={formData.notes}
                  onChange={(event) => onChange('notes', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tool.id === 'review-request' ? (
            <>
              <label className="form-field">
                <span>Customer name</span>
                <input
                  placeholder="Optional"
                  value={formData.customerName}
                  onChange={(event) => onChange('customerName', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Job/service completed</span>
                <input
                  list={serviceListId}
                  value={formData.jobCompleted}
                  onChange={(event) => onChange('jobCompleted', event.target.value)}
                />
              </label>
              {renderChoiceChips('Tone', formData.tone, reviewToneOptions, (tone) => onChange('tone', tone))}
              <label className="form-field form-field-wide">
                <span>Review link</span>
                <input
                  placeholder="Optional Google review link"
                  value={formData.reviewLink}
                  onChange={(event) => onChange('reviewLink', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tool.id === 'business-intro-post' ? (
            <>
              <label className="form-field">
                <span>Area/community</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Main services</span>
                <input
                  value={formData.servicesToMention}
                  onChange={(event) => onChange('servicesToMention', event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>What makes the business trustworthy or different?</span>
                <textarea
                  value={formData.businessBackground}
                  onChange={(event) => onChange('businessBackground', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {supportsPhoto && tool.id === 'local-reach-post' ? (
            renderPhotoSelector('Choose a photo to include')
          ) : null}

          <details className="visibility-advanced-options">
            <summary>Advanced options</summary>
            <div className="visibility-advanced-grid">
              {tool.id !== 'review-request'
                ? renderChoiceChips('Tone', formData.tone, localReachToneOptions, (tone) => onChange('tone', tone))
                : null}
              {tool.id === 'recent-work-post' || tool.id === 'business-intro-post'
                ? renderChoiceChips('Post destination', formData.destination, localReachDestinations, (destination) =>
                    onChange('destination', destination),
                  )
                : null}
              <label className="form-field">
                <span>CTA override</span>
                <input value={formData.cta} onChange={(event) => onChange('cta', event.target.value)} />
              </label>
              <label className="form-field">
                <span>Post type</span>
                <select value={formData.postType} onChange={(event) => onChange('postType', event.target.value)}>
                  {localReachPostTypeOptions.map((postType) => (
                    <option key={postType}>{postType}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Goal</span>
                <select value={formData.goal} onChange={(event) => onChange('goal', event.target.value)}>
                  {localReachGoalOptions.map((goal) => (
                    <option key={goal}>{goal}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>

        {error ? (
          <div className="photo-library-alert" role="alert">
            {error}
          </div>
        ) : null}

        <div className="modal-actions visibility-tool-actions">
          <button type="button" onClick={onCancel}>
            Reset
          </button>
          <button className="secondary-button" disabled={generating} type="button" onClick={onGenerate}>
            {generating ? 'Generating...' : hasOutput ? 'Regenerate' : 'Generate Copy'}
          </button>
        </div>

        <section className="visibility-output-preview">
          <div className="visibility-output-heading">
            <span>Generated Copy</span>
            {output?.generationMode ? (
              <em className={`generation-mode-badge generation-mode-${output.generationMode}`}>
                {output.generationMode === 'llm' ? 'AI generated' : 'Fallback generated'}
              </em>
            ) : null}
            <div className="visibility-output-actions">
              <button disabled={!hasOutput} type="button" onClick={onCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              {supportsSaving ? (
                <button disabled={generating || saving || !hasOutput} type="button" onClick={onSave}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              ) : null}
              <button className="secondary-button" disabled={generating} type="button" onClick={onGenerate}>
                {generating ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </div>
          {output ? (
            <div className="visibility-output-sections">
              <label className="form-field form-field-wide visibility-primary-output">
                <textarea value={readableOutput} onChange={(event) => onOutputChange(event.target.value)} />
              </label>
              <div className="visibility-refinement-row" role="group" aria-label="Quick refinements">
                <button disabled={generating} type="button" onClick={() => onRefine('shorter')}>
                  Make shorter
                </button>
                <button disabled={generating} type="button" onClick={() => onRefine('friendlier')}>
                  Make friendlier
                </button>
                <button disabled={generating} type="button" onClick={() => onRefine('professional')}>
                  Make more professional
                </button>
                <button disabled={generating} type="button" onClick={() => onRefine('stronger-cta')}>
                  Add stronger CTA
                </button>
              </div>
              {output.shortVersion ? (
                <div className="visibility-output-block">
                  <strong>Short version</strong>
                  <p>{output.shortVersion}</p>
                </div>
              ) : null}
              {output.ctaLine ? (
                <div className="visibility-output-block">
                  <strong>CTA line</strong>
                  <p>{output.ctaLine}</p>
                </div>
              ) : null}
              {output.titles?.length ? (
                <div className="visibility-output-block">
                  <strong>Titles</strong>
                  <ul>
                    {output.titles.map((title) => (
                      <li key={title}>{title}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {output.hashtagsOrKeywords?.length ? (
                <div className="visibility-output-block">
                  <strong>Hashtags/keywords</strong>
                  <ul>
                    {output.hashtagsOrKeywords.map((keyword) => (
                      <li key={keyword}>{keyword}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {output.imageSuggestions?.length ? (
                <div className="visibility-output-block">
                  <strong>Image suggestions</strong>
                  <ul>
                    {output.imageSuggestions.map((suggestion) => (
                      <li key={suggestion}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p>Generated copy will appear here after you fill the form and click Generate.</p>
          )}
        </section>
    </section>
  );
}

function WeeklyScheduleModal({
  busy,
  settings,
  onCancel,
  onChange,
  onGenerate,
}: {
  busy: boolean;
  settings: WeeklyScheduleSettings;
  onCancel: () => void;
  onChange: (settings: WeeklyScheduleSettings) => void;
  onGenerate: (settings: WeeklyScheduleSettings) => void;
}) {
  useBodyScrollLock();

  function updateSettings(update: Partial<WeeklyScheduleSettings>) {
    onChange({ ...settings, ...update });
  }

  function togglePlatform(platform: WeeklySchedulePlatform) {
    updateSettings({
      platforms: settings.platforms.includes(platform)
        ? settings.platforms.filter((currentPlatform) => currentPlatform !== platform)
        : [...settings.platforms, platform],
    });
  }

  function toggleContentType(contentType: string) {
    updateSettings({
      contentTypes: settings.contentTypes.includes(contentType)
        ? settings.contentTypes.filter((currentType) => currentType !== contentType)
        : [...settings.contentTypes, contentType],
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel weekly-schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-schedule-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="weekly-schedule-title">Generate Weekly Content Schedule</h2>
            <p>Choose the week, publishing days, platforms, and content mix before generating posts.</p>
          </div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <div className="weekly-schedule-form">
          <label className="form-field">
            <span>Week start date</span>
            <input
              type="date"
              value={settings.weekStartDate}
              onChange={(event) => updateSettings({ weekStartDate: event.target.value })}
            />
          </label>
          <label className="form-field">
            <span>Number of content days</span>
            <input
              max={7}
              min={1}
              type="number"
              value={settings.contentDays}
              onChange={(event) =>
                updateSettings({
                  contentDays: Math.min(7, Math.max(1, Number(event.target.value) || 1)),
                })
              }
            />
          </label>
          <label className="form-field form-field-wide">
            <span>Campaign theme/title</span>
            <input
              type="text"
              value={settings.campaignTheme}
              onChange={(event) => updateSettings({ campaignTheme: event.target.value })}
              placeholder={defaultWeeklyCampaignTheme}
            />
          </label>

          <fieldset className="option-group">
            <legend>Platforms to generate for</legend>
            <div className="checkbox-grid">
              {weeklySchedulePlatformOptions.map((platform) => (
                <label className="checkbox-card" key={platform}>
                  <input
                    checked={settings.platforms.includes(platform)}
                    type="checkbox"
                    onChange={() => togglePlatform(platform)}
                  />
                  <span>{platform}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="option-group">
            <legend>Content types to include</legend>
            <div className="checkbox-grid content-type-grid">
              {weeklyScheduleContentTypeOptions.map((contentType) => (
                <label className="checkbox-card" key={contentType}>
                  <input
                    checked={settings.contentTypes.includes(contentType)}
                    type="checkbox"
                    onChange={() => toggleContentType(contentType)}
                  />
                  <span>{contentType}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="secondary-button"
            disabled={busy || !settings.weekStartDate || settings.platforms.length === 0 || settings.contentTypes.length === 0}
            type="button"
            onClick={() => onGenerate(settings)}
          >
            Generate Schedule
          </button>
        </div>
      </section>
    </div>
  );
}

function ManualPostModal({
  busy,
  campaigns,
  settings,
  onCancel,
  onChange,
  onGenerate,
}: {
  busy: boolean;
  campaigns: Campaign[];
  settings: ManualPostSettings;
  onCancel: () => void;
  onChange: (settings: ManualPostSettings) => void;
  onGenerate: (settings: ManualPostSettings) => void;
}) {
  useBodyScrollLock();

  function updateSettings(update: Partial<ManualPostSettings>) {
    onChange({ ...settings, ...update });
  }

  function togglePlatform(platform: WeeklySchedulePlatform) {
    updateSettings({
      platforms: settings.platforms.includes(platform)
        ? settings.platforms.filter((currentPlatform) => currentPlatform !== platform)
        : [...settings.platforms, platform],
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel weekly-schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-post-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="manual-post-title">Generate Single Post</h2>
            <p>Choose the date, platform mix, and content angle before creating a calendar post.</p>
          </div>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <div className="weekly-schedule-form">
          <label className="form-field">
            <span>Post date</span>
            <input
              type="date"
              value={settings.scheduledDate}
              onChange={(event) => updateSettings({ scheduledDate: event.target.value })}
            />
          </label>
          <label className="form-field">
            <span>Business</span>
            <select
              value={settings.campaignId}
              onChange={(event) => updateSettings({ campaignId: event.target.value })}
            >
              <option value="">Default business</option>
              {campaigns.map((campaign) => (
                <option key={campaign.campaign_id} value={campaign.campaign_id}>
                  {campaign.campaign_name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field form-field-wide">
            <span>Title / angle</span>
            <input
              type="text"
              value={settings.title}
              onChange={(event) => updateSettings({ title: event.target.value })}
              placeholder="Optional post focus"
            />
          </label>
          <label className="form-field form-field-wide">
            <span>Content type</span>
            <select
              value={settings.contentType}
              onChange={(event) => updateSettings({ contentType: event.target.value })}
            >
              {weeklyScheduleContentTypeOptions.map((contentType) => (
                <option key={contentType} value={contentType}>
                  {contentType}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="option-group">
            <legend>Platforms to generate for</legend>
            <div className="checkbox-grid">
              {weeklySchedulePlatformOptions.map((platform) => (
                <label className="checkbox-card" key={platform}>
                  <input
                    checked={settings.platforms.includes(platform)}
                    type="checkbox"
                    onChange={() => togglePlatform(platform)}
                  />
                  <span>{platform}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="secondary-button"
            disabled={busy || !settings.scheduledDate || settings.platforms.length === 0 || !settings.contentType}
            type="button"
            onClick={() => onGenerate(settings)}
          >
            Generate Post
          </button>
        </div>
      </section>
    </div>
  );
}

function PhotoLibraryAssetSummary({
  asset,
  title,
  onChangePhoto,
}: {
  asset: PhotoAsset | null;
  title: string;
  onChangePhoto?: () => void;
}) {
  return (
    <section className="photo-library-asset-summary" aria-label={title}>
      <div className="photo-library-asset-summary-heading">
        <span>{title}</span>
        {onChangePhoto ? (
          <button className="photo-change-button" type="button" onClick={onChangePhoto}>
            Change photo
          </button>
        ) : null}
      </div>
      {asset ? (
        <>
          <strong>{asset.title}</strong>
          <div className="photo-library-asset-meta">
            <span>{asset.category}</span>
            <span>{getPhotoAssetQualityLabel(asset.quality)}</span>
            {asset.service_type ? <span>{asset.service_type}</span> : null}
            {asset.location ? <span>{asset.location}</span> : null}
            <span>{asset.used_count} uses</span>
          </div>
          {asset.tags.length > 0 ? (
            <div className="photo-tag-row" aria-label="Photo Library asset tags">
              {asset.tags.map((tag) => (
                <span key={`${asset.id}:${tag}`}>{tag}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p>Image is stored in the Photo Library, but its metadata is not currently available.</p>
      )}
    </section>
  );
}

function PhotoAssetPickerModal({
  assets,
  busy,
  currentAsset,
  slot,
  onCancel,
  onSelect,
}: {
  assets: PhotoAsset[];
  busy: boolean;
  currentAsset: PhotoAsset | null;
  slot: ContentSlot;
  onCancel: () => void;
  onSelect: (asset: PhotoAsset) => void;
}) {
  useBodyScrollLock();

  const sortedAssets = [...assets].sort((a, b) => {
    const qualityCompare =
      photoAssetQualityScore[b.quality] - photoAssetQualityScore[a.quality];
    if (qualityCompare !== 0) return qualityCompare;
    const usedCompare = a.used_count - b.used_count;
    if (usedCompare !== 0) return usedCompare;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel photo-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="photo-picker-title">Change photo</h2>
            <p>{slot.title}</p>
          </div>
          <button disabled={busy} type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {sortedAssets.length > 0 ? (
          <div className="photo-picker-grid">
            {sortedAssets.map((asset) => {
              const imageSource = getPhotoAssetPreviewUrl(asset);
              const isCurrent = currentAsset?.id === asset.id;
              return (
                <button
                  className={`photo-picker-card ${isCurrent ? 'photo-picker-card-current' : ''}`}
                  disabled={busy || isCurrent || !getPhotoAssetImageSource(asset)}
                  key={asset.id}
                  type="button"
                  onClick={() => onSelect(asset)}
                >
                  <div className="photo-picker-preview">
                    {imageSource ? <img alt={asset.title} src={imageSource} /> : <span>No image</span>}
                  </div>
                  <div className="photo-picker-card-body">
                    <span>{isCurrent ? 'Current photo' : 'Use this photo'}</span>
                    <strong>{asset.title}</strong>
                    <em>
                      {asset.category} · {getPhotoAssetQualityLabel(asset.quality)} · {asset.used_count} uses
                    </em>
                    {(asset.service_type || asset.location) ? (
                      <small>
                        {[asset.service_type, asset.location].filter(Boolean).join(' · ')}
                      </small>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="photo-library-empty">
            <strong>No Photo Library assets found.</strong>
            <span>Upload project photos in the Photo Library before changing a calendar slot photo.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function ContentSlotDetailModal({
  businessPublishTargets,
  busyAction,
  draftTextEdits,
  editingDraftId,
  loadingPublishTargets,
  photoAsset,
  publishTargetsError,
  slot,
  socialTargets,
  usesPhotoLibrary,
  onApprove,
  onCancelEdit,
  onChangePhoto,
  onClose,
  onDelete,
  onDraftTextChange,
  onOpenSettings,
  onPost,
  onRegenerate,
  onSaveDraft,
  onStartEdit,
}: {
  businessPublishTargets: BusinessPublishTarget[];
  busyAction: BusyAction;
  draftTextEdits: Record<string, string>;
  editingDraftId: string | null;
  loadingPublishTargets: boolean;
  photoAsset: PhotoAsset | null;
  publishTargetsError: string | null;
  slot: ContentSlot;
  socialTargets: SocialTarget[];
  usesPhotoLibrary: boolean;
  onApprove: (item: CampaignContentQueueItem) => Promise<void>;
  onCancelEdit: (contentId: string) => void;
  onChangePhoto: (slot: ContentSlot) => void;
  onClose: () => void;
  onDelete: (item: CampaignContentQueueItem) => Promise<void>;
  onDraftTextChange: (contentId: string, draftText: string) => void;
  onOpenSettings: () => void;
  onPost: (item: CampaignContentQueueItem) => void;
  onRegenerate: (post: PlatformPost) => Promise<void>;
  onSaveDraft: (item: CampaignContentQueueItem) => Promise<void>;
  onStartEdit: (item: CampaignContentQueueItem) => void;
}) {
  useBodyScrollLock();

  const missingCorePlatforms = coreCalendarPlatforms.filter((platform) => !getPlatformBadgeState(slot, platform));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-panel content-slot-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-slot-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="content-slot-title">{slot.title}</h2>
            <p>
              {slot.business} · {calendarDays[slot.dayIndex]?.label ?? 'Unscheduled'} ·{' '}
              {formatDisplayDate(slot.scheduledAt)}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="content-slot-detail-grid">
          <div className="content-slot-detail-media">
            {slot.imageSource ? <img alt={`${slot.title} image`} src={getMediaUrl(slot.imageSource)} /> : <span>No image</span>}
          </div>
          <div className="content-slot-detail-summary">
            <span className="content-type-pill">{slot.contentType}</span>
            <span className="status-pill status-draft">{slot.statusSummary}</span>
            <span>Campaign: {slot.campaignId}</span>
            <span>Week: {slot.weekKey}</span>
            <div className="platform-badge-row">
              {coreCalendarPlatforms.map((platform) => {
                const targetState = getPublishTargetState(
                  platform,
                  socialTargets,
                  businessPublishTargets,
                  loadingPublishTargets,
                  publishTargetsError,
                );
                return (
                  <span
                    className={`platform-badge ${getPlatformBadgeState(slot, platform) ? 'platform-badge-active' : ''} ${getPublishTargetStateClassName(
                      targetState,
                    )}`}
                    key={platform}
                    title={targetState.detail}
                  >
                    {platform === 'Google Business' ? 'Google' : platform}
                    <small>{getPublishTargetChipLabel(targetState)}</small>
                  </span>
                );
              })}
            </div>
            {usesPhotoLibrary ? (
              <PhotoLibraryAssetSummary
                asset={photoAsset}
                title="Photo Library Asset"
                onChangePhoto={() => onChangePhoto(slot)}
              />
            ) : (
              <button className="photo-change-button" type="button" onClick={() => onChangePhoto(slot)}>
                Change photo
              </button>
            )}
          </div>
        </div>

        <div className="platform-post-sections">
          {slot.platformPosts.map((post, index) => {
            const item = post.item;
            const editing = editingDraftId === item.content_id;
            const actionSuffix = post.id;
            const targetState = getPublishTargetState(
              post.platform,
              socialTargets,
              businessPublishTargets,
              loadingPublishTargets,
              publishTargetsError,
            );
            const planningStatus = getPlanningStatus(item);
            const normalizedPlanningStatus = normalizeStatus(planningStatus);
            const published = isPublishedPlanningStatus(planningStatus);
            const approved = item.approved === 'Yes' || normalizedPlanningStatus === 'approved';
            const scheduled = normalizedPlanningStatus === 'scheduled';
            const canApprove = targetState.kind !== 'manual' && !approved && !scheduled && !published;
            return (
              <details className="platform-post-section" key={post.id} open={index === 0}>
                <summary>
                  <span>
                    {post.platform}
                    {post.sourcePlatform !== post.platform ? (
                      <em>Shared {formatPlatformLabel(post.sourcePlatform)} post</em>
                    ) : null}
                    <em className={`target-state-line ${getPublishTargetStateClassName(targetState)}`}>
                      {targetState.detail}
                    </em>
                  </span>
                  <span className={statusClassName(planningStatus)}>{planningStatus}</span>
                </summary>
                <div className="platform-post-body">
                  <div className={`publish-target-callout ${getPublishTargetStateClassName(targetState)}`}>
                    <div>
                      <strong>{targetState.label}</strong>
                      <span>{targetState.detail}</span>
                    </div>
                    {targetState.kind === 'missing' || targetState.kind === 'unavailable' ? (
                      <button type="button" onClick={onOpenSettings}>
                        Fix in Settings
                      </button>
                    ) : null}
                  </div>
                  <div className="platform-post-field">
                    <strong>Caption / Body</strong>
                    {editing ? (
                      <textarea
                        aria-label={`Edit ${post.platform} post text`}
                        value={draftTextEdits[item.content_id] ?? item.draft_text}
                        onChange={(event) => onDraftTextChange(item.content_id, event.target.value)}
                      />
                    ) : (
                      <p>{item.draft_text}</p>
                    )}
                  </div>
                  <div className="platform-post-meta">
                    <span>Status: {item.status}</span>
                    <span>Scheduled: {formatDisplayDate(getContentItemScheduledAt(item))}</span>
                    <span>Approved: {item.approved}</span>
                    <span>Published: {item.published}</span>
                    {item.landing_page_url ? (
                      <a href={item.landing_page_url} rel="noreferrer" target="_blank">
                        Landing page
                      </a>
                    ) : null}
                    {item.published_url ? (
                      <a href={item.published_url} rel="noreferrer" target="_blank">
                        Published post
                      </a>
                    ) : null}
                    {item.external_post_id ? <span>Provider Post ID: {item.external_post_id}</span> : null}
                    <span>Publish Attempts: {item.publish_attempts}</span>
                  </div>
                  {item.last_publish_error ? <p className="error-text">{item.last_publish_error}</p> : null}
                  {renderGoogleBusinessPublishStatus(item)}
                  {renderMetaPublishStatus(item)}
                  <div className="platform-post-actions">
                    {editing ? (
                      <>
                        <button
                          className="secondary-button"
                          disabled={busyAction === `weekly-save-draft:${item.content_id}`}
                          type="button"
                          onClick={() => void onSaveDraft(item)}
                        >
                          Save
                        </button>
                        <button
                          disabled={busyAction === `weekly-save-draft:${item.content_id}`}
                          type="button"
                          onClick={() => onCancelEdit(item.content_id)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => onStartEdit(item)}>
                        Edit
                      </button>
                    )}
                    <button
                      disabled={busyAction === `weekly-regenerate:${actionSuffix}`}
                      type="button"
                      onClick={() => void onRegenerate(post)}
                    >
                      Regenerate
                    </button>
                    {targetState.kind !== 'manual' && !published && !approved && !scheduled ? (
                      <button
                        disabled={busyAction === `weekly-approve:${item.content_id}` || !canApprove}
                        type="button"
                        onClick={() => void onApprove(item)}
                        title={canApprove ? 'Approve this draft' : 'This draft is not ready for approval.'}
                      >
                        Approve
                      </button>
                    ) : null}
                    <button className="secondary-button" type="button" onClick={() => onPost(item)}>
                      Post
                    </button>
                    <button
                      className="danger-button"
                      disabled={busyAction === `weekly-delete:${item.content_id}`}
                      type="button"
                      onClick={() => void onDelete(item)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
          {missingCorePlatforms.map((platform) => {
            const targetState = getPublishTargetState(
              platform,
              socialTargets,
              businessPublishTargets,
              loadingPublishTargets,
              publishTargetsError,
            );
            return (
              <details className="platform-post-section platform-post-section-empty" key={`missing:${platform}`}>
                <summary>
                  <span>
                    {platform}
                    <em className={`target-state-line ${getPublishTargetStateClassName(targetState)}`}>
                      {targetState.detail}
                    </em>
                  </span>
                  <span className="status-pill status-draft">Missing</span>
                </summary>
                <div className="platform-post-body">
                  <p>No {platform} post has been generated for this content slot yet.</p>
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DraftPreview({
  preview,
  onClose,
}: {
  preview: { job: CompletedJob; draft: ContentDraft };
  onClose: () => void;
}) {
  useBodyScrollLock();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <h2>Draft Preview</h2>
            <p>
              {preview.job.customer} · {preview.job.job_id}
            </p>
          </div>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="draft-grid">
          {draftFields.map(([field, label]) => (
            <article className="draft-card" key={field}>
              <h3>{label}</h3>
              <p>{preview.draft[field]}</p>
            </article>
          ))}
        </div>
        <div className="draft-meta">
          <span>Confidence: {Math.round(preview.draft.confidence * 100)}%</span>
          <span>Human review: {preview.draft.needs_human_review ? 'Required' : 'Not required'}</span>
        </div>
      </section>
    </div>
  );
}

function CampaignDraftPreview({
  preview,
  onClose,
}: {
  preview: { campaign: Campaign; draftSet: CampaignDraftSet };
  onClose: () => void;
}) {
  useBodyScrollLock();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <h2>Campaign Draft Preview</h2>
            <p>
              {preview.campaign.campaign_name} · {preview.campaign.campaign_id}
            </p>
          </div>
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="draft-grid">
          {campaignDraftFields.map(([field, label]) => (
            <article className="draft-card" key={field}>
              <h3>{label}</h3>
              <p>{preview.draftSet[field]}</p>
            </article>
          ))}
        </div>
        <div className="draft-meta">
          <span>CTA: {preview.campaign.cta}</span>
          <span>Landing page: {preview.campaign.landing_page_url}</span>
          <span>Confidence: {Math.round(preview.draftSet.confidence * 100)}%</span>
          <span>Human review: {preview.draftSet.needs_human_review ? 'Required' : 'Not required'}</span>
        </div>
      </section>
    </div>
  );
}

export default App;
