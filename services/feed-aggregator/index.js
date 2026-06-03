require('dotenv').config();
const Fastify = require('fastify');
const axios = require('axios');
const cron = require('node-cron');
const { getDb } = require('./utils/MongoDBConnector');
const RabbitMQProducer = require('./utils/RabbitMQProducer');
const { createLogger } = require('./utils/logger');

const FEED_REFRESH_INTERVAL = process.env.FEED_REFRESH_INTERVAL || '*/5 * * * *';

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

const log = createLogger('feed-aggregator');
const app = Fastify({ logger: log });
let producer;

// ─── Feed Çekme ──────────────────────────────────────────────────────────────

async function fetchPlatformFeed(platform, serviceUrl, workspaceId = 'default') {
  try {
    const response = await axios.get(`${serviceUrl}/feed`, {
      timeout: 15000,
      headers: { 'X-Workspace-Id': workspaceId },
    });
    const items = response.data.items || [];
    log.info({ action: 'feed_fetch', platform, count: items.length, outcome: 'success' });

    // WebSocket üzerinden UI'ya bildir
    if (producer && items.length > 0) {
      await producer.sendMessage('feed.items', JSON.stringify({ platform, items, fetchedAt: new Date() }));
    }

    return items;
  } catch (err) {
    log.error({ action: 'feed_fetch', platform, outcome: 'failure', err: err.message });
    return [];
  }
}

async function fetchAllFeeds() {
  log.info({ action: 'feed_fetch_all' }, 'Fetching feeds from all platforms');

  const results = await Promise.allSettled(
    Object.entries(PLATFORM_SERVICES).map(([platform, url]) =>
      fetchPlatformFeed(platform, url)
    )
  );

  const summary = {};
  Object.keys(PLATFORM_SERVICES).forEach((platform, i) => {
    summary[platform] = results[i].status === 'fulfilled' ? results[i].value.length : 0;
  });

  log.info({ action: 'feed_fetch_all', outcome: 'success', summary });
  return summary;
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'feed-aggregator' }));

app.post('/fetch', async (request) => {
  const { platform } = request.body || {};
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  if (platform && PLATFORM_SERVICES[platform]) {
    const items = await fetchPlatformFeed(platform, PLATFORM_SERVICES[platform], workspaceId);
    return { success: true, platform, count: items.length };
  }
  const summary = await fetchAllFeeds();
  return { success: true, summary };
});

app.get('/feeds', async (request) => {
  const { platform, tag, limit = 50, skip = 0 } = request.query;
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  const db = await getDb();
  const col = db.collection('feeds');

  // Include legacy items without workspaceId (backwards compat)
  const filter = { $or: [{ workspaceId }, { workspaceId: { $exists: false } }] };
  if (platform) filter.platform = platform;
  if (tag) filter.tags = tag;

  const items = await col
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(Number(skip))
    .limit(Number(limit))
    .toArray();

  return { success: true, count: items.length, items };
});

app.get('/platform-status', async (request) => {
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  const statuses = await Promise.allSettled(
    Object.entries(PLATFORM_SERVICES).map(async ([platform, url]) => {
      const response = await axios.get(`${url}/status`, {
        timeout: 5000,
        headers: { 'X-Workspace-Id': workspaceId },
      });
      return { platform, ...response.data };
    })
  );

  return statuses.map((r, i) => {
    const platform = Object.keys(PLATFORM_SERVICES)[i];
    return r.status === 'fulfilled'
      ? r.value
      : { platform, connected: false, error: r.reason.message };
  });
});

// ─── Başlatma ────────────────────────────────────────────────────────────────

async function start() {
  producer = new RabbitMQProducer();
  await producer.connect();

  // Periyodik feed yenileme
  cron.schedule(FEED_REFRESH_INTERVAL, () => {
    fetchAllFeeds().catch((err) => log.error({ action: 'feed_fetch_all', outcome: 'failure', err: err.message }));
  });

  await app.listen({ port: process.env.PORT || 3010, host: '0.0.0.0' });
  log.info({ action: 'service_start', outcome: 'success', cronInterval: FEED_REFRESH_INTERVAL }, 'Feed aggregator started');

  // İlk çalıştırma
  setTimeout(() => fetchAllFeeds(), 5000);
}

start().catch((err) => { log.error({ action: 'service_start', outcome: 'failure', err: err.message }); process.exit(1); });
