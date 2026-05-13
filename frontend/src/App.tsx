import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
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
  createPhotoAsset,
  deletePost,
  deletePhotoAsset,
  generateAndSave,
  generateAndSaveCampaign,
  generateManualSocialPost,
  generateVisibilityContent,
  generateWeeklySocialPosts,
  getCampaignContentQueue,
  getCampaigns,
  getContentQueue,
  getJobs,
  getMediaUrl,
  getPhotoAssets,
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
  updatePostImage,
  updatePhotoAsset,
  updatePostDraftText,
  updatePostScheduledAt,
} from './api';
import type {
  BusinessProfile,
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
  VisibilityGenerationResponse,
  VisibilityPhotoAssetMetadata,
} from './types';

type BusyAction = string | null;
type PostAssistantCopiedAction = 'caption' | null;
type CalendarPlatform = 'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups' | 'Craigslist' | 'Nextdoor';
type WeeklySchedulePlatform = 'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups';
type AppSection = 'calendar' | 'visibility-tools' | 'business-profile' | 'photo-library' | 'jobs-queues';
type VisibilityToolId =
  | 'local-reach-post'
  | 'review-request'
  | 'business-intro-post'
  | 'craigslist-service-ad';
type LocalReachDestination =
  | 'Google Business Profile'
  | 'Facebook Group'
  | 'Craigslist'
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
  count: number;
  previousStyles: BodyScrollLockPreviousStyles | null;
  scrollY: number;
} = {
  count: 0,
  previousStyles: null,
  scrollY: 0,
};

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
  slotId: string;
  originDayIndex: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  sourceWidth: number;
  sourceHeight: number;
  hasStarted: boolean;
};

type CalendarDragState = {
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
  { key: 'sunday', label: 'Sunday', shortLabel: 'Sun' },
  { key: 'monday', label: 'Monday', shortLabel: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', shortLabel: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', shortLabel: 'Wed' },
  { key: 'thursday', label: 'Thursday', shortLabel: 'Thu' },
  { key: 'friday', label: 'Friday', shortLabel: 'Fri' },
  { key: 'saturday', label: 'Saturday', shortLabel: 'Sat' },
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
const photoLibraryStorageKey = 'gomez-ops-photo-library-v1';
const defaultPhotoAssetBusinessId = 'marom-painting';
const maxPhotoAssetDataUrlLength = 2_800_000;
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

const appNavItems: AppNavItem[] = [
  { key: 'calendar', label: 'Calendar', description: '' },
  { key: 'visibility-tools', label: 'Visibility Tools', description: '' },
  { key: 'business-profile', label: 'Business Profile', description: '' },
  { key: 'photo-library', label: 'Photo Library', description: '' },
  { key: 'jobs-queues', label: 'Jobs + Queues', description: '' },
];

const visibilityToolCards: VisibilityToolCard[] = [
  {
    id: 'local-reach-post',
    title: 'Local Reach Post',
    description:
      'Generate a local post for Google Business, Facebook groups, Craigslist, neighborhood groups, or general copy/paste outreach.',
    label: 'Local visibility',
  },
  {
    id: 'review-request',
    title: 'Review Request',
    description: 'Generate a short message asking a past customer for a Google review.',
    label: 'Reputation',
  },
  {
    id: 'business-intro-post',
    title: 'Business Intro Post',
    description: 'Generate a local "hey neighbors" introduction post for a new business or new service area.',
    label: 'Local intro',
  },
  {
    id: 'craigslist-service-ad',
    title: 'Craigslist Service Ad',
    description: 'Generate a longer service ad with titles, body copy, service list, trust section, CTA, photos, and local keywords.',
    label: 'Craigslist',
  },
];

const localReachDestinationOptions: LocalReachDestination[] = [
  'Google Business Profile',
  'Facebook Group',
  'Craigslist',
  'Neighborhood Group',
  'General Social Post',
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

type IconName = 'check' | 'copy' | 'download' | 'edit' | 'menu' | 'restore' | 'save' | 'skip' | 'trash' | 'x';

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
    skip: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
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
    postType: 'Service promotion',
    goal: 'Get estimate requests',
    serviceFocus: defaultService,
    location: defaultLocation,
    cta: defaultCta,
    photoAssetId: '',
    notes: '',
    tone: toolId === 'review-request' ? 'Friendly and professional' : 'Friendly neighbor',
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

function visibilityToolSupportsPhoto(toolId: VisibilityToolId) {
  return toolId === 'local-reach-post' || toolId === 'craigslist-service-ad';
}

function destinationFromVisibilityChannel(channel: VisibilityChannel): LocalReachDestination {
  if (channel === 'Facebook Groups') return 'Facebook Group';
  if (channel === 'Neighborhood Groups') return 'Neighborhood Group';
  return channel;
}

function visibilityChannelFromDestination(destination: LocalReachDestination): VisibilityChannel {
  if (destination === 'Facebook Group') return 'Facebook Groups';
  if (destination === 'Neighborhood Group') return 'Neighborhood Groups';
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

function formatVisibilityCta(profile: BusinessProfile, cta: string) {
  const cleanCta = cleanSentencePart(cta || profile.primary_cta || 'Request a free estimate');
  const website = profile.website_url.trim();
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
  notes: string,
  photoContext: string,
) {
  const profileTrust = profile.target_customer.trim()
    ? `We work with ${profile.target_customer.toLowerCase()} who want dependable, neat work.`
    : 'We focus on dependable, neat work and clear communication.';
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
  profile: BusinessProfile,
) {
  const baseKeywords = [
    `${service} ${location}`,
    `${profile.business_name || defaultBusinessProfile.business_name}`,
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

function buildLocalReachPostOutput(
  formData: VisibilityToolFormData,
  profile: BusinessProfile,
  photoAsset: PhotoAsset | null,
) {
  const businessName = profile.business_name.trim() || defaultBusinessProfile.business_name;
  const service = cleanSentencePart(formData.serviceFocus || firstProfileValue(profile.services_offered, 'painting services'));
  const location = cleanSentencePart(formData.location || firstProfileValue(profile.service_area_cities, 'the local area'));
  const ctaLine = formatVisibilityCta(profile, formData.cta);
  const destination = formData.destination;
  const postType = formData.postType;
  const goal = formData.goal;
  const tone = formData.tone || 'Friendly neighbor';
  const photoContext = formatVisibilityPhotoContext(photoAsset);
  const hook = localReachHook(destination, postType, tone, service, location);
  const body = localReachBody(destination, postType, goal, tone, businessName, service, location, profile, formData.notes, photoContext);
  const primaryPost =
    destination === 'Craigslist'
      ? `${hook}\n\n${body}\n\n${ctaLine}`
      : `${hook} ${body}\n\n${ctaLine}`;
  const shortVersion = localReachShortVersion(destination, businessName, service, location, ctaLine);
  const keywords = localReachKeywords(destination, service, location, profile);

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
  photoAsset: PhotoAsset | null,
) {
  const businessName = profile.business_name.trim() || defaultBusinessProfile.business_name;
  const service = cleanSentencePart(formData.serviceFocus || firstProfileValue(profile.services_offered, 'painting services'));
  const location = cleanSentencePart(formData.location || firstProfileValue(profile.service_area_cities, 'the local area'));
  const ctaLine = formatVisibilityCta(profile, formData.cta);
  const tone = formData.tone.toLowerCase();

  if (toolId === 'local-reach-post') {
    return buildLocalReachPostOutput(formData, profile, photoAsset);
  }

  if (toolId === 'review-request') {
    const customerName = cleanSentencePart(formData.customerName || 'there');
    const jobCompleted = cleanSentencePart(formData.jobCompleted || service);
    const reviewLink = formData.reviewLink.trim();
    if (tone.includes('short')) {
      return `Hi ${customerName}, thank you for choosing ${businessName} for ${jobCompleted}. If you have a minute, would you leave us a Google review? ${reviewLink || ctaLine}`;
    }
    if (tone.includes('warm')) {
      return `Hi ${customerName}, it was a pleasure helping with ${jobCompleted}. Thank you again for trusting ${businessName}. If you have a minute, a Google review would mean a lot and helps other local homeowners find us. ${reviewLink || ctaLine}`;
    }
    return `Hi ${customerName}, thank you again for choosing ${businessName} for ${jobCompleted}. If you have a minute, would you be willing to leave us a Google review? It helps local homeowners feel confident reaching out. ${reviewLink || ctaLine}`;
  }

  if (toolId === 'business-intro-post') {
    const services = cleanSentencePart(formData.servicesToMention || service);
    const background = cleanSentencePart(formData.businessBackground || profile.brand_tone);
    return `Hey neighbors - we are ${businessName}, a local ${profile.industry.toLowerCase()} business serving ${location}. We help with ${services}. ${background}. If you are planning a project nearby, ${ctaLine}.`;
  }

  if (toolId === 'craigslist-service-ad') {
    const services = [service, 'Interior painting', 'Exterior painting', 'Cabinet painting', 'Drywall repair'];
    const uniqueServices = Array.from(new Set(services.filter(Boolean)));
    const contact = formData.contact || profile.website_url || profile.phone_number;
    return [
      `Primary post:`,
      `${businessName} - ${service} in ${location}`,
      '',
      `If you are dealing with ${formData.customerPainPoint || 'paint that looks tired, damaged, or overdue for a refresh'}, ${businessName} can help with reliable ${service.toLowerCase()} in ${location}.`,
      '',
      'Services:',
      ...uniqueServices.map((item) => `- ${item}`),
      '',
      'Why choose us:',
      formData.trustSignals || 'Clear estimates, careful prep, clean work areas, and local service.',
      '',
      'CTA:',
      contact ? `${formData.cta || profile.primary_cta}: ${contact}` : ctaLine,
      '',
      'Short version:',
      `${service} in ${location}. Clean work, clear estimates, local service. ${contact ? `${formData.cta || profile.primary_cta}: ${contact}` : ctaLine}`,
      '',
      'Suggested local keywords or hashtags:',
      `${service} ${location}, ${location} painting services, residential painting, free painting estimate`,
    ].join('\n');
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
    image_url: rawAsset.image_url?.trim() || null,
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

function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const { body } = document;
    const { documentElement } = document;
    if (bodyScrollLockState.count === 0) {
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
    bodyScrollLockState.count += 1;

    return () => {
      bodyScrollLockState.count = Math.max(0, bodyScrollLockState.count - 1);
      if (bodyScrollLockState.count > 0) return;

      const previousStyles = bodyScrollLockState.previousStyles;
      if (previousStyles) {
        body.style.overflow = previousStyles.bodyOverflow;
        body.style.overscrollBehavior = previousStyles.bodyOverscrollBehavior;
        body.style.position = previousStyles.bodyPosition;
        body.style.top = previousStyles.bodyTop;
        body.style.width = previousStyles.bodyWidth;
        document.documentElement.style.overflow = previousStyles.documentOverflow;
        document.documentElement.style.overscrollBehavior = previousStyles.documentOverscrollBehavior;
      }
      body.classList.remove('modal-open');
      window.scrollTo(0, bodyScrollLockState.scrollY);
      bodyScrollLockState.previousStyles = null;
      bodyScrollLockState.scrollY = 0;
    };
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

  return date.getUTCDay();
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
  if (item.status === 'Posted' || item.status === 'Published' || item.published === 'Yes') return 'Posted';
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

function getCalendarSundayStartDateInput(weekStartDate: string) {
  const referenceDate = parseDateInputAsUtc(weekStartDate) ?? parseDateInputAsUtc(getDefaultWeekStartDateInput());
  if (!referenceDate) return getDefaultWeekStartDateInput();

  const sundayDate = new Date(referenceDate);
  sundayDate.setUTCDate(referenceDate.getUTCDate() - referenceDate.getUTCDay());
  return formatUtcDateInputValue(sundayDate);
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
  const calendarStart = parseDateInputAsUtc(getCalendarSundayStartDateInput(weekStartDate));
  if (!calendarStart) return getDefaultWeekStartDateInput();

  const scheduledDate = new Date(calendarStart);
  scheduledDate.setUTCDate(calendarStart.getUTCDate() + dayIndex);
  return formatUtcDateInputValue(scheduledDate);
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
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [activeSection, setActiveSection] = useState<AppSection>('calendar');
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(() => loadStoredBusinessProfile());
  const [businessProfileDraft, setBusinessProfileDraft] = useState<BusinessProfile>(() => loadStoredBusinessProfile());
  const [photoAssets, setPhotoAssets] = useState<PhotoAsset[]>([]);
  const [selectedVisibilityToolId, setSelectedVisibilityToolId] = useState<VisibilityToolId | null>(null);
  const [visibilityToolFormData, setVisibilityToolFormData] = useState<VisibilityToolFormData>(() =>
    createDefaultVisibilityToolFormData('local-reach-post', loadStoredBusinessProfile()),
  );
  const [visibilityToolOutput, setVisibilityToolOutput] = useState<VisibilityGenerationResponse | null>(null);
  const [visibilityToolError, setVisibilityToolError] = useState<string | null>(null);
  const [visibilityToolGenerating, setVisibilityToolGenerating] = useState(false);
  const [visibilityToolCopied, setVisibilityToolCopied] = useState(false);
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
      setWeeklyQueue(await getWeeklySocialQueue(weekStartDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load weekly posting queue.');
    } finally {
      setLoadingWeeklyQueue(false);
    }
  }, [calendarWeekStartDate]);

  const loadPhotoAssets = useCallback(async () => {
    try {
      setPhotoAssets(await getPhotoAssets(defaultPhotoAssetBusinessId));
    } catch (err) {
      setWarning(err instanceof Error ? `Photo Library metadata unavailable. ${err.message}` : 'Photo Library metadata unavailable.');
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
    void loadWeeklyQueue();
    void loadPhotoAssets();
  }, [loadCampaigns, loadPhotoAssets, loadWeeklyQueue]);

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
    return [...weeklyQueue].sort((a, b) => {
      const scheduledCompare = getContentItemScheduledAt(a).localeCompare(getContentItemScheduledAt(b));
      if (scheduledCompare !== 0) return scheduledCompare;
      return campaignPlatformOrder[a.platform] - campaignPlatformOrder[b.platform];
    });
  }, [weeklyQueue]);

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

  useBodyScrollLock(
    Boolean(
      selectedVisibilityToolId ||
        showWeeklyScheduleModal ||
        showManualPostModal ||
        selectedContentSlot ||
        pendingDeleteContentSlot ||
        photoPickerContentSlot ||
        postAssistantItem ||
        preview ||
        campaignPreview,
    ),
  );

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
      return Promise.all([loadCampaigns(), loadWeeklyQueue(), loadPhotoAssets()]);
    }
    if (activeSection === 'visibility-tools') {
      return Promise.all([loadCampaigns(), loadWeeklyQueue(), loadPhotoAssets()]);
    }
    if (activeSection === 'photo-library') {
      return loadPhotoAssets();
    }
    return Promise.resolve();
  }

  function openVisibilityTool(toolId: VisibilityToolId) {
    setSelectedVisibilityToolId(toolId);
    setVisibilityToolFormData(createDefaultVisibilityToolFormData(toolId, businessProfile));
    setVisibilityToolOutput(null);
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);
  }

  function closeVisibilityTool() {
    setSelectedVisibilityToolId(null);
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

  async function handleGenerateVisibilityTool() {
    if (!selectedVisibilityToolId) return;

    setVisibilityToolGenerating(true);
    setVisibilityToolError(null);
    setVisibilityToolCopied(false);

    const selectedAsset =
      photoAssets.find((asset) => asset.id === visibilityToolFormData.photoAssetId) ?? null;
    const selectedAssets = photoAssets.filter((asset) =>
      visibilityToolFormData.selectedPhotoAssetIds.includes(asset.id),
    );

    try {
      const result = await generateVisibilityContent({
        toolType:
          selectedVisibilityToolId === 'local-reach-post'
            ? 'local_reach_post'
            : selectedVisibilityToolId === 'review-request'
              ? 'review_request'
              : selectedVisibilityToolId === 'business-intro-post'
                ? 'business_intro_post'
                : 'craigslist_service_ad',
        destination: visibilityToolFormData.destination,
        postType: visibilityToolFormData.postType,
        businessProfile,
        serviceFocus: visibilityToolFormData.serviceFocus,
        location: visibilityToolFormData.location,
        goal: visibilityToolFormData.goal,
        tone: visibilityToolFormData.tone,
        cta: visibilityToolFormData.cta,
        notes: visibilityToolFormData.notes,
        customerName: visibilityToolFormData.customerName,
        jobCompleted: visibilityToolFormData.jobCompleted,
        reviewLink: visibilityToolFormData.reviewLink,
        servicesToMention: visibilityToolFormData.servicesToMention,
        businessBackground: visibilityToolFormData.businessBackground,
        offerDetails: visibilityToolFormData.offerDetails,
        customerPainPoint: visibilityToolFormData.customerPainPoint,
        trustSignals: visibilityToolFormData.trustSignals,
        contact: visibilityToolFormData.contact,
        photoAsset: selectedAsset ? photoAssetToVisibilityMetadata(selectedAsset) : null,
        photoAssets: selectedAssets.map(photoAssetToVisibilityMetadata),
        outputFormat: 'structured',
      });
      setVisibilityToolOutput(result);
    } catch (err) {
      const generatedText = buildVisibilityToolOutput(
        selectedVisibilityToolId,
        visibilityToolFormData,
        businessProfile,
        selectedVisibilityToolId === 'craigslist-service-ad' ? selectedAssets[0] ?? null : selectedAsset,
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

  function openWeeklyScheduleModal() {
    const profilePlatforms = weeklyPlatformsFromBusinessProfile(businessProfile);
    setWeeklyScheduleSettings((current) => ({
      ...current,
      platforms: profilePlatforms.length > 0 ? profilePlatforms : current.platforms,
      campaignTheme:
        current.campaignTheme === defaultWeeklyCampaignTheme || !current.campaignTheme.trim()
          ? weeklyCampaignThemeFromBusinessProfile(businessProfile)
          : current.campaignTheme,
    }));
    setShowWeeklyScheduleModal(true);
  }

  function openManualPostModal() {
    const profilePlatforms = weeklyPlatformsFromBusinessProfile(businessProfile);
    setManualPostSettings((current) => ({
      ...current,
      campaignId: selectedCampaignId,
      platforms: profilePlatforms.length > 0 ? profilePlatforms : current.platforms,
      scheduledDate: current.scheduledDate || formatDateInputValue(new Date()),
      contentType: current.contentType || weeklyScheduleContentTypeOptions[0] || 'General',
    }));
    setShowManualPostModal(true);
  }

  function handleSaveBusinessProfile() {
    const nextProfile = normalizeBusinessProfile(businessProfileDraft);
    setBusinessProfile(nextProfile);
    setBusinessProfileDraft(nextProfile);
    storeBusinessProfile(nextProfile);
    setWarning('Business profile saved. Future generated posts will use this profile.');
    setError(null);
  }

  function handleCancelBusinessProfileEdits() {
    setBusinessProfileDraft(businessProfile);
    setError(null);
  }

  function handleResetBusinessProfile() {
    const nextProfile = normalizeBusinessProfile(defaultBusinessProfile);
    setBusinessProfile(nextProfile);
    setBusinessProfileDraft(nextProfile);
    storeBusinessProfile(nextProfile);
    setWarning('Business profile reset to the seeded Marom/Gomez Painting defaults.');
    setError(null);
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
        campaign_id: selectedCampaignId || null,
        platforms: settings.platforms,
        posts_per_platform: settings.contentDays,
        content_days: settings.contentDays,
        week_start_date: settings.weekStartDate,
        content_types: settings.contentTypes,
        campaign_theme: campaignTheme,
        separate_meta_platforms: true,
        business_profile: businessProfile,
      });
      setCalendarWeekStartDate(settings.weekStartDate);
      await Promise.all([loadWeeklyQueue(settings.weekStartDate), loadCampaignQueue(), loadPhotoAssets()]);
      setShowWeeklyScheduleModal(false);
      setWarning(
        result.existing
          ? 'This weekly schedule already has all selected slots. Showing the existing queue.'
          : hadWeeklyPosts
            ? 'Generated missing scheduled posts for this week.'
            : 'Generated scheduled posts for this week.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate weekly posts.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateManualPost(settings: ManualPostSettings) {
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
            campaign_id: settings.campaignId || null,
            platform,
            post_type: postType,
            business_profile: businessProfile,
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
      setWarning(`Generated ${generatedItems.length} post${generatedItems.length === 1 ? '' : 's'} for ${settings.scheduledDate}.`);
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
        campaign_id: post.item.campaign_id === 'BUSINESS-PROFILE' ? null : post.item.campaign_id,
        platform: post.sourcePlatform,
        post_type: getContentItemType(post.item),
        business_profile: businessProfile,
      });
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
      setWarning(`Generated ${result.queue_items.length} new draft candidate. Review it before posting.`);
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

    setError(null);
    setWarning(null);
    setWeeklyQueue((current) => moveContentSlotItemsToDay(current, contentIds, scheduledAt));

    try {
      // TODO: Replace per-platform post schedule updates with a backend ContentSlot move endpoint.
      await Promise.all(slot.sourceItems.map((item) => updatePostScheduledAt(item.content_id, scheduledAt)));
      await loadWeeklyQueue(calendarWeekStartDate);
      setWarning(`Moved "${slot.title}" to ${targetDayLabel}.`);
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

  function handleContentSlotPointerDown(event: ReactPointerEvent<HTMLButtonElement>, slot: ContentSlot) {
    if (event.button !== 0 || busyAction) return;
    if (
      event.pointerType !== 'mouse' &&
      event.target instanceof Element &&
      !event.target.closest('[data-calendar-drag-handle="true"]')
    ) {
      return;
    }

    const sourceRect = event.currentTarget.getBoundingClientRect();
    calendarDragCandidateRef.current = {
      slotId: slot.id,
      originDayIndex: slot.dayIndex,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - sourceRect.left,
      grabOffsetY: event.clientY - sourceRect.top,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
      hasStarted: false,
    };
    if (event.pointerType !== 'mouse') {
      event.preventDefault();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleContentSlotPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const candidate = calendarDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    const movement = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (!candidate.hasStarted && movement < 7) return;

    event.preventDefault();
    suppressContentSlotClickRef.current = true;

    if (!candidate.hasStarted) {
      const target = detectCalendarDropTarget(event.clientX, event.clientY);
      candidate.hasStarted = true;
      setCalendarDrag({
        slotId: candidate.slotId,
        originDayIndex: candidate.originDayIndex,
        pointerType: candidate.pointerType,
        currentX: event.clientX,
        currentY: event.clientY,
        grabOffsetX: candidate.grabOffsetX,
        grabOffsetY: candidate.grabOffsetY,
        sourceWidth: candidate.sourceWidth,
        sourceHeight: candidate.sourceHeight,
        overDayIndex: target.overTrash ? null : target.dayIndex,
        overTrash: target.overTrash,
      });
      return;
    }

    updateCalendarDragTarget(event.clientX, event.clientY);
  }

  function handleContentSlotPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const candidate = calendarDragCandidateRef.current;
    if (!candidate || candidate.pointerId !== event.pointerId) return;

    const wasDragging = candidate.hasStarted;
    const canceled = event.type === 'pointercancel';
    const target = wasDragging && !canceled ? detectCalendarDropTarget(event.clientX, event.clientY) : null;
    const activeSlotId = candidate.slotId;

    calendarDragCandidateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

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
  const selectedVisibilityTool = getVisibilityToolById(selectedVisibilityToolId);
  const selectedVisibilityPhotoAsset =
    photoAssets.find((asset) => asset.id === visibilityToolFormData.photoAssetId) ?? null;
  const enabledVisibilityChannels = visibilityChannelsFromProfile(businessProfile);
  const enabledLocalReachDestinations = enabledVisibilityChannels.map(destinationFromVisibilityChannel);
  const visibleVisibilityToolCards = visibilityToolCards.filter(
    (tool) => tool.id !== 'craigslist-service-ad' || enabledVisibilityChannels.includes('Craigslist'),
  );
  const activeNavIndex = Math.max(
    appNavItems.findIndex((item) => item.key === activeSection),
    0,
  );
  const activeNavItem = appNavItems[activeNavIndex] ?? appNavItems[0];
  const sidebarNavStyle = {
    '--active-index': activeNavIndex,
  } as CSSProperties & Record<'--active-index', number>;
  const businessSubtitle = businessProfile.business_name
    ? `${businessProfile.business_name} content operations`
    : 'Marom Painting content operations';

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen ? 'app-sidebar-open' : ''}`} aria-label="GomezOps navigation">
        <div className="sidebar-brand">
          <span>GomezOps</span>
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

      {error ? (
        <section className="alert" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </section>
      ) : null}

      {warning ? (
        <section className="alert warning" role="status">
          <span>{warning}</span>
          <button onClick={() => setWarning(null)}>Dismiss</button>
        </section>
      ) : null}

      {activeSection === 'visibility-tools' ? (
        <section className="panel visibility-tools-panel">
          <div className="panel-heading weekly-heading">
            <div>
              <h2>Visibility Tools</h2>
              <p>One-off local visibility actions that sit outside the normal feed calendar workflow.</p>
            </div>
            <div className="panel-heading-actions">
              {loadingCampaigns || loadingWeeklyQueue ? <span className="loading-label">Loading</span> : null}
            </div>
          </div>

          <div className="visibility-tool-grid">
            {visibleVisibilityToolCards.map((tool) => (
              <button
                className="visibility-tool-card"
                key={tool.id}
                type="button"
                onClick={() => openVisibilityTool(tool.id)}
              >
                <span className="visibility-tool-kicker">{tool.label}</span>
                <h3>{tool.title}</h3>
                <p>{tool.description}</p>
                <span className="visibility-tool-cta">Create</span>
              </button>
            ))}
          </div>
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
                        aria-label={`Open or drag ${slot.title}, scheduled for ${formatDisplayDate(slot.scheduledAt)}`}
                        className={`content-slot-card ${calendarDrag?.slotId === slot.id ? 'content-slot-card-dragging' : ''}`}
                        key={slot.id}
                        type="button"
                        onClick={(event) => handleContentSlotClick(event, slot)}
                        onPointerCancel={handleContentSlotPointerEnd}
                        onPointerDown={(event) => handleContentSlotPointerDown(event, slot)}
                        onPointerMove={handleContentSlotPointerMove}
                        onPointerUp={handleContentSlotPointerEnd}
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
                                platformLabels.map((platform) => (
                                  <span className="platform-chip" key={platform.platform}>
                                    {platform.label}
                                  </span>
                                ))
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
                        <div className="content-slot-drag-affordance" data-calendar-drag-handle="true" aria-hidden="true" />
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
        <BusinessProfileSection
          profile={businessProfile}
          draft={businessProfileDraft}
          onCancel={handleCancelBusinessProfileEdits}
          onChange={setBusinessProfileDraft}
          onReset={handleResetBusinessProfile}
          onSave={handleSaveBusinessProfile}
        />
      ) : null}

      {activeSection === 'photo-library' ? (
        <PhotoLibrarySection
          businessName={businessProfile.business_name}
          serviceOptions={businessProfile.services_offered}
          onAssetsChange={setPhotoAssets}
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
      {selectedVisibilityTool ? (
        <VisibilityToolModal
          copied={visibilityToolCopied}
          error={visibilityToolError}
          formData={visibilityToolFormData}
          generating={visibilityToolGenerating}
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
          onOutputChange={(output) => {
            setVisibilityToolOutput((current) => ({
              ...(current ?? { generationMode: 'fallback' }),
              primary: output,
            }));
            setVisibilityToolCopied(false);
          }}
        />
      ) : null}
      {selectedContentSlot ? (
        <ContentSlotDetailModal
          busyAction={busyAction}
          draftTextEdits={draftTextEdits}
          editingDraftId={editingDraftId}
          photoAsset={getContentSlotPhotoAsset(selectedContentSlot, photoAssets)}
          slot={selectedContentSlot}
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
  profile,
  draft,
  onCancel,
  onChange,
  onReset,
  onSave,
}: {
  profile: BusinessProfile;
  draft: BusinessProfile;
  onCancel: () => void;
  onChange: (profile: BusinessProfile) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const updateField = <Key extends keyof BusinessProfile>(field: Key, value: BusinessProfile[Key]) => {
    onChange({ ...draft, [field]: value });
  };
  const togglePlatform = (platform: BusinessProfile['platforms_used'][number]) => {
    const selected = draft.platforms_used.includes(platform);
    updateField(
      'platforms_used',
      selected ? draft.platforms_used.filter((item) => item !== platform) : [...draft.platforms_used, platform],
    );
  };
  const toggleVisibilityChannel = (channel: VisibilityChannel) => {
    const selected = (draft.visibility_channels ?? defaultVisibilityChannels).includes(channel);
    updateField(
      'visibility_channels',
      selected
        ? (draft.visibility_channels ?? defaultVisibilityChannels).filter((item) => item !== channel)
        : [...(draft.visibility_channels ?? defaultVisibilityChannels), channel],
    );
  };

  return (
    <section className="panel business-profile-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Business Profile</h2>
          <p>Saved business details used by weekly and single-post generation.</p>
        </div>
      </div>

      <div className="business-profile-layout">
        <aside className="business-profile-summary" aria-label="Current saved profile">
          <span>Current Saved Profile</span>
          <h3>{profile.business_name}</h3>
          <p>{profile.industry}</p>
          <div className="business-profile-pill-list">
            <strong>Service Area</strong>
            {profile.service_area_cities.map((city) => (
              <span key={city}>{city}</span>
            ))}
          </div>
          <div className="business-profile-pill-list">
            <strong>Services</strong>
            {profile.services_offered.map((service) => (
              <span key={service}>{service}</span>
            ))}
          </div>
          <div className="business-profile-summary-lines">
            <span>CTA: {profile.primary_cta}</span>
            <span>Website: {profile.website_url}</span>
            {profile.phone_number ? <span>Phone: {profile.phone_number}</span> : null}
            {profile.email ? <span>Email: {profile.email}</span> : null}
            <span>Tone: {profile.brand_tone}</span>
            <span>Target: {profile.target_customer}</span>
            <span>Visibility: {visibilityChannelsFromProfile(profile).join(', ')}</span>
          </div>
        </aside>

        <details className="business-profile-edit-panel">
          <summary>Edit</summary>
          <form
            className="business-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <label className="form-field">
              <span>Business name</span>
              <input
                value={draft.business_name}
                onChange={(event) => updateField('business_name', event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Industry / category</span>
              <input value={draft.industry} onChange={(event) => updateField('industry', event.target.value)} />
            </label>
            <label className="form-field form-field-wide">
              <span>Service area cities</span>
              <textarea
                value={formatProfileList(draft.service_area_cities)}
                onChange={(event) => updateField('service_area_cities', parseEditableProfileList(event.target.value))}
              />
            </label>
            <label className="form-field form-field-wide">
              <span>Services offered</span>
              <textarea
                value={formatProfileList(draft.services_offered)}
                onChange={(event) => updateField('services_offered', parseEditableProfileList(event.target.value))}
              />
            </label>
            <label className="form-field">
              <span>Website URL</span>
              <input value={draft.website_url} onChange={(event) => updateField('website_url', event.target.value)} />
            </label>
            <label className="form-field">
              <span>Phone number</span>
              <input value={draft.phone_number} onChange={(event) => updateField('phone_number', event.target.value)} />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input value={draft.email} onChange={(event) => updateField('email', event.target.value)} />
            </label>
            <label className="form-field">
              <span>Primary CTA</span>
              <input value={draft.primary_cta} onChange={(event) => updateField('primary_cta', event.target.value)} />
            </label>
            <label className="form-field form-field-wide">
              <span>Brand tone</span>
              <textarea value={draft.brand_tone} onChange={(event) => updateField('brand_tone', event.target.value)} />
            </label>
            <label className="form-field form-field-wide">
              <span>Target customer</span>
              <textarea
                value={draft.target_customer}
                onChange={(event) => updateField('target_customer', event.target.value)}
              />
            </label>
            <fieldset className="option-group">
              <legend>Platforms used</legend>
              <div className="checkbox-grid">
                {businessProfilePlatforms.map((platform) => (
                  <label className="checkbox-card" key={platform}>
                    <input
                      checked={draft.platforms_used.includes(platform)}
                      type="checkbox"
                      onChange={() => togglePlatform(platform)}
                    />
                    <span>{platform}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="option-group">
              <legend>Visibility channels</legend>
              <div className="checkbox-grid">
                {visibilityChannelOptions.map((channel) => (
                  <label className="checkbox-card" key={channel}>
                    <input
                      checked={(draft.visibility_channels ?? defaultVisibilityChannels).includes(channel)}
                      type="checkbox"
                      onChange={() => toggleVisibilityChannel(channel)}
                    />
                    <span>{channel}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>

          <div className="business-profile-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="danger-button" type="button" onClick={onReset}>
              Reset
            </button>
            <button className="secondary-button" type="button" onClick={onSave}>
              Save Profile
            </button>
          </div>
        </details>
      </div>
    </section>
  );
}

function PhotoLibrarySection({
  businessName,
  onAssetsChange,
  serviceOptions,
}: {
  businessName: string;
  onAssetsChange?: (assets: PhotoAsset[]) => void;
  serviceOptions: string[];
}) {
  const businessId = defaultPhotoAssetBusinessId;
  const [photoAssets, setPhotoAssets] = useState<PhotoAsset[]>([]);
  const [photoDraft, setPhotoDraft] = useState<PhotoAssetDraft>(() => createEmptyPhotoAssetDraft());
  const [showPhotoAssetModal, setShowPhotoAssetModal] = useState(false);
  const [editingPhotoAssetId, setEditingPhotoAssetId] = useState<string | null>(null);
  const [pendingDeletePhotoAssetId, setPendingDeletePhotoAssetId] = useState<string | null>(null);
  const [photoAssetBusyAction, setPhotoAssetBusyAction] = useState<'image' | 'save' | 'import' | 'delete' | null>(null);
  const [photoAssetError, setPhotoAssetError] = useState<string | null>(null);
  const [photoAssetNotice, setPhotoAssetNotice] = useState<string | null>(null);
  const [loadingPhotoAssets, setLoadingPhotoAssets] = useState(true);
  const [localPhotoImportCount, setLocalPhotoImportCount] = useState(() => loadStoredPhotoAssets().length);

  const loadBackendPhotoAssets = useCallback(async () => {
    setLoadingPhotoAssets(true);
    try {
      const loadedAssets = await getPhotoAssets(businessId);
      setPhotoAssets(loadedAssets);
      onAssetsChange?.(loadedAssets);
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
    setPhotoDraft(createEmptyPhotoAssetDraft());
    setEditingPhotoAssetId(null);
    setShowPhotoAssetModal(true);
    setPhotoAssetError(null);
    setPhotoAssetNotice(null);
  }

  function openEditPhotoModal(asset: PhotoAsset) {
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

  async function handlePhotoFileSelect(file: File | null) {
    if (!file) return;

    setPhotoAssetBusyAction('image');
    setPhotoAssetError(null);
    try {
      const imagePayload = await fileToPhotoAssetImage(file);
      setPhotoDraft((current) => ({
        ...current,
        image_data: imagePayload.image_data,
        image_url: null,
        image_filename: imagePayload.image_filename,
        title: current.title || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      }));
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to load this image.');
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleSavePhotoAsset() {
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
    const payload: PhotoAssetPayload = {
      business_id: existingAsset?.business_id ?? businessId,
      image_data: photoDraft.image_data,
      image_url: photoDraft.image_url,
      image_filename: photoDraft.image_filename,
      title,
      description: photoDraft.description.trim(),
      category: photoDraft.category,
      service_type: photoDraft.service_type.trim(),
      location: photoDraft.location.trim(),
      tags: normalizePhotoTags(photoDraft.tagsText),
      quality: photoDraft.quality,
    };

    setPhotoAssetBusyAction('save');
    setPhotoAssetError(null);
    try {
      const savedAsset = existingAsset
        ? await updatePhotoAsset(existingAsset.id, payload)
        : await createPhotoAsset(payload);
      setPhotoAssets((currentAssets) => {
        const nextAssets = existingAsset
          ? currentAssets.map((asset) => (asset.id === existingAsset.id ? savedAsset : asset))
          : [savedAsset, ...currentAssets];
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      setPhotoAssetNotice(existingAsset ? 'Photo asset updated.' : 'Photo asset added to the library.');
      closePhotoModal();
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to save this photo asset.');
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleConfirmDeletePhotoAsset() {
    if (!pendingDeletePhotoAsset) return;

    setPhotoAssetBusyAction('delete');
    setPhotoAssetError(null);
    try {
      await deletePhotoAsset(pendingDeletePhotoAsset.id, pendingDeletePhotoAsset.business_id);
      setPhotoAssets((currentAssets) => {
        const nextAssets = currentAssets.filter((asset) => asset.id !== pendingDeletePhotoAsset.id);
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      setPhotoAssetNotice('Photo asset deleted.');
      setPendingDeletePhotoAssetId(null);
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to delete this photo asset.');
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  async function handleImportStoredPhotoAssets() {
    const storedPayloads = loadStoredPhotoAssets();
    if (storedPayloads.length === 0) {
      setLocalPhotoImportCount(0);
      setPhotoAssetNotice('No local Photo Library assets were found to import.');
      return;
    }

    const importablePayloads = storedPayloads
      .filter((payload) => payload.image_data || payload.image_url)
      .map((payload) => ({
        ...payload,
        business_id: payload.business_id || businessId,
      }));

    if (importablePayloads.length === 0) {
      setPhotoAssetError('Local Photo Library assets did not include importable image data.');
      return;
    }

    setPhotoAssetBusyAction('import');
    setPhotoAssetError(null);
    try {
      const importedAssets = await Promise.all(importablePayloads.map((payload) => createPhotoAsset(payload)));
      setPhotoAssets((currentAssets) => {
        const nextAssets = [...importedAssets, ...currentAssets];
        onAssetsChange?.(nextAssets);
        return nextAssets;
      });
      window.localStorage.removeItem(photoLibraryStorageKey);
      setLocalPhotoImportCount(0);
      const skippedCount = storedPayloads.length - importablePayloads.length;
      setPhotoAssetNotice(
        skippedCount > 0
          ? `Imported ${importedAssets.length} photo assets. Skipped ${skippedCount} assets without image data.`
          : `Imported ${importedAssets.length} photo assets into backend storage.`,
      );
    } catch (err) {
      setPhotoAssetError(err instanceof Error ? err.message : 'Unable to import local Photo Library assets.');
    } finally {
      setPhotoAssetBusyAction(null);
    }
  }

  return (
    <section className="panel photo-library-panel">
      <div className="panel-heading weekly-heading">
        <div>
          <h2>Photo Library</h2>
          <p>Reusable {businessName || 'business'} project photos for content planning and weekly generation.</p>
        </div>
        <div className="panel-heading-actions">
          {localPhotoImportCount > 0 ? (
            <button
              className="secondary-button"
              disabled={photoAssetBusyAction !== null}
              type="button"
              onClick={() => void handleImportStoredPhotoAssets()}
            >
              {photoAssetBusyAction === 'import' ? 'Importing...' : `Import ${localPhotoImportCount} Local`}
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={openAddPhotoModal}>
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

      {loadingPhotoAssets ? (
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
            Upload Photo
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
  onFileSelect: (file: File | null) => Promise<void>;
  onSave: () => void;
}) {
  const imageSource = getPhotoAssetPreviewUrl(draft);

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
          <button className="secondary-button" disabled={busyAction !== null} type="button" onClick={onSave}>
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

      <form
        className="photo-asset-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="photo-asset-preview-panel">
          <div className="photo-upload-preview">
            {imageSource ? (
              <img alt={draft.title || 'Selected photo asset'} src={imageSource} />
            ) : (
              <span>No image selected</span>
            )}
          </div>
          <label className="form-field">
            <span>Image file</span>
            <input
              accept="image/*"
              type="file"
              onChange={(event) => void onFileSelect(event.currentTarget.files?.[0] ?? null)}
            />
            <small>
              {busyAction === 'image'
                ? 'Preparing image preview...'
                : editing
                  ? 'Current image is retained unless a new file is selected.'
                  : 'Upload a project photo to save it in the backend Photo Library.'}
            </small>
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
    </StandardModal>
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
  useBodyScrollLock();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-photo-asset-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="delete-photo-asset-title">Delete this photo?</h2>
            <p>{asset.title}</p>
          </div>
        </div>
        <p className="delete-confirm-message">
          This will remove the photo asset from backend storage. Generated posts that already reference images are not changed.
        </p>
        <div className="modal-actions">
          <button disabled={busy} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" disabled={busy} type="button" onClick={onConfirm}>
            {busy ? 'Deleting...' : 'Delete Photo'}
          </button>
        </div>
      </section>
    </div>
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
  const viewportWidth = typeof window === 'undefined' ? drag.sourceWidth : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? drag.sourceHeight : window.innerHeight;
  const rawX = isTouchDrag ? drag.currentX - drag.sourceWidth / 2 : drag.currentX - drag.grabOffsetX;
  const rawY = isTouchDrag ? drag.currentY - drag.sourceHeight + 28 : drag.currentY - drag.grabOffsetY;
  const previewX = Math.max(8, Math.min(rawX, viewportWidth - drag.sourceWidth - 8));
  const previewY = Math.max(8, Math.min(rawY, viewportHeight - drag.sourceHeight - 8));

  return (
    <div
      className="calendar-drag-preview"
      style={{
        height: drag.sourceHeight,
        transform: `translate3d(${previewX}px, ${previewY}px, 0)`,
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

  const modal = (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={`modal-panel standard-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
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

function VisibilityToolModal({
  copied,
  error,
  formData,
  generating,
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
  onOutputChange,
}: {
  copied: boolean;
  error: string | null;
  formData: VisibilityToolFormData;
  generating: boolean;
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
  onOutputChange: (output: string) => void;
}) {
  useBodyScrollLock();
  const serviceOptions = profile.services_offered.filter((service) => service.trim());
  const locationOptions = profile.service_area_cities.filter((location) => location.trim());
  const supportsPhoto = visibilityToolSupportsPhoto(tool.id);
  const serviceListId = `visibility-services-${tool.id}`;
  const locationListId = `visibility-locations-${tool.id}`;
  const selectedPhotoLabel = photoAsset
    ? [photoAsset.title, photoAsset.service_type, photoAsset.location].filter(Boolean).join(' - ')
    : '';
  const localReachDestinations = enabledDestinations.length > 0 ? enabledDestinations : localReachDestinationOptions;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-panel visibility-tool-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visibility-tool-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
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
              <label className="form-field">
                <span>Post destination</span>
                <select
                  value={formData.destination}
                  onChange={(event) => onChange('destination', event.target.value)}
                >
                  {localReachDestinations.map((destination) => (
                    <option key={destination}>{destination}</option>
                  ))}
                </select>
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
                <span>Service focus</span>
                <input
                  list={serviceListId}
                  value={formData.serviceFocus}
                  onChange={(event) => onChange('serviceFocus', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Location/service area</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Goal</span>
                <select value={formData.goal} onChange={(event) => onChange('goal', event.target.value)}>
                  {localReachGoalOptions.map((goal) => (
                    <option key={goal}>{goal}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Tone</span>
                <select value={formData.tone} onChange={(event) => onChange('tone', event.target.value)}>
                  {localReachToneOptions.map((tone) => (
                    <option key={tone}>{tone}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>CTA</span>
                <input value={formData.cta} onChange={(event) => onChange('cta', event.target.value)} />
              </label>
            </>
          ) : null}

          {tool.id === 'review-request' ? (
            <>
              <label className="form-field">
                <span>Customer name</span>
                <input
                  placeholder="Customer name"
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
              <label className="form-field">
                <span>Tone</span>
                <select value={formData.tone} onChange={(event) => onChange('tone', event.target.value)}>
                  <option>Friendly and professional</option>
                  <option>Warm and personal</option>
                  <option>Short and direct</option>
                </select>
              </label>
              <label className="form-field form-field-wide">
                <span>Review link</span>
                <input
                  placeholder="Google review link"
                  value={formData.reviewLink}
                  onChange={(event) => onChange('reviewLink', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tool.id === 'business-intro-post' ? (
            <>
              <label className="form-field">
                <span>Location/community</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Services to mention</span>
                <input
                  value={formData.servicesToMention}
                  onChange={(event) => onChange('servicesToMention', event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Business background/why choose us</span>
                <textarea
                  value={formData.businessBackground}
                  onChange={(event) => onChange('businessBackground', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>CTA</span>
                <input value={formData.cta} onChange={(event) => onChange('cta', event.target.value)} />
              </label>
            </>
          ) : null}

          {tool.id === 'craigslist-service-ad' ? (
            <>
              <label className="form-field">
                <span>Service focus</span>
                <input
                  list={serviceListId}
                  value={formData.serviceFocus}
                  onChange={(event) => onChange('serviceFocus', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Location/service area</span>
                <input
                  list={locationListId}
                  value={formData.location}
                  onChange={(event) => onChange('location', event.target.value)}
                />
              </label>
              <label className="form-field form-field-wide">
                <span>Offer/promo details</span>
                <textarea
                  value={formData.offerDetails}
                  onChange={(event) => onChange('offerDetails', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Customer pain point</span>
                <input
                  value={formData.customerPainPoint}
                  onChange={(event) => onChange('customerPainPoint', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>CTA</span>
                <input value={formData.cta} onChange={(event) => onChange('cta', event.target.value)} />
              </label>
              <label className="form-field form-field-wide">
                <span>Trust signals</span>
                <textarea
                  value={formData.trustSignals}
                  onChange={(event) => onChange('trustSignals', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Phone or website</span>
                <input value={formData.contact} onChange={(event) => onChange('contact', event.target.value)} />
              </label>
              <label className="form-field form-field-wide">
                <span>Notes/context</span>
                <textarea value={formData.notes} onChange={(event) => onChange('notes', event.target.value)} />
              </label>
            </>
          ) : null}

          {supportsPhoto && tool.id === 'local-reach-post' ? (
            <label className="form-field form-field-wide">
              <span>Optional photo asset</span>
              <select value={formData.photoAssetId} onChange={(event) => onChange('photoAssetId', event.target.value)}>
                <option value="">No photo selected</option>
                {photoAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {[asset.title, asset.service_type, asset.location].filter(Boolean).join(' - ')}
                  </option>
                ))}
              </select>
              {selectedPhotoLabel ? <small>{selectedPhotoLabel}</small> : null}
            </label>
          ) : null}

          {tool.id === 'craigslist-service-ad' ? (
            <fieldset className="option-group">
              <legend>Select 5-6 photo assets</legend>
              <div className="checkbox-grid content-type-grid">
                {photoAssets.map((asset) => (
                  <label className="checkbox-card" key={asset.id}>
                    <input
                      checked={formData.selectedPhotoAssetIds.includes(asset.id)}
                      disabled={
                        !formData.selectedPhotoAssetIds.includes(asset.id) &&
                        formData.selectedPhotoAssetIds.length >= 6
                      }
                      type="checkbox"
                      onChange={() => {
                        const selected = formData.selectedPhotoAssetIds.includes(asset.id);
                        onChange(
                          'selectedPhotoAssetIds',
                          selected
                            ? formData.selectedPhotoAssetIds.filter((id) => id !== asset.id)
                            : [...formData.selectedPhotoAssetIds, asset.id].slice(0, 6),
                        );
                      }}
                    />
                    <span>{[asset.title, asset.service_type, asset.location].filter(Boolean).join(' - ')}</span>
                  </label>
                ))}
              </div>
              {photoAssets.length === 0 ? <p className="empty-cell">No photo assets available yet.</p> : null}
            </fieldset>
          ) : null}

          {tool.id === 'local-reach-post' ? (
            <label className="form-field form-field-wide">
              <span>Notes/context</span>
              <textarea
                placeholder="Add project details, offer, seasonal angle, neighborhood context, or anything the copy should include."
                value={formData.notes}
                onChange={(event) => onChange('notes', event.target.value)}
              />
            </label>
          ) : null}
        </div>

        {error ? (
          <div className="photo-library-alert" role="alert">
            {error}
          </div>
        ) : null}

        <section className="visibility-output-preview">
          <div className="visibility-output-heading">
            <span>Generated output</span>
            {output?.generationMode ? (
              <em className={`generation-mode-badge generation-mode-${output.generationMode}`}>
                {output.generationMode === 'llm' ? 'AI generated' : 'Fallback generated'}
              </em>
            ) : null}
            <button className="secondary-button" disabled={!formatVisibilityResponseForCopy(output).trim()} type="button" onClick={onCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {output ? (
            <div className="visibility-output-sections">
              <label className="form-field form-field-wide">
                <span>Primary output</span>
                <textarea value={output.primary ?? ''} onChange={(event) => onOutputChange(event.target.value)} />
              </label>
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

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="secondary-button" disabled={generating} type="button" onClick={onGenerate}>
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </section>
    </div>
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
  busyAction,
  draftTextEdits,
  editingDraftId,
  photoAsset,
  slot,
  usesPhotoLibrary,
  onApprove,
  onCancelEdit,
  onChangePhoto,
  onClose,
  onDelete,
  onDraftTextChange,
  onPost,
  onRegenerate,
  onSaveDraft,
  onStartEdit,
}: {
  busyAction: BusyAction;
  draftTextEdits: Record<string, string>;
  editingDraftId: string | null;
  photoAsset: PhotoAsset | null;
  slot: ContentSlot;
  usesPhotoLibrary: boolean;
  onApprove: (item: CampaignContentQueueItem) => Promise<void>;
  onCancelEdit: (contentId: string) => void;
  onChangePhoto: (slot: ContentSlot) => void;
  onClose: () => void;
  onDelete: (item: CampaignContentQueueItem) => Promise<void>;
  onDraftTextChange: (contentId: string, draftText: string) => void;
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
              {coreCalendarPlatforms.map((platform) => (
                <span
                  className={`platform-badge ${getPlatformBadgeState(slot, platform) ? 'platform-badge-active' : ''}`}
                  key={platform}
                >
                  {platform === 'Google Business' ? 'Google' : platform}
                </span>
              ))}
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
            return (
              <details className="platform-post-section" key={post.id} open={index === 0}>
                <summary>
                  <span>
                    {post.platform}
                    {post.sourcePlatform !== post.platform ? (
                      <em>Shared {formatPlatformLabel(post.sourcePlatform)} post</em>
                    ) : null}
                  </span>
                  <span className={statusClassName(getPlanningStatus(item))}>{getPlanningStatus(item)}</span>
                </summary>
                <div className="platform-post-body">
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
                    <button
                      disabled={busyAction === `weekly-approve:${item.content_id}`}
                      type="button"
                      onClick={() => void onApprove(item)}
                    >
                      Approve
                    </button>
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
          {missingCorePlatforms.map((platform) => (
            <details className="platform-post-section platform-post-section-empty" key={`missing:${platform}`}>
              <summary>
                <span>{platform}</span>
                <span className="status-pill status-draft">Missing</span>
              </summary>
              <div className="platform-post-body">
                <p>No {platform} post has been generated for this content slot yet.</p>
              </div>
            </details>
          ))}
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
