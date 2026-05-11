import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  ApiError,
  approveCampaignContent,
  approveContent,
  deletePost,
  generateAndSave,
  generateAndSaveCampaign,
  generateManualSocialPost,
  generateWeeklySocialPosts,
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
  updatePostDraftText,
  updatePostScheduledAt,
} from './api';
import type {
  Campaign,
  CampaignContentQueueItem,
  CampaignDraftSet,
  CompletedJob,
  ContentDraft,
  ContentQueueItem,
} from './types';

type BusyAction = string | null;
type PostAssistantCopiedAction = 'caption' | null;
type CalendarPlatform = 'Facebook' | 'Instagram' | 'Google Business' | 'Facebook Groups' | 'Craigslist' | 'Nextdoor';
type WeeklySchedulePlatform = 'Facebook' | 'Instagram' | 'Google Business';

type WeeklyScheduleSettings = {
  weekStartDate: string;
  contentDays: number;
  platforms: WeeklySchedulePlatform[];
  contentTypes: string[];
  campaignTheme: string;
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

const manualPlatformOptions: CampaignContentQueueItem['platform'][] = [
  'Google Business',
  'Meta Dual',
  'Facebook Groups',
];

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

const coreCalendarPlatforms: CalendarPlatform[] = ['Facebook', 'Instagram', 'Google Business'];

const weeklySchedulePlatformOptions: WeeklySchedulePlatform[] = ['Facebook', 'Instagram', 'Google Business'];

const weeklyScheduleContentTypeOptions = [
  'Seasonal Reminder',
  'Problem/Solution',
  'Trust Local Proof',
  'Before/After',
  'Service Education',
  'Free Estimate CTA',
];

const defaultWeeklyCampaignTheme = 'Weekly Local Business Content';

const postTypeOptions = [
  'General',
  'Offer / CTA',
  'Project Highlight',
  'Before and After',
  'Seasonal Reminder',
  'Problem Solution',
  'Trust / Local Proof',
  'FAQ / Education',
  'Neighborhood Focus',
  'Preparation Tip',
  'Review Request',
];

type IconName = 'check' | 'copy' | 'download' | 'edit' | 'restore' | 'save' | 'skip' | 'trash' | 'x';

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
    platforms: [...weeklySchedulePlatformOptions],
    contentTypes: [...weeklyScheduleContentTypeOptions],
    campaignTheme: defaultWeeklyCampaignTheme,
  };
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

  const day = date.getUTCDay();
  return day === 0 ? 6 : day - 1;
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
    if (platform === 'Facebook') return post.platform === 'Facebook' || post.platform === 'Facebook Groups';
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

function getWeekdayDateInputValue(weekStartDate: string, dayIndex: number) {
  const weekStart = parseDateInputAsUtc(weekStartDate) ?? parseDateInputAsUtc(getDefaultWeekStartDateInput());
  if (!weekStart) return getDefaultWeekStartDateInput();

  const scheduledDate = new Date(weekStart);
  scheduledDate.setUTCDate(weekStart.getUTCDate() + dayIndex);
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
  const [copiedPackageId, setCopiedPackageId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftTextEdits, setDraftTextEdits] = useState<Record<string, string>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [manualPlatform, setManualPlatform] =
    useState<CampaignContentQueueItem['platform']>('Google Business');
  const [manualPostType, setManualPostType] = useState('General');
  const [includeFacebookGroups, setIncludeFacebookGroups] = useState(false);
  const [showGeneratePostOptions, setShowGeneratePostOptions] = useState(false);
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

  useEffect(() => {
    void loadCampaigns();
    void loadWeeklyQueue();
  }, [loadCampaigns, loadWeeklyQueue]);

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

  const selectedContentSlot = useMemo(() => {
    if (!selectedContentSlotId) return null;
    return weeklyContentSlots.find((slot) => slot.id === selectedContentSlotId) ?? null;
  }, [selectedContentSlotId, weeklyContentSlots]);

  const pendingDeleteContentSlot = useMemo(() => {
    if (!pendingDeleteContentSlotId) return null;
    return weeklyContentSlots.find((slot) => slot.id === pendingDeleteContentSlotId) ?? null;
  }, [pendingDeleteContentSlotId, weeklyContentSlots]);

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
      });
      setCalendarWeekStartDate(settings.weekStartDate);
      await Promise.all([loadWeeklyQueue(settings.weekStartDate), loadCampaignQueue()]);
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

  async function handleGenerateManualPost() {
    setBusyAction('generate-manual-post');
    setError(null);
    setWarning(null);
    try {
      const result = await generateManualSocialPost({
        campaign_id: selectedCampaignId || null,
        platform: manualPlatform,
        post_type: manualPostType,
      });
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
      setWarning(`Generated ${result.queue_items.length} additional post.`);
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
        campaign_id: post.item.campaign_id,
        platform: post.sourcePlatform,
        post_type: getContentItemType(post.item),
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
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetX: event.clientX - sourceRect.left,
      grabOffsetY: event.clientY - sourceRect.top,
      sourceWidth: sourceRect.width,
      sourceHeight: sourceRect.height,
      hasStarted: false,
    };
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
  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>Gomez Ops</h1>
        <button
          aria-label="Refresh"
          className="icon-button topbar-refresh-button"
          title="Refresh"
          type="button"
          onClick={() => void Promise.all([loadCampaigns(), loadWeeklyQueue()])}
        >
          <Icon name="restore" />
        </button>
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

      <section className="panel weekly-panel">
        <div className="panel-heading weekly-heading">
          <div>
            <h2>Weekly Content Calendar</h2>
            <p>Plan content by day, slot, and platform while keeping the existing post queue actions.</p>
          </div>
          <div className="panel-heading-actions">
            {loadingWeeklyQueue ? <span className="loading-label">Loading</span> : null}
            <button
              className="secondary-button"
              disabled={busyAction === 'generate-weekly-posts'}
              onClick={() => setShowWeeklyScheduleModal(true)}
            >
              Generate Weekly Posts
            </button>
            <button
              disabled={busyAction === 'generate-manual-post'}
              onClick={() => setShowGeneratePostOptions((current) => !current)}
            >
              Generate Post
            </button>
          </div>
        </div>
        {showGeneratePostOptions ? (
          <div className="manual-generate-panel">
            <div className="generation-controls" aria-label="Post generation settings">
              <select
                aria-label="Business"
                value={selectedCampaignId}
                onChange={(event) => setSelectedCampaignId(event.target.value)}
              >
                <option value="">Default business</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.campaign_id} value={campaign.campaign_id}>
                    {campaign.campaign_name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Manual post platform"
                value={manualPlatform}
                onChange={(event) => setManualPlatform(event.target.value as CampaignContentQueueItem['platform'])}
              >
                {manualPlatformOptions.map((platform) => (
                  <option key={platform} value={platform}>
                    {formatPlatformLabel(platform)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Manual post type"
                value={manualPostType}
                onChange={(event) => setManualPostType(event.target.value)}
              >
                {postTypeOptions.map((postType) => (
                  <option key={postType} value={postType}>
                    {postType}
                  </option>
                ))}
              </select>
              <label className="checkbox-control">
                <input
                  checked={includeFacebookGroups}
                  type="checkbox"
                  onChange={(event) => setIncludeFacebookGroups(event.target.checked)}
                />
                <span>Groups</span>
              </label>
            </div>
            <button
              className="secondary-button"
              disabled={busyAction === 'generate-manual-post'}
              onClick={() => void handleGenerateManualPost()}
            >
              Create Post
            </button>
          </div>
        ) : null}

        {weeklyCampaignCalendars.length > 0 ? (
          <div className="weekly-campaign-summary" aria-label="Weekly campaign summary">
            {weeklyCampaignCalendars.map((campaignCalendar) => (
              <span key={`${campaignCalendar.campaignId}:${campaignCalendar.weekKey}`}>
                <strong>{campaignCalendar.business}</strong>
                {campaignCalendar.weekKey} · {campaignCalendar.contentSlots.length} slots
              </span>
            ))}
          </div>
        ) : null}

        {weeklyContentSlots.length > 0 ? (
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
                    {day.contentSlots.map((slot) => (
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
                            <span>{slot.business}</span>
                            <span>{formatDisplayDate(slot.scheduledAt)}</span>
                          </div>
                          <div className="platform-badge-row" aria-label="Generated platforms">
                            {coreCalendarPlatforms.map((platform) => (
                              <span
                                className={`platform-badge ${
                                  getPlatformBadgeState(slot, platform) ? 'platform-badge-active' : ''
                                }`}
                                key={platform}
                              >
                                {platform === 'Google Business' ? 'Google' : platform}
                              </span>
                            ))}
                          </div>
                          <div className="content-slot-status">
                            <span>{slot.statusSummary}</span>
                            <span>{slot.platformPosts.length} platform posts</span>
                          </div>
                        </div>
                        <div className="content-slot-drag-affordance" data-calendar-drag-handle="true" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="calendar-empty-cell">No slots</div>
                )}
              </details>
            ))}
          </div>
        ) : null}
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

      {false ? (
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
      {selectedContentSlot ? (
        <ContentSlotDetailModal
          busyAction={busyAction}
          draftTextEdits={draftTextEdits}
          editingDraftId={editingDraftId}
          slot={selectedContentSlot}
          onApprove={handleApproveWeeklyPost}
          onCancelEdit={cancelEditingDraft}
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

  return (
    <div
      className="calendar-drag-preview"
      style={{
        height: drag.sourceHeight,
        transform: `translate3d(${drag.currentX - drag.grabOffsetX}px, ${drag.currentY - drag.grabOffsetY}px, 0)`,
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

function ContentSlotDetailModal({
  busyAction,
  draftTextEdits,
  editingDraftId,
  slot,
  onApprove,
  onCancelEdit,
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
  slot: ContentSlot;
  onApprove: (item: CampaignContentQueueItem) => Promise<void>;
  onCancelEdit: (contentId: string) => void;
  onClose: () => void;
  onDelete: (item: CampaignContentQueueItem) => Promise<void>;
  onDraftTextChange: (contentId: string, draftText: string) => void;
  onPost: (item: CampaignContentQueueItem) => void;
  onRegenerate: (post: PlatformPost) => Promise<void>;
  onSaveDraft: (item: CampaignContentQueueItem) => Promise<void>;
  onStartEdit: (item: CampaignContentQueueItem) => void;
}) {
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
