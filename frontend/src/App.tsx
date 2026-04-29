import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  approveCampaignContent,
  approveContent,
  generateAndSave,
  generateAndSaveCampaign,
  getCampaignContentQueue,
  getCampaigns,
  getContentQueue,
  getJobs,
  getMediaUrl,
  markCampaignPublished,
  markPublished,
  previewCampaignDrafts,
  previewDraft,
  publishCampaignContent,
  rejectCampaignContent,
  rejectContent,
  runDuePublishing,
  scheduleCampaignContent,
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
  'Google Business': 2,
  Instagram: 3,
  Craigslist: 4,
  Nextdoor: 5,
};

function queueGroupDomId(jobId: string) {
  return `queue-group-${jobId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function campaignQueueGroupDomId(campaignId: string) {
  return `campaign-queue-group-${campaignId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function formatCampaignCopyPackage(item: CampaignContentQueueItem) {
  return [
    `Platform: ${item.platform}`,
    '',
    'Post:',
    item.draft_text,
    '',
    `CTA: ${item.cta}`,
    `URL: ${item.landing_page_url}`,
    `Image: ${item.image_filename ?? 'None selected'}`,
    `Image Path: ${item.image_path ?? 'None selected'}`,
  ].join('\n');
}

function isCampaignItemPublishable(item: CampaignContentQueueItem) {
  if (
    item.status === 'Rejected' ||
    item.status === 'Needs Review' ||
    item.status === 'Published' ||
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

function App() {
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [queue, setQueue] = useState<ContentQueueItem[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignQueue, setCampaignQueue] = useState<CampaignContentQueueItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingCampaignQueue, setLoadingCampaignQueue] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [copiedPackageId, setCopiedPackageId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [expandedQueueJobs, setExpandedQueueJobs] = useState<Record<string, boolean>>({});
  const [expandedCampaignQueue, setExpandedCampaignQueue] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    void loadJobs();
    void loadQueue();
    void loadCampaigns();
    void loadCampaignQueue();
  }, [loadCampaigns, loadCampaignQueue, loadJobs, loadQueue]);

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
      setWarning(`Run due publishing completed. Published: ${publishedCount}. Failed: ${failedCount}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run due publishing.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Gomez Ops</h1>
          <p>Completed jobs, generated drafts, and approval status.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => void Promise.all([loadJobs(), loadQueue(), loadCampaigns(), loadCampaignQueue()])}
        >
          Refresh
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
              Run Due Publishing
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
                              {item.image_path ? (
                                <a
                                  className="campaign-image-preview"
                                  href={getMediaUrl(item.image_path)}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <img alt={item.image_filename ?? 'Campaign image'} src={getMediaUrl(item.image_path)} />
                                </a>
                              ) : null}
                              <span>Image: {item.image_filename ?? 'None selected'}</span>
                              {item.image_path ? <span>Image Path: {item.image_path}</span> : null}
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
                            {isCampaignItemPublishable(item) ? (
                              <button
                                disabled={busyAction === `campaign-publish:${item.content_id}`}
                                onClick={() => void handlePublishCampaignContent(item)}
                              >
                                Publish
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

      {preview ? <DraftPreview preview={preview} onClose={() => setPreview(null)} /> : null}
      {campaignPreview ? (
        <CampaignDraftPreview preview={campaignPreview} onClose={() => setCampaignPreview(null)} />
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
