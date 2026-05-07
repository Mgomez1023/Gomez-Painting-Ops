import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  ApiError,
  approveCampaignContent,
  approveContent,
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
type DashboardTab = 'posts' | 'operations';
type PostAssistantCopiedAction = 'caption' | null;

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

const postTypeOptions = ['General', 'Project Highlight', 'Before and After', 'Offer', 'Review Request'];

type IconName = 'check' | 'copy' | 'download' | 'edit' | 'restore' | 'save' | 'skip' | 'x';

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

function getCampaignItemBusiness(item: CampaignContentQueueItem) {
  return item.business ?? readNoteValue(item.notes, 'Business') ?? item.campaign_id;
}

function readNoteValue(notes: string, key: string) {
  const prefix = `${key.toLowerCase()}:`;
  const line = notes.split('\n').find((noteLine) => noteLine.trim().toLowerCase().startsWith(prefix));
  return line?.split(':', 2)[1]?.trim() || null;
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
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>('posts');
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
  const [showPreviousPosts, setShowPreviousPosts] = useState(false);
  const [expandedQueueJobs, setExpandedQueueJobs] = useState<Record<string, boolean>>({});
  const [expandedCampaignQueue, setExpandedCampaignQueue] = useState<Record<string, boolean>>({});
  const [postAssistantItem, setPostAssistantItem] = useState<CampaignContentQueueItem | null>(null);
  const [postAssistantCopiedAction, setPostAssistantCopiedAction] = useState<PostAssistantCopiedAction>(null);
  const [postAssistantError, setPostAssistantError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ job: CompletedJob; draft: ContentDraft } | null>(null);
  const [campaignPreview, setCampaignPreview] = useState<{ campaign: Campaign; draftSet: CampaignDraftSet } | null>(
    null,
  );

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

  const loadWeeklyQueue = useCallback(async () => {
    setLoadingWeeklyQueue(true);
    try {
      setWeeklyQueue(await getWeeklySocialQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load weekly posting queue.');
    } finally {
      setLoadingWeeklyQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    void loadQueue();
    void loadCampaigns();
    void loadCampaignQueue();
    void loadWeeklyQueue();
  }, [loadCampaigns, loadCampaignQueue, loadJobs, loadQueue, loadWeeklyQueue]);

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
      const scheduledCompare = (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '');
      if (scheduledCompare !== 0) return scheduledCompare;
      return campaignPlatformOrder[a.platform] - campaignPlatformOrder[b.platform];
    });
  }, [weeklyQueue]);

  const activeWeeklyQueueItems = useMemo(() => {
    return weeklyQueueItems.filter((item) => item.status !== 'Posted' && item.status !== 'Skipped');
  }, [weeklyQueueItems]);

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

  async function handleGenerateWeeklyPosts() {
    setBusyAction('generate-weekly-posts');
    setError(null);
    setWarning(null);
    try {
      const result = await generateWeeklySocialPosts({
        campaign_id: selectedCampaignId || null,
        include_facebook_groups: includeFacebookGroups,
      });
      await Promise.all([loadWeeklyQueue(), loadCampaignQueue()]);
      setWarning(
        result.existing
          ? 'This week already has social posts. Showing the existing queue.'
          : `Generated ${result.queue_items.length} posts for this week.`,
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
          onClick={() =>
            void Promise.all([loadJobs(), loadQueue(), loadCampaigns(), loadCampaignQueue(), loadWeeklyQueue()])
          }
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

      <div className="dashboard-switcher-wrap">
        <div className="dashboard-switcher" data-active={activeDashboardTab} role="tablist" aria-label="Dashboard view">
          <button
            aria-selected={activeDashboardTab === 'posts'}
            className={activeDashboardTab === 'posts' ? 'active' : ''}
            role="tab"
            type="button"
            onClick={() => setActiveDashboardTab('posts')}
          >
            Posts
          </button>
          <button
            aria-selected={activeDashboardTab === 'operations'}
            className={activeDashboardTab === 'operations' ? 'active' : ''}
            role="tab"
            type="button"
            onClick={() => setActiveDashboardTab('operations')}
          >
            Jobs + Queues
          </button>
        </div>
      </div>

      {activeDashboardTab === 'operations' ? (
      <section className="summary-grid" aria-label="Dashboard summary">
        <div className="metric">
          <span>Completed Jobs</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="metric">
          <span>Queue Items</span>
          <strong>{queue.length}</strong>
        </div>
        <div className="metric">
          <span>Needs Review</span>
          <strong>{queueCounts['Needs Review'] ?? 0}</strong>
        </div>
        <div className="metric">
          <span>Approved</span>
          <strong>{queueCounts.Approved ?? 0}</strong>
        </div>
        <div className="metric">
          <span>Campaigns</span>
          <strong>{campaigns.length}</strong>
        </div>
        <div className="metric">
          <span>Campaign Drafts</span>
          <strong>{campaignQueue.length}</strong>
        </div>
        <div className="metric">
          <span>Campaign Needs Review</span>
          <strong>{campaignQueueCounts['Needs Review'] ?? 0}</strong>
        </div>
        <div className="metric">
          <span>Campaign Approved</span>
          <strong>{campaignQueueCounts.Approved ?? 0}</strong>
        </div>
      </section>
      ) : null}

      {activeDashboardTab === 'posts' ? (
      <section className="panel weekly-panel">
        <div className="panel-heading weekly-heading">
          <div>
            <h2>Posts to Publish This Week</h2>
          </div>
          <div className="panel-heading-actions">
            {loadingWeeklyQueue ? <span className="loading-label">Loading</span> : null}
            <button
              className="secondary-button"
              disabled={busyAction === 'generate-weekly-posts'}
              onClick={() => void handleGenerateWeeklyPosts()}
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

        {activeWeeklyQueueItems.length > 0 ? (
          <div className="weekly-post-grid">
            {activeWeeklyQueueItems.map((item) => {
              const imageSource = getCampaignItemImageSource(item);
              return (
                <article className="weekly-post-card" key={item.content_id}>
                  <div className="weekly-post-media">
                    {imageSource ? (
                      <img
                        alt={item.image_filename ?? `${formatPlatformLabel(item.platform)} post image`}
                        src={getMediaUrl(imageSource)}
                      />
                    ) : (
                      <span>No image</span>
                    )}
                  </div>
                  <div className="weekly-post-content">
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
                      <span>{formatDisplayDate(item.scheduled_at)}</span>
                      {item.post_type ? <span>{item.post_type}</span> : null}
                    </div>
                    {editingDraftId === item.content_id ? (
                      <div className="draft-edit-block">
                        <textarea
                          aria-label={`Edit ${formatPlatformLabel(item.platform)} draft text`}
                          value={draftTextEdits[item.content_id] ?? item.draft_text}
                          onChange={(event) =>
                            setDraftTextEdits((current) => ({
                              ...current,
                              [item.content_id]: event.target.value,
                            }))
                          }
                        />
                        <div className="draft-edit-actions">
                          <button
                            aria-label="Save draft"
                            className="icon-button secondary-button"
                            disabled={busyAction === `weekly-save-draft:${item.content_id}`}
                            title="Save draft"
                            onClick={() => void handleSaveDraftText(item)}
                          >
                            <Icon name="save" />
                          </button>
                          <button
                            aria-label="Cancel draft edit"
                            className="icon-button"
                            disabled={busyAction === `weekly-save-draft:${item.content_id}`}
                            title="Cancel"
                            onClick={() => cancelEditingDraft(item.content_id)}
                          >
                            <Icon name="x" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <details className="caption-block">
                        <summary>{item.draft_text}</summary>
                        <p>{item.draft_text}</p>
                      </details>
                    )}
                    <div className="weekly-post-links">
                      {item.image_url ? (
                        <a href={item.image_url} rel="noreferrer" target="_blank">
                          Image URL
                        </a>
                      ) : null}
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
                  </div>
                  <div className="weekly-post-actions">
                    <button
                      className="post-assistant-open-button"
                      type="button"
                      onClick={() => openPostAssistant(item)}
                    >
                      Post
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        {!loadingWeeklyQueue && activeWeeklyQueueItems.length === 0 ? (
          <div className="empty-cell">No posts are queued for this week yet.</div>
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
                          <span>Scheduled: {formatDisplayDate(item.scheduled_at)}</span>
                        </div>
                        <p>{item.draft_text}</p>
                      </div>
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

      {activeDashboardTab === 'operations' ? (
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
              <span>{formatDisplayDate(postAssistantItem.scheduled_at)}</span>
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
