require('dotenv').config();
const Fastify = require('fastify');
const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const { randomUUID } = require('crypto');
const { getDb, connect } = require('./utils/MongoDBConnector');
const { createLogger } = require('./utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8084';

const PLATFORM_SERVICES = {
  twitter:   process.env.TWITTER_SERVICE_URL   || 'http://twitter:3001',
  linkedin:  process.env.LINKEDIN_SERVICE_URL  || 'http://linkedin:3002',
  mastodon:  process.env.MASTODON_SERVICE_URL  || 'http://mastodon:3003',
  bluesky:   process.env.BLUESKY_SERVICE_URL   || 'http://bluesky:3004',
  instagram: process.env.INSTAGRAM_SERVICE_URL || 'http://instagram:3005',
  facebook:  process.env.FACEBOOK_SERVICE_URL  || 'http://facebook:3006',
  pinterest: process.env.PINTEREST_SERVICE_URL || 'http://pinterest:3008',
  tiktok:    process.env.TIKTOK_SERVICE_URL    || 'http://tiktok:3007',
};

const log = createLogger('scheduler');
const app = Fastify({ logger: log });
let postQueue;
let redis;

// ─── Job Worker ──────────────────────────────────────────────────────────────

async function processPostJob(job) {
  // destinations: [{ platform, accountId?, imageUrl?, videoUrl?, link? }]
  // Falls back to legacy { platforms: string[] } format
  const { postId, content, destinations, platforms, media = [], firstComment, workspaceId = 'default' } = job.data;
  // Ensure every post has a stable ID for analytics tracking
  const effectivePostId = postId || randomUUID();

  const destList = destinations || (platforms || []).map((p) => ({ platform: p }));
  log.info({ action: 'job_process', jobId: job.id, attempt: job.attemptsMade + 1, destinations: destList.map((d) => d.accountId ? `${d.platform}:${d.accountId}` : d.platform) });

  const db = await getDb();

  // Load any results already recorded from previous attempts so we can skip
  // destinations that already succeeded — preventing duplicate posts on retry.
  const existingPost = await db.collection('posts').findOne({ _id: effectivePostId }, { projection: { platformResults: 1 } });
  const results = { ...(existingPost?.platformResults || {}) };

  for (const dest of destList) {
    const { platform, accountId, imageUrl, videoUrl, link } = dest;
    const resultKey = accountId ? `${platform}:${accountId}` : platform;

    if (results[resultKey]?.success) {
      log.info({ action: 'job_skip_dest', jobId: job.id, destination: resultKey, reason: 'already_published' });
      continue;
    }

    const serviceUrl = PLATFORM_SERVICES[platform];
    if (!serviceUrl) {
      results[resultKey] = { success: false, error: 'Unknown platform' };
      continue;
    }
    try {
      const response = await axios.post(
        `${serviceUrl}/post`,
        { content, accountId, imageUrl, videoUrl, link, media, firstComment: firstComment?.trim() || undefined },
        { timeout: 30000, headers: { 'X-Workspace-Id': workspaceId } }
      );
      // response.data.result may be an array (multi-page services return [{ postId, ... }])
      // or a plain object. Normalise to a single object so results[key] is flat.
      const raw = response.data.result;
      const flat = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
      results[resultKey] = { success: true, ...flat };
    } catch (err) {
      const apiError = err.response?.data?.error || err.message;
      results[resultKey] = { success: false, error: apiError };
    }
  }

  const allOk  = Object.values(results).every((r) => r.success);
  const anyOk  = Object.values(results).some((r) => r.success);
  const postStatus = allOk ? 'published' : anyOk ? 'partial' : 'failed';

  await db.collection('posts').updateOne(
    { _id: effectivePostId },
    {
      $set: {
        content,
        destinations: destList,
        type: 'scheduled',
        status: postStatus,
        publishedAt: new Date(),
        platformResults: results,
        workspaceId,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await db.collection('scheduled_jobs').updateOne(
    { bullJobId: String(job.id) },
    {
      $set: {
        status: postStatus,  // 'published' | 'partial' | 'failed'
        completedAt: new Date(),
        platformResults: results,
      },
    }
  );

  return results;
}

// ─── System Job Worker ────────────────────────────────────────────────────────

async function processSystemJob(job) {
  if (job.name === 'meta-token-refresh') {
    log.info({ action: 'token_refresh', trigger: 'scheduled', outcome: 'start' });
    const res = await axios.post(`${GATEWAY_URL}/meta/token-refresh`, {}, { timeout: 60000 });
    log.info({ action: 'token_refresh', trigger: 'scheduled', outcome: 'success', refreshed: res.data.refreshed, skipped: res.data.skipped, errors: res.data.errors });
    return res.data;
  }
  if (job.name === 'metrics-crawl') {
    log.info({ action: 'metrics_crawl', trigger: 'scheduled', outcome: 'start' });
    const res = await axios.post(`${GATEWAY_URL}/analytics/crawl`, {}, { timeout: 120000 });
    log.info({ action: 'metrics_crawl', trigger: 'scheduled', outcome: 'success', total: res.data.total });
    return res.data;
  }
  if (job.name === 'competitor-scrape') {
    log.info({ action: 'competitor_scrape', trigger: 'scheduled', outcome: 'start' });
    const res = await axios.post(`${GATEWAY_URL}/competitors/scrape-all`, {}, { timeout: 120000 });
    log.info({ action: 'competitor_scrape', trigger: 'scheduled', outcome: 'success', results: res.data.results?.length });
    return res.data;
  }
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'scheduler' }));

// Create a scheduled post.
// Body: { content, scheduledAt, destinations: [{ platform, accountId?, imageUrl?, videoUrl?, link? }] }
// Legacy { platforms: string[] } still accepted for backwards compatibility.
app.post('/schedule', async (request, reply) => {
  const { postId, content, destinations, platforms, scheduledAt, media = [], firstComment } = request.body;
  const workspaceId = request.headers['x-workspace-id'] || 'default';

  const destList = destinations || (platforms || []).map((p) => ({ platform: p }));

  if (!content || !destList.length || !scheduledAt) {
    return reply.code(400).send({ error: 'content, destinations, and scheduledAt are required' });
  }

  const delay = new Date(scheduledAt).getTime() - Date.now();
  if (delay < 0) {
    return reply.code(400).send({ error: 'scheduledAt must be in the future' });
  }

  const job = await postQueue.add(
    'scheduled-post',
    { postId, content, destinations: destList, media, firstComment: firstComment?.trim() || undefined, workspaceId },
    { delay, attempts: 3, backoff: { type: 'exponential', delay: 60000 } }
  );

  const db = await getDb();
  await db.collection('scheduled_jobs').insertOne({
    postId,
    type: 'one-time',
    content,
    scheduledAt: new Date(scheduledAt),
    destinations: destList,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    bullJobId: String(job.id),
    workspaceId,
    createdAt: new Date(),
  });

  return { success: true, jobId: job.id, scheduledAt };
});

// Zamanlanmış görevleri listele
app.get('/jobs', async (request) => {
  const { status = 'pending' } = request.query;
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  const db = await getDb();
  // Include legacy jobs without workspaceId (backwards compat)
  const filter = { status, $or: [{ workspaceId }, { workspaceId: { $exists: false } }] };
  const jobs = await db
    .collection('scheduled_jobs')
    .find(filter)
    .sort({ scheduledAt: 1 })
    .toArray();
  return { success: true, count: jobs.length, jobs };
});

// Görevi iptal et
app.delete('/jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const workspaceId = request.headers['x-workspace-id'] || 'default';

  const db = await getDb();
  const jobDoc = await db.collection('scheduled_jobs').findOne({
    bullJobId: jobId,
    $or: [{ workspaceId }, { workspaceId: { $exists: false } }],
  });
  if (!jobDoc) return reply.code(404).send({ error: 'Job bulunamadı' });

  const job = await postQueue.getJob(jobId);
  if (job) await job.remove();

  await db.collection('scheduled_jobs').updateOne(
    { bullJobId: jobId },
    { $set: { status: 'cancelled' } }
  );

  return { success: true, jobId };
});

// ─── Başlatma ────────────────────────────────────────────────────────────────

async function start() {
  await connect();

  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  postQueue = new Queue('post-queue', { connection: redis });

  const worker = new Worker('post-queue', processPostJob, { connection: redis });
  worker.on('failed', async (job, err) => {
    log.error({ action: 'job_process', jobId: job?.id, outcome: 'failure', err: err.message });
    if (job?.id) {
      try {
        const db = await getDb();
        await db.collection('scheduled_jobs').updateOne(
          { bullJobId: String(job.id), status: 'pending' },
          { $set: { status: 'failed', failedAt: new Date(), failReason: err.message } }
        );
      } catch (_) { /* non-fatal */ }
    }
  });

  // Daily system jobs (housekeeping, token refresh, etc.)
  const systemQueue = new Queue('system-queue', { connection: redis });
  const systemWorker = new Worker('system-queue', processSystemJob, { connection: redis });
  systemWorker.on('failed', (job, err) => {
    log.error({ action: 'system_job', jobId: job?.id, jobName: job?.name, outcome: 'failure', err: err.message });
  });

  // Register daily system jobs — BullMQ deduplicates by repeat key on restart
  await systemQueue.add(
    'meta-token-refresh',
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'meta-token-refresh', interval: '24h', outcome: 'success' });

  await systemQueue.add(
    'metrics-crawl',
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'metrics-crawl', interval: '24h', outcome: 'success' });

  await systemQueue.add(
    'competitor-scrape',
    {},
    { repeat: { every: 7 * 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'competitor-scrape', interval: '7d', outcome: 'success' });

  await app.listen({ port: process.env.PORT || 3011, host: '0.0.0.0' });
  log.info({ action: 'service_start', port: 3011, outcome: 'success' }, 'Scheduler started');
}

start().catch((err) => { log.error({ action: 'service_start', outcome: 'failure', err: err.message }); process.exit(1); });
