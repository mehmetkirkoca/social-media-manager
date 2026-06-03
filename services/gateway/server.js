require('dotenv').config();
const { createLogger } = require('./utils/logger');
const log = createLogger('gateway');
const app = require('fastify')({ logger: log });
const multipart = require('@fastify/multipart');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { ObjectId } = require('mongodb');
const { getDb } = require('./utils/MongoDBConnector');
const { encryptToken, decryptToken, warnIfNoKey } = require('./utils/crypto');
const RabbitMQProducer = require('./utils/RabbitMQProducer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi']);
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// In-memory job state for async competitor scrapes.
// Max 2 competitors, scrapes complete in seconds — no persistence needed.
const activeScrapeJobs = new Map();

// ─── Platform-native writing rules ────────────────────────────────────────────
// Injected into the AI system prompt when destinations are known.
const PLATFORM_WRITING_RULES = {
  twitter: [
    'Keep the post under 200 characters for maximum retweetability.',
    'Use zero to one hashtag — more than one significantly hurts reach.',
    'End with a question or provocation to drive replies.',
    'No slow intros — the hook must land in the opening clause.',
  ],
  linkedin: [
    'Only the first 2–3 lines are visible before "see more" — the hook must grab immediately.',
    'Put external links in the first comment, not the post body — links in copy reduce reach.',
    'Use 2–3 hashtags maximum, placed at the very end of the post.',
    'Write for practitioners and decision-makers using clear, direct language.',
  ],
  instagram: [
    'Only the first ~125 characters show before "more" — front-load the hook.',
    'For Reels: hook text must appear on-screen within the first 1 second; assume silent viewing, so text overlays are essential.',
    'Carousels get the highest saves — use them for educational or step-by-step content.',
    'End with a clear call-to-action.',
  ],
  facebook: [
    'First 3 lines visible before "See more" — lead with the most engaging line.',
    'Conversational tone outperforms corporate language.',
    'Questions and polls significantly boost comments and reach.',
    'External links reduce reach — consider placing the link in the first comment.',
  ],
  tiktok: [
    'The very first spoken word or on-screen text must hook the viewer at second 0 — no slow intros.',
    'Creator-native feel performs far better than polished corporate openers.',
    'End every script with a comment-bait line (a question or debate prompt).',
    'Optimal caption length: short and punchy; the hook lives in the video, not the caption.',
  ],
  youtube: [
    'Title must be written for search — include the primary keyword near the front.',
    'Open the script with a 15-second hook that states the value proposition immediately.',
    'First 2 lines of the description appear in search results — write them for click-through.',
    'Always include timestamps/chapters in longer-form descriptions.',
  ],
  pinterest: [
    'Pinterest is a search engine — descriptions must be keyword-rich prose, not hashtag fragments.',
    'Every pin should link somewhere relevant; linkless pins underperform.',
    'Vertical 2:3 format is optimal for feed visibility.',
    'Use natural-language keyword phrases (e.g. "easy weeknight dinner ideas") not isolated keywords.',
  ],
  reddit: [
    'Reddit is a community channel, not a publishing channel — never pitch directly.',
    'Write like a practitioner who works at the brand, not a marketer who works for it.',
    'Lead with value: useful data, a genuine question, or an interesting observation.',
    'Match the subreddit tone exactly — formal communities reject casual posts and vice versa.',
  ],
  mastodon: [
    'Mastodon users value authenticity — corporate marketing tone is poorly received.',
    'Use 3–5 relevant hashtags; they are the primary discovery mechanism on Mastodon.',
    'Longer posts should use a CW (content warning) as a brief summary — this is a community norm.',
    'Engagement comes from genuine conversation, not broadcast-style posting.',
  ],
  bluesky: [
    'Bluesky rewards original perspectives — repurposed content from other platforms underperforms.',
    'Threads work well for longer ideas; each post in the thread should stand alone.',
    'Use 1–2 hashtags if any — hashtag culture is still developing on Bluesky.',
    'Substance drives sharing here more than engagement-bait does.',
  ],
};

function buildPlatformRulesBlock(destinations) {
  if (!destinations?.length) return '';
  const platforms = [...new Set(destinations.map((d) => d.platform).filter(Boolean))];
  const blocks = platforms
    .map((p) => {
      const rules = PLATFORM_WRITING_RULES[p];
      if (!rules?.length) return null;
      const name = p.charAt(0).toUpperCase() + p.slice(1);
      return `${name} rules:\n${rules.map((r) => `- ${r}`).join('\n')}`;
    })
    .filter(Boolean);
  if (!blocks.length) return '';
  return '\n\nPLATFORM-SPECIFIC WRITING RULES (follow these for every post on this platform):\n' + blocks.join('\n\n');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });

const GRAPH_API = 'https://graph.facebook.com/v22.0';

// The public base URL of this app (used for OAuth redirect_uri)
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8081';

// ─── CORS ────────────────────────────────────────────────────────────────────

app.addHook('onSend', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Workspace-Id');
});

// Inject workspace context into every request
app.addHook('preHandler', async (request) => {
  request.workspaceId = request.headers['x-workspace-id'] || 'default';
});

app.options('*', async (request, reply) => {
  reply.code(204).send();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Compound credential key: workspaceId + credential type
function credId(ws, type) { return `${ws}:${type}`; }

// Global credential types are not workspace-scoped (AI config, app credentials)
const GLOBAL_CREDENTIAL_TYPES = new Set([
  'ai_config', 'openai_config', 'groq_config', 'gemini_config',
  'meta_app', 'pinterest_app', 'tiktok_app', 'google_places',
]);

async function getCredentials(ws, type) {
  const db = await getDb();
  const id = GLOBAL_CREDENTIAL_TYPES.has(type) ? type : credId(ws, type);
  const doc = await db.collection('platform_credentials').findOne({ _id: id });
  // Fallback: if global credential not found under bare key, check the erroneously
  // workspace-prefixed key that an earlier migration may have created.
  if (!doc && GLOBAL_CREDENTIAL_TYPES.has(type)) {
    return db.collection('platform_credentials').findOne({ _id: credId(ws, type) });
  }
  return doc;
}

async function setCredentials(ws, type, data) {
  const isGlobal = GLOBAL_CREDENTIAL_TYPES.has(type);
  const id = isGlobal ? type : credId(ws, type);
  const db = await getDb();
  const meta = isGlobal ? {} : { workspaceId: ws };
  await db.collection('platform_credentials').updateOne(
    { _id: id },
    { $set: { _id: id, type, ...meta, ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteCredentials(ws, type) {
  const db = await getDb();
  const id = GLOBAL_CREDENTIAL_TYPES.has(type) ? type : credId(ws, type);
  await db.collection('platform_credentials').deleteOne({ _id: id });
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

app.get('/workspaces', async () => {
  const db = await getDb();
  const list = await db.collection('workspaces').find({}).sort({ createdAt: 1 }).toArray();
  return { workspaces: list };
});

app.post('/workspaces', async (request, reply) => {
  const { name, color } = request.body || {};
  if (!name?.trim()) return reply.code(400).send({ error: 'Workspace name is required' });
  const db = await getDb();
  const id = `ws_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const doc = { _id: id, name: name.trim(), color: color || '#3B82F6', createdAt: new Date(), updatedAt: new Date() };
  await db.collection('workspaces').insertOne(doc);
  log.info({ action: 'workspace_create', workspaceId: id, name: doc.name, outcome: 'success' });
  return reply.code(201).send(doc);
});

app.put('/workspaces/:id', async (request, reply) => {
  const { id } = request.params;
  const { name, color } = request.body || {};
  if (!name?.trim()) return reply.code(400).send({ error: 'Workspace name is required' });
  const db = await getDb();
  const result = await db.collection('workspaces').updateOne(
    { _id: id },
    { $set: { name: name.trim(), color: color || '#3B82F6', updatedAt: new Date() } }
  );
  if (!result.matchedCount) return reply.code(404).send({ error: 'Workspace not found' });
  return { success: true };
});

app.delete('/workspaces/:id', async (request, reply) => {
  const { id } = request.params;
  if (id === 'default') return reply.code(400).send({ error: 'Cannot delete the default workspace' });
  const db = await getDb();
  const result = await db.collection('workspaces').deleteOne({ _id: id });
  if (!result.deletedCount) return reply.code(404).send({ error: 'Workspace not found' });
  // Cascade-delete all workspace-scoped data
  const deleteAll = (col, filter) => db.collection(col).deleteMany(filter);
  await Promise.all([
    db.collection('platform_credentials').deleteMany({ workspaceId: id }),
    deleteAll('competitors', { workspaceId: id }),
    deleteAll('hashtag_groups', { workspaceId: id }),
    deleteAll('hashtag_stats', { workspaceId: id }),
    deleteAll('account_profiles', { workspaceId: id }),
    deleteAll('content_calendars', { workspaceId: id }),
    deleteAll('bulk_draft_batches', { workspaceId: id }),
    deleteAll('drafts', { workspaceId: id }),
    deleteAll('posts', { workspaceId: id }),
    deleteAll('post_metrics', { workspaceId: id }),
    deleteAll('media_files', { workspaceId: id }),
  ]);
  log.info({ action: 'workspace_delete', workspaceId: id, outcome: 'success' });
  return { success: true };
});

// ─── Startup Migration ────────────────────────────────────────────────────────
// Stamps existing documents (created before workspaces) with workspaceId: 'default'
// and migrates platform_credentials _id keys to the 'default:type' format.

async function runWorkspaceMigration() {
  try {
    const db = await getDb();
    // Ensure the default workspace exists
    await db.collection('workspaces').updateOne(
      { _id: 'default' },
      { $setOnInsert: { _id: 'default', name: 'Default', color: '#3B82F6', createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );

    // Recovery: any global credential that was previously mis-migrated to
    // 'default:TYPE' must be moved back to the bare 'TYPE' key so that
    // getCredentials() can find it. This repairs data corrupted by the earlier
    // version of this migration that didn't skip global types.
    for (const type of GLOBAL_CREDENTIAL_TYPES) {
      const migratedId = credId('default', type);
      const migrated = await db.collection('platform_credentials').findOne({ _id: migratedId });
      if (migrated) {
        const bareExists = await db.collection('platform_credentials').findOne({ _id: type });
        if (!bareExists) {
          const { _id, workspaceId, ...rest } = migrated;
          await db.collection('platform_credentials').insertOne({ ...rest, _id: type });
          log.info({ action: 'workspace_migration', step: 'recover_global', type, outcome: 'success' });
        }
        await db.collection('platform_credentials').deleteOne({ _id: migratedId });
      }
    }

    // Migrate workspace-scoped platform_credentials: re-key docs whose _id
    // has no colon AND is not a global type (e.g. bare 'facebook' → 'default:facebook').
    // Global types (ai_config, meta_app, etc.) are intentionally never workspace-prefixed.
    const oldCreds = await db.collection('platform_credentials').find({
      _id: { $not: /\:/ },
      type: { $exists: false },  // only un-migrated docs (migrated ones already have 'type' field)
    }).toArray();
    let migrated = 0;
    for (const cred of oldCreds) {
      if (GLOBAL_CREDENTIAL_TYPES.has(cred._id)) continue;  // never re-key global types
      const newId = credId('default', cred._id);
      const exists = await db.collection('platform_credentials').findOne({ _id: newId });
      if (!exists) {
        await db.collection('platform_credentials').insertOne({ ...cred, _id: newId, workspaceId: 'default', type: cred._id });
        migrated++;
      }
      await db.collection('platform_credentials').deleteOne({ _id: cred._id });
    }

    // Stamp workspaceId on all other collections
    const cols = ['competitors','hashtag_groups','hashtag_stats','account_profiles','content_calendars','bulk_draft_batches','drafts','posts','post_metrics','media_files','feeds','scheduled_jobs'];
    for (const col of cols) {
      await db.collection(col).updateMany({ workspaceId: { $exists: false } }, { $set: { workspaceId: 'default' } });
    }
    if (migrated > 0) log.info({ action: 'workspace_migration', migrated, outcome: 'success' });
  } catch (err) {
    log.error({ action: 'workspace_migration', outcome: 'failure', err: err.message });
  }
}

getDb().then(() => runWorkspaceMigration());

// ─── Media Upload & Library ───────────────────────────────────────────────────

app.post('/upload', async (request, reply) => {
  const folder = request.query.folder || null;
  const data = await request.file();
  if (!data) return reply.code(400).send({ error: 'No file provided' });

  const ext = path.extname(data.filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    data.file.resume();
    return reply.code(400).send({ error: `File type "${ext}" is not allowed. Allowed: jpg, jpeg, png, gif, webp, mp4, mov, avi` });
  }

  const filename = `${crypto.randomUUID()}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  try {
    await pipeline(data.file, fs.createWriteStream(filepath));
  } catch (err) {
    app.log.error({ action: 'media_upload', outcome: 'failure', err: err.message });
    return reply.code(500).send({ error: 'Failed to save file' });
  }

  const stat = fs.statSync(filepath);
  const record = {
    filename,
    originalName: data.filename,
    url: process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/$/, '')}/media/${filename}` : `/media/${filename}`,
    mimetype: data.mimetype,
    size: stat.size,
    folder: folder || null,
    workspaceId: request.workspaceId,
    uploadedAt: new Date(),
  };

  try {
    const db = await getDb();
    await db.collection('media_files').insertOne(record);
  } catch (err) {
    app.log.error({ action: 'media_metadata_save', outcome: 'failure', err: err.message });
  }

  return { url: record.url, filename, originalName: data.filename, mimetype: data.mimetype, size: stat.size, folder: record.folder };
});

// List uploaded media files, newest first; optionally filter by folder
// folder=__none__ → unorganized (null/missing); folder=<name> → that folder; omit → all
app.get('/media-library', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const { folder } = request.query;
  const query = { workspaceId: ws };
  if (folder === '__none__') {
    query.$or = [{ folder: { $exists: false } }, { folder: null }, { folder: '' }];
  } else if (folder) {
    query.folder = folder;
  }
  const files = await db.collection('media_files').find(query).sort({ uploadedAt: -1 }).toArray();
  return { files };
});

// List custom folders with per-folder file counts
app.get('/media-folders', async () => {
  const db = await getDb();
  const [folders, counts] = await Promise.all([
    db.collection('media_folders').find({}).sort({ createdAt: 1 }).toArray(),
    db.collection('media_files').aggregate([
      { $group: { _id: { $ifNull: ['$folder', '__none__'] }, count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const total = counts.reduce((s, c) => s + c.count, 0);
  return {
    folders: folders.map((f) => ({ name: f.name, count: countMap[f.name] || 0 })),
    totalCount: total,
    unorganizedCount: countMap['__none__'] || 0,
    folderCounts: countMap,
  };
});

// Create a custom folder
app.post('/media-folders', async (request, reply) => {
  const { name } = request.body || {};
  if (!name?.trim()) return reply.code(400).send({ error: 'Folder name is required' });
  const trimmed = name.trim();
  const db = await getDb();
  if (await db.collection('media_folders').findOne({ name: trimmed })) {
    return reply.code(409).send({ error: 'Folder already exists' });
  }
  await db.collection('media_folders').insertOne({ name: trimmed, createdAt: new Date() });
  return { name: trimmed };
});

// Delete a custom folder; files in it become unorganized
app.delete('/media-folders/:name', async (request, reply) => {
  const name = decodeURIComponent(request.params.name);
  const db = await getDb();
  await db.collection('media_folders').deleteOne({ name });
  await db.collection('media_files').updateMany({ folder: name }, { $set: { folder: null } });
  return { success: true };
});

// Update a file's folder assignment
app.patch('/media/:filename', async (request, reply) => {
  const ws = request.workspaceId;
  const { filename } = request.params;
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    return reply.code(400).send({ error: 'Invalid filename' });
  }
  const { folder } = request.body || {};
  const db = await getDb();
  const result = await db.collection('media_files').updateOne(
    { filename, workspaceId: ws },
    { $set: { folder: folder || null } },
  );
  if (!result.matchedCount) return reply.code(404).send({ error: 'File not found' });
  return { success: true };
});

// Delete a media file from disk and database
app.delete('/media/:filename', async (request, reply) => {
  const ws = request.workspaceId;
  const { filename } = request.params;

  // Prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    return reply.code(400).send({ error: 'Invalid filename' });
  }

  const filepath = path.join(UPLOAD_DIR, filename);
  try {
    fs.unlinkSync(filepath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      app.log.error({ action: 'media_delete', outcome: 'failure', err: err.message });
      return reply.code(500).send({ error: 'Failed to delete file' });
    }
    // Already gone from disk — still clean up DB record
  }

  const db = await getDb();
  await db.collection('media_files').deleteOne({ filename, workspaceId: ws });

  return { success: true };
});

// ─── Drafts ──────────────────────────────────────────────────────────────────

app.post('/drafts', async (request, reply) => {
  const ws = request.workspaceId;
  const { content = '', mediaUrl = '', scheduledAt = '', destinations = [] } = request.body || {};
  const db = await getDb();
  const now = new Date();
  const result = await db.collection('drafts').insertOne({
    content, mediaUrl, scheduledAt, destinations, workspaceId: ws, createdAt: now, updatedAt: now,
  });
  const draft = await db.collection('drafts').findOne({ _id: result.insertedId });
  return reply.code(201).send(draft);
});

app.get('/drafts', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const drafts = await db.collection('drafts').find({ workspaceId: ws }).sort({ updatedAt: -1 }).toArray();
  return { drafts };
});

app.get('/drafts/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const db = await getDb();
  const draft = await db.collection('drafts').findOne({ _id: oid, workspaceId: ws });
  if (!draft) return reply.code(404).send({ error: 'Draft not found' });
  return draft;
});

app.put('/drafts/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const { content = '', mediaUrl = '', scheduledAt = '', destinations = [] } = request.body || {};
  const db = await getDb();
  const result = await db.collection('drafts').updateOne(
    { _id: oid, workspaceId: ws },
    { $set: { content, mediaUrl, scheduledAt, destinations, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return reply.code(404).send({ error: 'Draft not found' });
  return { success: true };
});

app.delete('/drafts/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const db = await getDb();
  await db.collection('drafts').deleteOne({ _id: oid, workspaceId: ws });
  return { success: true };
});

// ─── Meta Token Expiry & Auto-Refresh ────────────────────────────────────────

let _tokenExpiryCache = null;
let _tokenExpiryCacheAt = 0;
const TOKEN_EXPIRY_TTL = 60 * 60 * 1000; // 1 hour
const TOKEN_REFRESH_THRESHOLD_DAYS = 7;  // refresh when ≤ this many days remain

app.get('/meta/token-expiry', async (request, reply) => {
  if (_tokenExpiryCache && Date.now() - _tokenExpiryCacheAt < TOKEN_EXPIRY_TTL) {
    return _tokenExpiryCache;
  }
  const ws = request.workspaceId;
  const appCred = await getCredentials(ws, 'meta_app');
  if (!appCred?.appId || !appCred?.appSecret) return { accounts: [] };
  const plainAppSecret = decryptToken(appCred.appSecret);
  if (!plainAppSecret) return { accounts: [] };

  const ig = await getCredentials(ws, 'instagram');
  const selectedAccounts = (ig?.accounts || []).filter((a) => a.selected && a.accessToken);
  if (!selectedAccounts.length) return { accounts: [] };

  const appToken = `${appCred.appId}|${plainAppSecret}`;
  const accounts = [];

  for (const account of selectedAccounts) {
    const plainToken = decryptToken(account.accessToken);
    if (!plainToken) continue;
    try {
      const res = await axios.get(`${GRAPH_API}/debug_token`, {
        params: { input_token: plainToken, access_token: appToken },
        timeout: 10000,
      });
      const data = res.data.data;
      const expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null;
      const daysLeft = expiresAt
        ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      accounts.push({ id: account.id, username: account.username, expiresAt, daysLeft, isValid: !!data.is_valid });
    } catch (err) {
      app.log.warn({ action: 'token_expiry_check', platform: 'instagram', username: account.username, outcome: 'failure', err: err.message });
    }
  }

  _tokenExpiryCache = { accounts, checkedAt: new Date().toISOString() };
  _tokenExpiryCacheAt = Date.now();
  return _tokenExpiryCache;
});

// Refresh Instagram long-lived tokens that are within TOKEN_REFRESH_THRESHOLD_DAYS of expiry.
// Called by the scheduler's daily BullMQ job; can also be triggered manually from Settings.
app.post('/meta/token-refresh', async (request, reply) => {
  const ws = request.workspaceId;
  const appCred = await getCredentials(ws, 'meta_app');
  if (!appCred?.appId || !appCred?.appSecret) {
    return reply.code(400).send({ success: false, error: 'Meta app credentials not configured' });
  }
  const plainAppSecret = decryptToken(appCred.appSecret);
  if (!plainAppSecret) {
    return reply.code(500).send({ success: false, error: 'Failed to decrypt app secret' });
  }

  const ig = await getCredentials(ws, 'instagram');
  const allAccounts = ig?.accounts || [];
  const selectedAccounts = allAccounts.filter((a) => a.selected && a.accessToken);
  if (!selectedAccounts.length) {
    return { success: true, refreshed: 0, skipped: 0, errors: 0 };
  }

  const appToken = `${appCred.appId}|${plainAppSecret}`;
  const refreshed = [];
  const skipped = [];
  const errors = [];

  for (const account of selectedAccounts) {
    const plainToken = decryptToken(account.accessToken);
    if (!plainToken) {
      errors.push({ username: account.username, error: 'decrypt_failed' });
      continue;
    }

    // Check current token expiry via debug_token
    let daysLeft = null;
    try {
      const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
        params: { input_token: plainToken, access_token: appToken },
        timeout: 10000,
      });
      const data = debugRes.data.data;
      if (!data.is_valid) {
        app.log.warn({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'skip', reason: 'invalid_token' });
        errors.push({ username: account.username, error: 'token_invalid' });
        continue;
      }
      // expires_at is a Unix timestamp; null means never-expiring (page token etc.)
      daysLeft = data.expires_at
        ? Math.ceil((data.expires_at * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
    } catch (err) {
      app.log.warn({ action: 'token_refresh', platform: 'instagram', username: account.username, step: 'debug_token', outcome: 'failure', err: err.message });
      errors.push({ username: account.username, error: err.message });
      continue;
    }

    // Token never expires or has plenty of time — skip
    if (daysLeft !== null && daysLeft > TOKEN_REFRESH_THRESHOLD_DAYS) {
      skipped.push({ username: account.username, daysLeft });
      continue;
    }

    // Refresh: exchange current long-lived token for a new one
    try {
      const refreshRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appCred.appId,
          client_secret: plainAppSecret,
          fb_exchange_token: plainToken,
        },
        timeout: 15000,
      });
      // Mutates the element inside allAccounts (same object reference)
      account.accessToken = encryptToken(refreshRes.data.access_token);
      refreshed.push({ username: account.username, previousDaysLeft: daysLeft });
      app.log.info({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'success', previousDaysLeft: daysLeft });
    } catch (err) {
      app.log.error({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'failure', err: err.message });
      errors.push({ username: account.username, error: err.message });
    }
  }

  if (refreshed.length > 0) {
    await setCredentials(ws, 'instagram', { accounts: allAccounts });
    _tokenExpiryCache = null; // force fresh expiry check on next poll
  }

  app.log.info({ action: 'token_refresh', platform: 'meta', outcome: 'complete', refreshed: refreshed.length, skipped: skipped.length, errors: errors.length });
  return { success: true, refreshed: refreshed.length, skipped: skipped.length, errors: errors.length };
});

// ─── Account Profiles ────────────────────────────────────────────────────────

app.get('/profiles', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const profiles = await db.collection('account_profiles').find({ workspaceId: ws }).toArray();
  return { profiles };
});

app.get('/profiles/:accountKey', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.params;
  const db = await getDb();
  const profileId = accountKey === 'workspace' ? `${ws}:workspace` : accountKey;
  const profile = await db.collection('account_profiles').findOne({ _id: profileId })
    // Backward compat: old documents stored without workspace prefix
    || await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws })
    // Workspace profile fallback: use business context from workspace profile when no platform-specific one exists
    || (accountKey !== 'workspace' ? await db.collection('account_profiles').findOne({ _id: `${ws}:workspace` }) : null);
  return profile ?? { _id: accountKey };
});

app.put('/profiles/:accountKey', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.params;
  const {
    businessName = '', description = '', websiteUrl = '', industry = '',
    targetAudience = '', toneOfVoice = '', keywords = '', hashtags = '',
    postingGuidelines = '', timezone = '',
  } = request.body || {};
  const db = await getDb();
  // Use a workspace-scoped document ID for the 'workspace' key so that
  // multiple workspaces don't overwrite each other's profile.
  const profileId = accountKey === 'workspace' ? `${ws}:workspace` : accountKey;
  await db.collection('account_profiles').updateOne(
    { _id: profileId },
    { $set: { businessName, description, websiteUrl, industry, targetAudience, toneOfVoice, keywords, hashtags, postingGuidelines, timezone, workspaceId: ws, updatedAt: new Date() } },
    { upsert: true }
  );
  return { success: true };
});

// Strategy consistency audit — check if a profile's fields are internally coherent
app.post('/profiles/:accountKey/audit', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.params;
  const db = await getDb();
  const profileId = accountKey === 'workspace' ? `${ws}:workspace` : accountKey;
  const profile = await db.collection('account_profiles').findOne({ _id: profileId })
    || await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
  if (!profile) return reply.code(404).send({ error: 'Profile not found — save your workspace profile first.' });

  const filled = [
    profile.businessName, profile.description, profile.industry,
    profile.toneOfVoice, profile.targetAudience, profile.keywords,
    profile.hashtags, profile.postingGuidelines,
  ].filter(Boolean);
  if (filled.length < 3) {
    return reply.code(400).send({ error: 'Fill in at least 3 profile fields before running an audit' });
  }

  const profileBlock = [
    profile.businessName   && `Business: ${profile.businessName}`,
    profile.description    && `Description: ${profile.description}`,
    profile.industry       && `Industry: ${profile.industry}`,
    profile.toneOfVoice    && `Tone of voice: ${profile.toneOfVoice}`,
    profile.targetAudience && `Target audience: ${profile.targetAudience}`,
    profile.keywords       && `Keywords: ${profile.keywords}`,
    profile.hashtags       && `Preferred hashtags: ${profile.hashtags}`,
    profile.postingGuidelines && `Posting guidelines: ${profile.postingGuidelines}`,
  ].filter(Boolean).join('\n');

  const system = 'You are a brand strategy consultant. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Audit the internal consistency of this social media account profile and identify any conflicts or misalignments.

PROFILE:
${profileBlock}

Check for these issues:
1. Audience-tone mismatch (e.g. B2B business using casual/Gen-Z tone)
2. Industry-keyword misalignment (keywords don't reflect stated industry)
3. Hashtag-audience misalignment (hashtags target a different audience than described)
4. Tone-guideline conflicts (tone of voice contradicts posting guidelines)
5. Missing critical context (fields that are vague and would hurt AI content quality)

Return a JSON object:
{
  "score": <consistency score 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "issues": [
    { "severity": "<high|medium|low>", "field": "<which field(s)>", "issue": "<what the conflict is>", "fix": "<specific recommendation>" }
  ],
  "strengths": ["<1-3 things the profile does well>"]
}

Return [] for issues if no problems found. Return ONLY the JSON object.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let result = null;
    try {
      const jsonStr = (text.match(/\{[\s\S]*\}/) || ['{}'])[0];
      result = JSON.parse(jsonStr);
      if (typeof result.score !== 'number') throw new Error();
      if (!Array.isArray(result.issues)) result.issues = [];
      if (!Array.isArray(result.strengths)) result.strengths = [];
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid audit format — try again' });
    }

    log.info({ action: 'profile_audit', accountKey, score: result.score, issues: result.issues.length, outcome: 'success' });
    return { success: true, ...result };
  } catch (err) {
    const aiBody = err.response?.data;
    const detail = aiBody ? (aiBody.error || aiBody.message || JSON.stringify(aiBody)) : err.message;
    return reply.code(503).send({ error: 'Profile audit failed', detail });
  }
});

// ─── AI / Multi-provider ─────────────────────────────────────────────────────

const DEFAULT_OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const PROVIDER_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  groq:   ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq:   'https://api.groq.com/openai/v1',
};

// Returns decrypted runtime config for the currently active provider
async function getActiveProviderConfig(ws = 'default') {
  const aiConfig = await getCredentials(ws, 'ai_config');
  const provider = aiConfig?.provider || 'ollama';
  if (provider === 'openai' || provider === 'groq') {
    const doc = await getCredentials(ws, `${provider}_config`);
    return {
      provider,
      apiKey: doc?.apiKey ? decryptToken(doc.apiKey) : null,
      model: doc?.model || PROVIDER_MODELS[provider][0],
      baseUrl: PROVIDER_BASE_URLS[provider],
    };
  }
  if (provider === 'gemini') {
    const doc = await getCredentials(ws, 'gemini_config');
    return {
      provider,
      apiKey: doc?.apiKey ? decryptToken(doc.apiKey) : null,
      model: doc?.model || PROVIDER_MODELS.gemini[0],
    };
  }
  return {
    provider: 'ollama',
    endpoint: aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT,
    model: aiConfig?.model || DEFAULT_OLLAMA_MODEL,
    visionModel: aiConfig?.visionModel || 'llava',
  };
}

function buildOpenAIMessages(prompt, system) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return messages;
}

// Gemini encodes system as a leading user/model conversation pair
function buildGeminiContents(prompt, system) {
  const contents = [];
  if (system) {
    contents.push({ role: 'user',  parts: [{ text: system }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  return contents;
}

app.get('/ai/config', async (request) => {
  const ws = request.workspaceId;
  const config = await getCredentials(ws, 'ai_config');
  return {
    provider:    config?.provider    || 'ollama',
    endpoint:    config?.endpoint    || DEFAULT_OLLAMA_ENDPOINT,
    model:       config?.model       || DEFAULT_OLLAMA_MODEL,
    visionModel: config?.visionModel || 'llava',
    enabled:     config?.enabled     ?? true,
  };
});

app.put('/ai/config', async (request, reply) => {
  const ws = request.workspaceId;
  const { provider = 'ollama', endpoint, model, visionModel = 'llava', enabled = true } = request.body || {};
  if (provider === 'ollama' && !endpoint) return reply.code(400).send({ error: 'endpoint is required for Ollama' });
  await setCredentials(ws, 'ai_config', { provider, endpoint, model, visionModel, enabled });
  return { success: true };
});

// ─── Provider management routes ───────────────────────────────────────────────

app.get('/ai/providers', async (request) => {
  const ws = request.workspaceId;
  const aiConfig = await getCredentials(ws, 'ai_config');
  const active = aiConfig?.provider || 'ollama';
  const [openaiDoc, groqDoc, geminiDoc] = await Promise.all([
    getCredentials(ws, 'openai_config'),
    getCredentials(ws, 'groq_config'),
    getCredentials(ws, 'gemini_config'),
  ]);
  return {
    active,
    providers: [
      {
        name: 'ollama',
        configured: true,
        active: active === 'ollama',
        endpoint: aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT,
        model: aiConfig?.model || DEFAULT_OLLAMA_MODEL,
        visionModel: aiConfig?.visionModel || 'llava',
      },
      {
        name: 'openai',
        configured: !!openaiDoc?.apiKey,
        active: active === 'openai',
        model: openaiDoc?.model || PROVIDER_MODELS.openai[0],
        apiKeyHint: openaiDoc?.apiKey ? `sk-...${decryptToken(openaiDoc.apiKey).slice(-4)}` : null,
      },
      {
        name: 'groq',
        configured: !!groqDoc?.apiKey,
        active: active === 'groq',
        model: groqDoc?.model || PROVIDER_MODELS.groq[0],
        apiKeyHint: groqDoc?.apiKey ? `gsk_...${decryptToken(groqDoc.apiKey).slice(-4)}` : null,
      },
      {
        name: 'gemini',
        configured: !!geminiDoc?.apiKey,
        active: active === 'gemini',
        model: geminiDoc?.model || PROVIDER_MODELS.gemini[0],
        apiKeyHint: geminiDoc?.apiKey ? `AIza...${decryptToken(geminiDoc.apiKey).slice(-4)}` : null,
      },
    ],
  };
});

// PUT /ai/provider/:name — save credentials and optionally set as active
// ollama body: { endpoint, model, visionModel, setActive? }
// others body: { apiKey, model, setActive? }
app.put('/ai/provider/:name', async (request, reply) => {
  const ws = request.workspaceId;
  const { name } = request.params;
  const { apiKey, model, endpoint, visionModel, setActive = false } = request.body || {};

  if (name === 'ollama') {
    if (!endpoint) return reply.code(400).send({ error: 'endpoint is required for Ollama' });
    const existing = await getCredentials(ws, 'ai_config') || {};
    await setCredentials(ws, 'ai_config', {
      ...existing,
      provider: setActive ? 'ollama' : (existing.provider || 'ollama'),
      endpoint,
      model: model || DEFAULT_OLLAMA_MODEL,
      visionModel: visionModel || 'llava',
    });
  } else if (['openai', 'groq', 'gemini'].includes(name)) {
    if (!apiKey) return reply.code(400).send({ error: 'apiKey is required' });
    await setCredentials(ws, `${name}_config`, {
      apiKey: encryptToken(apiKey),
      model: model || PROVIDER_MODELS[name][0],
    });
    if (setActive) {
      const existing = await getCredentials(ws, 'ai_config') || {};
      await setCredentials(ws, 'ai_config', { ...existing, provider: name });
    }
  } else {
    return reply.code(404).send({ error: `Unknown provider: ${name}` });
  }

  return { success: true };
});

// DELETE /ai/provider/:name — remove provider credentials; falls back to ollama if it was active
app.delete('/ai/provider/:name', async (request, reply) => {
  const ws = request.workspaceId;
  const { name } = request.params;
  if (name === 'ollama') return reply.code(400).send({ error: 'Cannot remove Ollama provider' });
  if (!['openai', 'groq', 'gemini'].includes(name)) return reply.code(404).send({ error: `Unknown provider: ${name}` });
  await deleteCredentials(ws, `${name}_config`);
  const aiConfig = await getCredentials(ws, 'ai_config') || {};
  if (aiConfig.provider === name) {
    await setCredentials(ws, 'ai_config', { ...aiConfig, provider: 'ollama' });
  }
  return { success: true };
});

// POST /ai/provider/:name/models — list models for a provider (test without saving key)
app.post('/ai/provider/:name/models', async (request, reply) => {
  const ws = request.workspaceId;
  const { name } = request.params;
  const { apiKey: bodyApiKey, endpoint: bodyEndpoint } = request.body || {};

  if (name === 'ollama') {
    const aiConfig = await getCredentials(ws, 'ai_config');
    const ep = bodyEndpoint || aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT;
    try {
      const res = await axios.get(`${ep}/api/tags`, { timeout: 5000 });
      return { models: (res.data.models || []).map((m) => m.name) };
    } catch (err) {
      return reply.code(503).send({ error: 'Could not reach Ollama', detail: err.message });
    }
  }
  if (['openai', 'groq', 'gemini'].includes(name)) {
    return { models: PROVIDER_MODELS[name] };
  }
  return reply.code(404).send({ error: `Unknown provider: ${name}` });
});

app.get('/ai/models', async (request, reply) => {
  const ws = request.workspaceId;
  const config = await getCredentials(ws, 'ai_config');
  const provider = config?.provider || 'ollama';
  if (provider !== 'ollama') {
    return { models: PROVIDER_MODELS[provider] || [], provider };
  }
  const endpoint = request.query.endpoint || config?.endpoint || DEFAULT_OLLAMA_ENDPOINT;
  try {
    const res = await axios.get(`${endpoint}/api/tags`, { timeout: 5000 });
    const models = (res.data.models || []).map((m) => m.name);
    return { models, endpoint };
  } catch (err) {
    return reply.code(503).send({ error: 'Could not reach Ollama — check the endpoint', detail: err.message });
  }
});

// ─── Community Research ───────────────────────────────────────────────────────

async function fetchRedditSnippets(query, limit = 5) {
  try {
    const res = await axios.get(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=hot&limit=${limit}&t=month`,
      { headers: { 'User-Agent': 'SocialManager/1.0 (research bot)' }, timeout: 8000 },
    );
    return (res.data?.data?.children || [])
      .map((p) => p.data)
      .filter((d) => d.title)
      .map((d) => `"${d.title}": ${(d.selftext || d.url || '').slice(0, 180)}`);
  } catch { return []; }
}

// POST /ai/research — scrape Reddit for industry/keyword discussions, AI-summarise into brief
// Stores researchBrief + researchBriefAt on account_profiles
app.post('/ai/research', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey, topics } = request.body || {};
  const db = await getDb();
  const profileKey = accountKey || null;
  const profile = profileKey
    ? (await db.collection('account_profiles').findOne({ _id: profileKey, workspaceId: ws }))
    || (await db.collection('account_profiles').findOne({ workspaceId: ws }))
    : await db.collection('account_profiles').findOne({ workspaceId: ws });

  const industry = profile?.industry || '';
  const keywords = profile?.keywords || '';
  const businessName = profile?.businessName || '';
  const extraTopics = Array.isArray(topics) ? topics.slice(0, 3) : [];

  // Build 3 search queries from profile context
  const queries = [
    industry ? `${industry} challenges pain points` : null,
    keywords ? `${keywords} community discussion` : null,
    businessName ? `${businessName} competitors alternatives` : null,
    ...extraTopics.map((t) => String(t)),
  ].filter(Boolean).slice(0, 4);

  if (!queries.length) return reply.code(400).send({ error: 'No research context — fill in Industry or Keywords in your Account Profile first' });

  const snippets = [];
  await Promise.all(queries.map(async (q) => {
    const results = await fetchRedditSnippets(q, 5);
    snippets.push(...results);
  }));

  if (!snippets.length) {
    return reply.code(503).send({ error: 'Could not fetch community data — Reddit may be temporarily unavailable' });
  }

  const system = 'You are an audience research analyst. Return ONLY valid JSON — no markdown, no explanation.';
  const prompt = `Based on these community discussions about "${industry || keywords || businessName}":

${snippets.slice(0, 20).map((s, i) => `${i + 1}. ${s}`).join('\n')}

Extract a research brief with these exact fields:
{
  "painPoints": ["<3-5 real audience frustrations or challenges found in the discussions>"],
  "trendingTopics": ["<3-5 topics the community is actively discussing right now>"],
  "communityLanguage": ["<5-8 exact phrases, words, or terms the audience uses — quote them>"],
  "contentAngles": ["<3-5 specific post angles that would resonate based on what you found>"]
}

Return ONLY the JSON object.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 60000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 60000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) }, { timeout: 60000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let brief = null;
    try {
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      brief = JSON.parse(jsonStr);
      if (!brief.painPoints) throw new Error('Missing painPoints');
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid research format — try again' });
    }

    const updatedAt = new Date();
    if (profileKey) {
      await db.collection('account_profiles').updateOne(
        { _id: profileKey, workspaceId: ws },
        { $set: { researchBrief: brief, researchBriefAt: updatedAt } },
        { upsert: false },
      );
    }

    log.info({ action: 'ai_research', accountKey: profileKey || 'any', snippets: snippets.length, outcome: 'success' });
    return { brief, accountKey: profileKey, updatedAt };
  } catch (err) {
    log.error({ action: 'ai_research', outcome: 'failure', err: err.message });
    return reply.code(503).send({ error: `Research failed: ${err.message}` });
  }
});

// Helper: inject research brief into a system prompt when available
async function buildResearchBriefSuffix(accountKey, ws = 'default') {
  if (!accountKey) return '';
  try {
    const db = await getDb();
    const profile = await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
    const b = profile?.researchBrief;
    if (!b) return '';
    const parts = [];
    if (b.painPoints?.length)       parts.push(`Audience pain points: ${b.painPoints.join('; ')}`);
    if (b.trendingTopics?.length)   parts.push(`Trending topics right now: ${b.trendingTopics.join('; ')}`);
    if (b.communityLanguage?.length) parts.push(`Language the audience uses: ${b.communityLanguage.join(', ')}`);
    if (b.contentAngles?.length)    parts.push(`Proven content angles: ${b.contentAngles.join('; ')}`);
    if (!parts.length) return '';
    return '\n\nAUDIENCE RESEARCH CONTEXT (use this to make the post feel native to the community):\n' + parts.join('\n');
  } catch { return ''; }
}

app.post('/ai/generate', async (request, reply) => {
  const ws = request.workspaceId;
  const { prompt, system: rawSystem, model: reqModel, useCompetitorContext, useResearchBrief, accountKey, destinations } = request.body || {};
  if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' });

  const competitorSuffix = useCompetitorContext ? await buildCompetitorSystemSuffix(ws) : '';
  const researchSuffix = useResearchBrief ? await buildResearchBriefSuffix(accountKey, ws) : '';
  const platformRules = buildPlatformRulesBlock(destinations);
  const system = rawSystem ? rawSystem + competitorSuffix + researchSuffix + platformRules : ((competitorSuffix + researchSuffix + platformRules) || undefined);

  const pconf = await getActiveProviderConfig(request.workspaceId);
  const model = reqModel || pconf.model;

  try {
    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      return { text: res.data.response, model, done: res.data.done };
    }

    if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      return { text: res.data.choices[0]?.message?.content || '', model, done: true };
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      return { text: res.data.candidates?.[0]?.content?.parts?.[0]?.text || '', model, done: true };
    }

    return reply.code(400).send({ error: `Unknown provider: ${pconf.provider}` });
  } catch (err) {
    const status = err.response?.status || 503;
    return reply.code(status).send({ error: 'AI generation failed', detail: err.message });
  }
});

const CAPTION_PROMPT = 'Generate an engaging, concise social media caption for this image. Write only the caption text with relevant hashtags. No explanations or preamble.';

// Vision caption — supports ollama, openai, gemini (groq has no vision)
app.post('/ai/caption', async (request, reply) => {
  const { imageUrl, model: reqModel } = request.body || {};
  if (!imageUrl) return reply.code(400).send({ error: 'imageUrl is required' });

  const pconf = await getActiveProviderConfig(request.workspaceId);

  let imageBase64, imageMime;
  try {
    let imageBuffer;
    if (imageUrl.startsWith('/media/')) {
      const filename = path.basename(imageUrl);
      imageBuffer = fs.readFileSync(path.join(UPLOAD_DIR, filename));
    } else {
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
      imageBuffer = Buffer.from(imgRes.data);
      imageMime = imgRes.headers['content-type'] || 'image/jpeg';
    }
    imageBase64 = imageBuffer.toString('base64');
    if (!imageMime) imageMime = 'image/jpeg';
  } catch (err) {
    return reply.code(400).send({ error: 'Could not load image', detail: err.message });
  }

  try {
    const model = reqModel || pconf.visionModel || pconf.model;

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, {
        model, prompt: CAPTION_PROMPT, images: [imageBase64], stream: false,
      }, { timeout: 90000 });
      return { caption: res.data.response, model };
    }

    if (pconf.provider === 'openai') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'OpenAI API key not configured' });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: CAPTION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        ]}],
        stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      return { caption: res.data.choices[0]?.message?.content || '', model };
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const geminiModel = model || 'gemini-1.5-flash';
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${pconf.apiKey}`,
        { contents: [{ role: 'user', parts: [
          { text: CAPTION_PROMPT },
          { inlineData: { mimeType: imageMime, data: imageBase64 } },
        ]}]},
        { timeout: 90000 },
      );
      return { caption: res.data.candidates?.[0]?.content?.parts?.[0]?.text || '', model: geminiModel };
    }

    return reply.code(400).send({ error: `Provider ${pconf.provider} does not support vision captions` });
  } catch (err) {
    const status = err.response?.status || 503;
    return reply.code(status).send({ error: 'Caption generation failed', detail: err.message });
  }
});

// SSE streaming endpoint — normalized data: { token, done } format for all providers
app.post('/ai/stream', async (request, reply) => {
  const ws = request.workspaceId;
  const { prompt, system: rawSystem, model: reqModel, useCompetitorContext, useResearchBrief, accountKey, destinations } = request.body || {};
  if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' });

  const competitorSuffix = useCompetitorContext ? await buildCompetitorSystemSuffix(ws) : '';
  const researchSuffix = useResearchBrief ? await buildResearchBriefSuffix(accountKey, ws) : '';
  const platformRules = buildPlatformRulesBlock(destinations);
  const system = rawSystem ? rawSystem + competitorSuffix + researchSuffix + platformRules : ((competitorSuffix + researchSuffix + platformRules) || undefined);

  const pconf = await getActiveProviderConfig(request.workspaceId);
  const model = reqModel || pconf.model;

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const writeToken = (token, done = false) => reply.raw.write(`data: ${JSON.stringify({ token, done })}\n\n`);
  const writeError = (msg) => { reply.raw.write(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`); reply.raw.end(); };

  try {
    if (pconf.provider === 'ollama') {
      const ollamaRes = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: true }, { responseType: 'stream', timeout: 120000 });
      ollamaRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            const data = JSON.parse(line);
            writeToken(data.response || '', !!data.done);
          }
        } catch (_) {}
      });
      ollamaRes.data.on('end', () => reply.raw.end());
      ollamaRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return writeError(`${pconf.provider} API key not configured`);
      const upstreamRes = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: true,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, responseType: 'stream', timeout: 120000 });
      upstreamRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { writeToken('', true); return; }
            const data = JSON.parse(payload);
            const token = data.choices?.[0]?.delta?.content || '';
            if (token) writeToken(token);
          }
        } catch (_) {}
      });
      upstreamRes.data.on('end', () => reply.raw.end());
      upstreamRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return writeError('Gemini API key not configured');
      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { responseType: 'stream', timeout: 120000 },
      );
      geminiRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            const token = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (token) writeToken(token);
          }
        } catch (_) {}
      });
      geminiRes.data.on('end', () => { writeToken('', true); reply.raw.end(); });
      geminiRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    writeError(`Unknown provider: ${pconf.provider}`);
  } catch (err) {
    writeError(err.message);
  }
});

// ─── Monthly Content Calendar ─────────────────────────────────────────────────

// POST /ai/content-brief — generate a narrative brief only (step 1 of 2-step calendar flow)
// Body: { accountKey?, platforms[], month? (YYYY-MM) }
app.post('/ai/content-brief', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey, platforms = [], month } = request.body || {};
  if (!platforms.length) return reply.code(400).send({ error: 'Select at least one platform' });

  const db = await getDb();
  const calMonth = month || new Date().toISOString().slice(0, 7);
  const monthName = new Date(`${calMonth}-01`).toLocaleString('en', { month: 'long', year: 'numeric' });

  const profileKey = accountKey || null;
  const profile = profileKey
    ? (await db.collection('account_profiles').findOne({ _id: profileKey, workspaceId: ws }))
    || (await db.collection('account_profiles').findOne({ workspaceId: ws }))
    : await db.collection('account_profiles').findOne({ workspaceId: ws });

  const contextParts = [];
  if (profile) {
    if (profile.businessName)   contextParts.push(`Business: ${profile.businessName}`);
    if (profile.description)    contextParts.push(`Description: ${profile.description}`);
    if (profile.industry)       contextParts.push(`Industry: ${profile.industry}`);
    if (profile.toneOfVoice)    contextParts.push(`Tone: ${profile.toneOfVoice}`);
    if (profile.targetAudience) contextParts.push(`Audience: ${profile.targetAudience}`);
    if (profile.keywords)       contextParts.push(`Keywords: ${profile.keywords}`);
  }

  const platformList = platforms.slice(0, 5).join(', ');
  const platformNoteKeys = platforms.slice(0, 5).map((p) => `"${p}": "<one-sentence strategy>"`).join(', ');

  const system = 'You are a social media content strategist. Return ONLY a valid JSON object with no markdown or explanation.';
  const prompt = `${contextParts.length ? contextParts.join('\n') + '\n\n' : ''}Create a brief for the ${monthName} content calendar. Platforms: ${platformList}.

Return this exact JSON:
{
  "theme": "<one compelling sentence that defines the month's narrative — the red thread across all content>",
  "pillars": ["<content pillar 1>", "<content pillar 2>", "<content pillar 3>"],
  "toneGuidance": "<one sentence describing the voice and energy for this month>",
  "platformNotes": { ${platformNoteKeys} }
}

Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let brief = null;
    try {
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      brief = JSON.parse(jsonStr);
      if (typeof brief.theme !== 'string' || !brief.theme) throw new Error('Missing theme');
      if (!Array.isArray(brief.pillars)) brief.pillars = [];
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid brief format — try again' });
    }

    log.info({ action: 'content_brief', month: calMonth, platforms: platforms.join(','), outcome: 'success' });
    return { success: true, brief, monthName, month: calMonth };
  } catch (err) {
    log.error({ action: 'content_brief', outcome: 'failure', err: err.message });
    return reply.code(503).send({ error: `Brief generation failed: ${err.message}` });
  }
});

// POST /ai/content-calendar — generate a monthly content plan with narrative brief + sample posts
// Body: { accountKey?, platforms[], month? (YYYY-MM), approvedBrief?, postsPerWeek? }
app.post('/ai/content-calendar', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey, platforms = [], month, approvedBrief, postsPerWeek: rawPpw } = request.body || {};
  if (!platforms.length) return reply.code(400).send({ error: 'Select at least one platform' });

  const db = await getDb();
  const calMonth = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = calMonth.split('-');
  const monthName = new Date(`${calMonth}-01`).toLocaleString('en', { month: 'long', year: 'numeric' });

  // Validate postsPerWeek: 1–7, default 3
  const postsPerWeek = Math.min(7, Math.max(1, parseInt(rawPpw) || 3));

  // Load account profile for context
  const profileKey = accountKey || null;
  const profile = profileKey
    ? (await db.collection('account_profiles').findOne({ _id: profileKey, workspaceId: ws }))
    || (await db.collection('account_profiles').findOne({ workspaceId: ws }))
    : await db.collection('account_profiles').findOne({ workspaceId: ws });

  const contextParts = ['You are a social media content strategist.'];
  if (profile) {
    if (profile.businessName)   contextParts.push(`Business: ${profile.businessName}`);
    if (profile.description)    contextParts.push(`Description: ${profile.description}`);
    if (profile.industry)       contextParts.push(`Industry: ${profile.industry}`);
    if (profile.toneOfVoice)    contextParts.push(`Tone of voice: ${profile.toneOfVoice}`);
    if (profile.targetAudience) contextParts.push(`Target audience: ${profile.targetAudience}`);
    if (profile.keywords)       contextParts.push(`Keywords: ${profile.keywords}`);
  }
  const brandContext = contextParts.join('\n');

  const activePlatforms = platforms.slice(0, 5);
  const platformList = activePlatforms.join(', ');
  // Cap total posts to 60 to keep response size manageable
  const postsPerPlatform = postsPerWeek * 4;
  const totalPosts = Math.min(activePlatforms.length * postsPerPlatform, 60);
  const cappedPerPlatform = Math.ceil(totalPosts / activePlatforms.length);

  const system = 'You are a social media content strategist. Return ONLY a valid JSON object — no markdown, no explanation, no code fences.';

  const platformNoteKeys = activePlatforms.map((p) => `"${p}"`).join(', ');
  const postSchema = `{ "platform": "<one of: ${platformList}>", "week": <1-4>, "suggestedDay": "<Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday>", "suggestedTime": "<HH:MM in 24h>", "content": "<ready-to-publish post>", "hashtags": ["<tag>"], "postType": "<educational|promotional|engagement|storytelling>" }`;

  // If an approved brief was passed, use it directly — only generate posts
  const briefSection = approvedBrief
    ? `The content brief has already been approved — do NOT change it. Use this brief exactly:
Theme: "${approvedBrief.theme}"
Pillars: ${(approvedBrief.pillars || []).join(', ')}
Tone: ${approvedBrief.toneGuidance || ''}

Generate posts that faithfully follow this approved brief.`
    : '';

  const prompt = `${brandContext}

${briefSection}
Create a ${monthName} content calendar for: ${platformList}.
Generate exactly ${postsPerWeek} posts per platform per week, covering all 4 weeks (${cappedPerPlatform} posts per platform, ${totalPosts} posts total).
Distribute evenly: week 1 = days 1–7, week 2 = days 8–14, week 3 = days 15–21, week 4 = days 22–28.

For "suggestedTime" use these platform-native peak times (24-hour HH:MM):
- LinkedIn: 08:00, 09:00, 10:00, or 17:00 on weekdays
- Instagram: 07:00, 12:00, 19:00, or 20:00
- Facebook: 09:00, 12:00, or 15:00
- Twitter/X: 08:00, 12:00, or 17:00
- TikTok: 07:00, 19:00, 20:00, or 21:00
- Pinterest: 14:00, 20:00, or 21:00
- YouTube: 14:00 or 15:00, prefer Thursday–Saturday
- Mastodon/Bluesky: 09:00 or 17:00

Platform content conventions:
- LinkedIn: professional hook first line, insights, 1300-char max
- Instagram: visual-first, emojis ok, 2200-char max, 5-10 hashtags
- Facebook: conversational, question or story, 500-char ideal
- Twitter/X: concise, punchy, under 280 chars
- TikTok: hook in first 3 words, trending angle, keep under 150 chars
- Pinterest: keyword-rich description, action-oriented
- Mastodon/Bluesky: authentic, community-focused, 300/500 chars

Return a single JSON object:
{
  "brief": ${approvedBrief ? JSON.stringify(approvedBrief) : `{
    "theme": "<one-sentence monthly narrative>",
    "pillars": ["<pillar 1>", "<pillar 2>", "<pillar 3>"],
    "toneGuidance": "<one sentence>",
    "platformNotes": { ${platformNoteKeys.split(', ').map((k) => `${k}: "<strategy>"`).join(', ')} }
  }`},
  "posts": [<${totalPosts} post objects using schema: ${postSchema}>]
}

Return ONLY the JSON object.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 180000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 180000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 180000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let calendar = null;
    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      calendar = JSON.parse(jsonStr);
      if (!calendar.brief || !Array.isArray(calendar.posts)) throw new Error('Missing brief or posts array');
      if (!Array.isArray(calendar.brief.pillars)) calendar.brief.pillars = [];
      if (typeof calendar.brief.theme !== 'string') calendar.brief.theme = '';
      // Normalise suggestedTime: ensure HH:MM format, default 09:00
      calendar.posts = calendar.posts
        .filter((p) => p && typeof p.content === 'string')
        .slice(0, totalPosts)
        .map((p) => ({
          ...p,
          suggestedTime: /^\d{2}:\d{2}$/.test(p.suggestedTime || '') ? p.suggestedTime : '09:00',
        }));
      if (calendar.posts.length === 0) throw new Error('No valid posts in response');
    } catch (parseErr) {
      log.warn({ action: 'content_calendar', outcome: 'parse_failure', err: parseErr.message });
      return reply.code(503).send({ error: 'AI returned invalid calendar format — try again or use a more capable model' });
    }

    const doc = {
      accountKey: accountKey || null,
      month: calMonth,
      monthName,
      platforms,
      postsPerWeek,
      brief: calendar.brief,
      posts: calendar.posts,
      workspaceId: ws,
      createdAt: new Date(),
    };
    const result = await db.collection('content_calendars').insertOne(doc);
    log.info({ action: 'content_calendar', month: calMonth, platforms: platforms.join(','), posts: calendar.posts.length, outcome: 'success' });
    return { success: true, calendarId: result.insertedId.toString(), ...doc };
  } catch (err) {
    log.error({ action: 'content_calendar', outcome: 'failure', err: err.message });
    return reply.code(503).send({ error: `Calendar generation failed: ${err.message}` });
  }
});

// GET /ai/content-calendar/:id — retrieve a saved calendar
app.get('/ai/content-calendar/:id', async (request, reply) => {
  const ws = request.workspaceId;
  let oid;
  try { oid = new ObjectId(request.params.id); } catch { return reply.code(400).send({ error: 'Invalid id' }); }
  const db = await getDb();
  const cal = await db.collection('content_calendars').findOne({ _id: oid, workspaceId: ws });
  if (!cal) return reply.code(404).send({ error: 'Calendar not found' });
  return { calendarId: cal._id.toString(), ...cal };
});

// GET /ai/content-calendars — list recent calendars
app.get('/ai/content-calendars', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const cals = await db.collection('content_calendars')
    .find({ workspaceId: ws }, { projection: { posts: 0 } })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return { calendars: cals.map((c) => ({ calendarId: c._id.toString(), month: c.month, monthName: c.monthName, platforms: c.platforms, brief: c.brief, createdAt: c.createdAt })) };
});

// ─── Bulk AI Draft Generation ─────────────────────────────────────────────────

// POST /ai/bulk-draft — kick off a batch; returns batchId immediately (non-blocking)
// Body: { topics: string[], destinations: Destination[], tone?: string, model?: string }
app.post('/ai/bulk-draft', async (request, reply) => {
  const ws = request.workspaceId;
  const { topics, destinations = [], tone = '', model: reqModel } = request.body || {};
  if (!Array.isArray(topics) || !topics.length) return reply.code(400).send({ error: 'topics array is required' });

  const filteredTopics = topics.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  if (!filteredTopics.length) return reply.code(400).send({ error: 'No valid topics provided' });

  const db = await getDb();
  const batchId = new ObjectId();
  const now = new Date();

  await db.collection('bulk_draft_batches').insertOne({
    _id: batchId,
    total: filteredTopics.length,
    completed: 0,
    failed: 0,
    status: 'processing',
    workspaceId: ws,
    createdAt: now,
    updatedAt: now,
  });

  const selectedDests = destinations.filter((d) => d.selected);
  const toneClause = tone ? `Write in a ${tone} tone.` : '';
  const platformRules = buildPlatformRulesBlock(selectedDests);
  const system = `You are a social media content writer. Create engaging, concise posts that perform well. ${toneClause} Write only the post text with relevant hashtags. No explanations or preamble.${platformRules}`;

  // Fire-and-forget — process topics sequentially in the background
  (async () => {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = reqModel || pconf.model;

    for (const topic of filteredTopics) {
      try {
        const prompt = `Write a social media post about: ${topic}`;
        let content = '';

        if (pconf.provider === 'ollama') {
          const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
          content = res.data.response || '';
        } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
          if (!pconf.apiKey) throw new Error(`${pconf.provider} API key not configured`);
          const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
            model, messages: buildOpenAIMessages(prompt, system), stream: false,
          }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
          content = res.data.choices[0]?.message?.content || '';
        } else if (pconf.provider === 'gemini') {
          if (!pconf.apiKey) throw new Error('Gemini API key not configured');
          const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
            { contents: buildGeminiContents(prompt, system) },
            { timeout: 90000 },
          );
          content = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        if (content.trim()) {
          const draftNow = new Date();
          await db.collection('drafts').insertOne({
            content: content.trim(),
            mediaUrl: '',
            scheduledAt: '',
            destinations: selectedDests,
            batchId: batchId.toString(),
            topic,
            workspaceId: request.workspaceId,
            createdAt: draftNow,
            updatedAt: draftNow,
          });
        }

        await db.collection('bulk_draft_batches').updateOne(
          { _id: batchId },
          { $inc: { completed: 1 }, $set: { updatedAt: new Date() } },
        );
      } catch (err) {
        log.error({ action: 'bulk_draft_topic', topic, outcome: 'failure', err: err.message });
        await db.collection('bulk_draft_batches').updateOne(
          { _id: batchId },
          { $inc: { failed: 1 }, $set: { updatedAt: new Date() } },
        );
      }
    }

    await db.collection('bulk_draft_batches').updateOne(
      { _id: batchId },
      { $set: { status: 'done', updatedAt: new Date() } },
    );
    log.info({ action: 'bulk_draft_batch', batchId: batchId.toString(), total: filteredTopics.length, outcome: 'success' });
  })().catch((err) => {
    log.error({ action: 'bulk_draft_batch', batchId: batchId.toString(), outcome: 'failure', err: err.message });
    getDb().then((d) => d.collection('bulk_draft_batches').updateOne(
      { _id: batchId },
      { $set: { status: 'failed', updatedAt: new Date() } },
    )).catch(() => {});
  });

  return reply.code(202).send({ batchId: batchId.toString() });
});

// GET /ai/bulk-draft/:batchId — poll batch progress
app.get('/ai/bulk-draft/:batchId', async (request, reply) => {
  const ws = request.workspaceId;
  const { batchId } = request.params;
  let oid;
  try { oid = new ObjectId(batchId); } catch { return reply.code(400).send({ error: 'Invalid batchId' }); }
  const db = await getDb();
  const batch = await db.collection('bulk_draft_batches').findOne({ _id: oid, workspaceId: ws });
  if (!batch) return reply.code(404).send({ error: 'Batch not found' });
  return {
    batchId: batch._id.toString(),
    total: batch.total,
    completed: batch.completed,
    failed: batch.failed,
    status: batch.status,
    processed: batch.completed + batch.failed,
  };
});

// ─── Platform service URLs ────────────────────────────────────────────────────

const PLATFORM_SERVICES = {
  twitter:   process.env.TWITTER_SERVICE_URL   || 'http://twitter:3001',
  linkedin:  process.env.LINKEDIN_SERVICE_URL  || 'http://linkedin:3002',
  mastodon:  process.env.MASTODON_SERVICE_URL  || 'http://mastodon:3003',
  bluesky:   process.env.BLUESKY_SERVICE_URL   || 'http://bluesky:3004',
  instagram: process.env.INSTAGRAM_SERVICE_URL || 'http://instagram:3005',
  facebook:  process.env.FACEBOOK_SERVICE_URL  || 'http://facebook:3006',
};

// Direct multi-platform post endpoint.
// Body: { content: string, destinations: Array<{ platform, accountId?, imageUrl?, videoUrl?, link? }> }
app.post('/post', async (request, reply) => {
  const { content, destinations = [], firstComment } = request.body || {};
  if (!content?.trim()) return reply.code(400).send({ error: 'content is required' });
  if (!destinations.length) return reply.code(400).send({ error: 'destinations must not be empty' });

  const workspaceId = request.workspaceId;
  const results = await Promise.allSettled(
    destinations.map(async ({ platform, accountId, imageUrl, videoUrl, link }) => {
      const serviceUrl = PLATFORM_SERVICES[platform];
      if (!serviceUrl) throw new Error(`Unknown platform: ${platform}`);
      const res = await axios.post(
        `${serviceUrl}/post`,
        { content, accountId, imageUrl, videoUrl, link, firstComment: firstComment?.trim() || undefined },
        { timeout: 30000, headers: { 'X-Workspace-Id': workspaceId } }
      );
      return { platform, accountId, ...res.data };
    })
  );

  const output = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: destinations[i].platform, accountId: destinations[i].accountId, success: false, error: r.reason?.message }
  );

  const anyFailed = output.some((r) => !r.success);
  const anySucceeded = output.some((r) => r.success);
  const postStatus = anyFailed && anySucceeded ? 'partial' : anyFailed ? 'failed' : 'published';

  // Record the post for analytics
  try {
    const db = await getDb();
    await db.collection('posts').insertOne({
      _id: crypto.randomUUID(),
      type: 'immediate',
      content,
      ...(firstComment?.trim() && { firstComment: firstComment.trim() }),
      destinations,
      platformResults: Object.fromEntries(
        output.map((r) => [
          r.accountId ? `${r.platform}:${r.accountId}` : r.platform,
          { success: r.success, ...(r.error && { error: r.error }) },
        ])
      ),
      status: postStatus,
      workspaceId: request.workspaceId,
      publishedAt: new Date(),
      createdAt: new Date(),
    });
  } catch (err) {
    app.log.warn({ action: 'post_record', outcome: 'failure', err: err.message });
  }

  return reply.code(anyFailed ? 207 : 200).send({ results: output });
});

// ─── Legacy post route ────────────────────────────────────────────────────────

let rabbitMQProducer = new RabbitMQProducer();

app.post('/', async (request, reply) => {
  try {
    await rabbitMQProducer.sendMessage('formatter', request.body.message);
    reply.send({ status: 'ok' });
  } catch (error) {
    app.log.error({ action: 'legacy_post', outcome: 'failure', err: error.message });
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// ─── Meta App Credentials ────────────────────────────────────────────────────

// Save Facebook App ID + Secret (entered by user in Settings UI)
app.post('/credentials/meta-app', async (request, reply) => {
  const ws = request.workspaceId;
  const { appId, appSecret } = request.body || {};
  if (!appId || !appSecret) {
    return reply.code(400).send({ error: 'appId and appSecret are required' });
  }
  await setCredentials(ws, 'meta_app', { appId, appSecret: encryptToken(appSecret) });
  return { success: true };
});

// Get Meta App config (secret is masked for UI display)
app.get('/credentials/meta-app', async (request) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'meta_app');
  if (!cred) return { configured: false };
  const plainSecret = decryptToken(cred.appSecret) || '';
  return { configured: true, appId: cred.appId, appSecretHint: plainSecret ? `****${plainSecret.slice(-4)}` : '****' };
});

// ─── Meta OAuth Flow ──────────────────────────────────────────────────────────

// Return the Facebook OAuth URL to redirect the user to
app.get('/auth/meta/init', async (request, reply) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'meta_app');
  if (!cred?.appId) {
    return reply.code(400).send({ error: 'Save your Facebook App ID and Secret first' });
  }

  const redirectUri = `${APP_BASE_URL}/api/auth/meta/callback`;
  const scopes = [
    'pages_manage_posts',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_insights',
  ].join(',');

  const url = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${cred.appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${encodeURIComponent(ws)}`;
  return { url };
});

// OAuth callback — Facebook redirects here after user authorises
app.get('/auth/meta/callback', async (request, reply) => {
  const { code, state, error: oauthError } = request.query;
  // Recover workspace from state param (browser redirects carry no X-Workspace-Id header)
  const ws = (state && String(state).trim()) ? String(state) : request.workspaceId;

  if (oauthError) {
    return reply.redirect(`${APP_BASE_URL}/settings?meta_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return reply.redirect(`${APP_BASE_URL}/settings?meta_error=no_code`);
  }

  try {
    const appCred = await getCredentials(ws, 'meta_app');
    if (!appCred?.appId) throw new Error('App credentials not configured');
    const appSecret = decryptToken(appCred.appSecret);
    if (!appSecret) throw new Error('Failed to decrypt app secret');

    const redirectUri = `${APP_BASE_URL}/api/auth/meta/callback`;

    // Exchange code for short-lived token
    const shortRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        client_id: appCred.appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    // Upgrade to long-lived user token (~60 days)
    const longRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appCred.appId,
        client_secret: appSecret,
        fb_exchange_token: shortRes.data.access_token,
      },
    });
    const userToken = longRes.data.access_token;

    // Fetch all managed Facebook Pages
    const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
      params: { access_token: userToken, fields: 'id,name,access_token,picture' },
    });

    const pages = [];
    const igAccounts = [];

    for (const page of pagesRes.data.data || []) {
      pages.push({
        id: page.id,
        name: page.name,
        accessToken: encryptToken(page.access_token),
        picture: page.picture?.data?.url || null,
        selected: false,
      });

      // Check for linked Instagram Business Account
      try {
        const igRes = await axios.get(`${GRAPH_API}/${page.id}`, {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        });
        if (igRes.data.instagram_business_account?.id) {
          const igId = igRes.data.instagram_business_account.id;
          // Fetch IG account details
          const igProfile = await axios.get(`${GRAPH_API}/${igId}`, {
            params: {
              fields: 'id,username,name,profile_picture_url',
              access_token: userToken,
            },
          });
          igAccounts.push({
            id: igId,
            username: igProfile.data.username || igProfile.data.name,
            name: igProfile.data.name,
            avatar: igProfile.data.profile_picture_url || null,
            accessToken: encryptToken(userToken),
            pageId: page.id,
            selected: false,
          });
        }
      } catch (_) {
        // Page has no linked Instagram account — skip
      }
    }

    // Store discovery results for the UI to pick from
    await setCredentials(ws, 'meta_discovery', { pages, igAccounts, discoveredAt: new Date() });

    reply.redirect(`${APP_BASE_URL}/settings?meta_discovery=1`);
  } catch (err) {
    app.log.error({ action: 'meta_oauth_callback', platform: 'meta', outcome: 'failure', err: err.response?.data?.error?.message || err.message });
    reply.redirect(`${APP_BASE_URL}/settings?meta_error=${encodeURIComponent(err.message)}`);
  }
});

// Return pending discovery results so the UI can render the page picker
app.get('/auth/meta/discovered', async (request) => {
  const ws = request.workspaceId;
  const discovery = await getCredentials(ws, 'meta_discovery');
  if (!discovery) return { pages: [], igAccounts: [] };
  return { pages: discovery.pages || [], igAccounts: discovery.igAccounts || [] };
});

// User has chosen which pages/accounts to connect
app.post('/auth/meta/save', async (request, reply) => {
  const ws = request.workspaceId;
  const { selectedPageIds = [], selectedIgAccountIds = [] } = request.body || {};

  const discovery = await getCredentials(ws, 'meta_discovery');
  if (!discovery) return reply.code(400).send({ error: 'No discovery data found — reconnect via OAuth' });

  const fbPages = (discovery.pages || []).map((p) => ({
    ...p,
    selected: selectedPageIds.includes(p.id),
  }));

  const igAccounts = (discovery.igAccounts || []).map((a) => ({
    ...a,
    selected: selectedIgAccountIds.includes(a.id),
  }));

  await setCredentials(ws, 'facebook', { pages: fbPages });
  await setCredentials(ws, 'instagram', { accounts: igAccounts });
  await deleteCredentials(ws, 'meta_discovery');
  _tokenExpiryCache = null; // invalidate cache after reconnect

  return { success: true, facebookPages: fbPages.filter((p) => p.selected).length, instagramAccounts: igAccounts.filter((a) => a.selected).length };
});

// Disconnect all Meta platforms
app.delete('/credentials/meta', async (request) => {
  const ws = request.workspaceId;
  await deleteCredentials(ws, 'facebook');
  await deleteCredentials(ws, 'instagram');
  await deleteCredentials(ws, 'meta_discovery');
  return { success: true };
});

// ─── Pinterest OAuth Flow ─────────────────────────────────────────────────────

const PINTEREST_API = 'https://api.pinterest.com/v5';
const PINTEREST_AUTH_URL = 'https://www.pinterest.com/oauth/';
const PINTEREST_TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';

app.post('/credentials/pinterest-app', async (request, reply) => {
  const ws = request.workspaceId;
  const { clientId, clientSecret } = request.body || {};
  if (!clientId || !clientSecret) {
    return reply.code(400).send({ error: 'clientId and clientSecret are required' });
  }
  await setCredentials(ws, 'pinterest_app', { clientId, clientSecret: encryptToken(clientSecret) });
  log.info({ action: 'pinterest_app_save', outcome: 'success' });
  return { success: true };
});

app.get('/credentials/pinterest-app', async (request) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'pinterest_app');
  if (!cred) return { configured: false };
  const plain = decryptToken(cred.clientSecret) || '';
  return { configured: true, clientId: cred.clientId, clientSecretHint: plain ? `****${plain.slice(-4)}` : '****' };
});

app.get('/auth/pinterest/init', async (request, reply) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'pinterest_app');
  if (!cred?.clientId) {
    return reply.code(400).send({ error: 'Save your Pinterest Client ID and Secret first' });
  }
  const redirectUri = `${APP_BASE_URL}/api/auth/pinterest/callback`;
  const scopes = 'pins:read,pins:write,boards:read,user_accounts:read';
  const url = `${PINTEREST_AUTH_URL}?client_id=${cred.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&state=${encodeURIComponent(ws)}`;
  return { url };
});

app.get('/auth/pinterest/callback', async (request, reply) => {
  const { code, state, error: oauthError } = request.query;
  const ws = (state && String(state).trim()) ? String(state) : request.workspaceId;

  if (oauthError) {
    return reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=no_code`);
  }

  try {
    const appCred = await getCredentials(ws, 'pinterest_app');
    if (!appCred?.clientId) throw new Error('App credentials not configured');
    const clientSecret = decryptToken(appCred.clientSecret);
    if (!clientSecret) throw new Error('Failed to decrypt client secret');

    const redirectUri = `${APP_BASE_URL}/api/auth/pinterest/callback`;
    const basicAuth = Buffer.from(`${appCred.clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await axios.post(
      PINTEREST_TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const tokenExpiry = new Date(Date.now() + (expires_in || 30 * 24 * 60 * 60) * 1000).toISOString();

    const [userRes, boardsRes] = await Promise.all([
      axios.get(`${PINTEREST_API}/user_account`, {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      }),
      axios.get(`${PINTEREST_API}/boards`, {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { page_size: 100 },
        timeout: 15000,
      }),
    ]);

    const boards = (boardsRes.data.items || []).map((b) => ({
      id: b.id,
      name: b.name,
      privacy: b.privacy,
      selected: false,
    }));

    await setCredentials(ws, 'pinterest', {
      userId: userRes.data.username,
      username: userRes.data.username,
      displayName: userRes.data.business_name || userRes.data.username,
      avatar: userRes.data.profile_image,
      accessToken: encryptToken(access_token),
      refreshToken: refresh_token ? encryptToken(refresh_token) : null,
      tokenExpiry,
      boards,
    });

    log.info({ action: 'pinterest_oauth_callback', username: userRes.data.username, boards: boards.length, outcome: 'success' });
    reply.redirect(`${APP_BASE_URL}/settings?pinterest_connected=1`);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    log.error({ action: 'pinterest_oauth_callback', outcome: 'failure', err: msg });
    reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=${encodeURIComponent(msg)}`);
  }
});

app.post('/credentials/pinterest/boards', async (request, reply) => {
  const ws = request.workspaceId;
  const { selectedBoardIds = [] } = request.body || {};
  const cred = await getCredentials(ws, 'pinterest');
  if (!cred) return reply.code(400).send({ error: 'Pinterest not connected' });

  const boards = (cred.boards || []).map((b) => ({ ...b, selected: selectedBoardIds.includes(b.id) }));
  await setCredentials(ws, 'pinterest', { ...cred, boards });
  log.info({ action: 'pinterest_boards_save', selected: boards.filter((b) => b.selected).length, outcome: 'success' });
  return { success: true, selected: boards.filter((b) => b.selected).length };
});

app.delete('/credentials/pinterest', async (request) => {
  const ws = request.workspaceId;
  await deleteCredentials(ws, 'pinterest');
  return { success: true };
});

// ─── TikTok OAuth ─────────────────────────────────────────────────────────────

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

app.post('/credentials/tiktok-app', async (request, reply) => {
  const ws = request.workspaceId;
  const { clientKey, clientSecret } = request.body || {};
  if (!clientKey || !clientSecret) return reply.code(400).send({ error: 'clientKey and clientSecret are required' });
  await setCredentials(ws, 'tiktok_app', { clientKey, clientSecret: encryptToken(clientSecret) });
  log.info({ action: 'tiktok_app_save', outcome: 'success' });
  return { success: true };
});

app.get('/credentials/tiktok-app', async (request) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'tiktok_app');
  if (!cred?.clientKey) return { configured: false };
  return { configured: true, clientKey: cred.clientKey, clientSecretHint: `****${decryptToken(cred.clientSecret).slice(-4)}` };
});

app.get('/auth/tiktok/init', async (request, reply) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'tiktok_app');
  if (!cred?.clientKey) return reply.code(400).send({ error: 'Save your TikTok Client Key and Secret first' });

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // Persist PKCE verifier for the callback
  const pkceId = credId(ws, 'tiktok_pkce');
  const db = await getDb();
  await db.collection('platform_credentials').updateOne(
    { _id: pkceId },
    { $set: { _id: pkceId, workspaceId: ws, codeVerifier, state, createdAt: new Date() } },
    { upsert: true }
  );

  const redirectUri = `${APP_BASE_URL}/api/auth/tiktok/callback`;
  const scopes = 'user.info.basic,video.list,video.publish';
  const params = new URLSearchParams({
    client_key: cred.clientKey,
    scope: scopes,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url: `${TIKTOK_AUTH_URL}?${params.toString()}` };
});

app.get('/auth/tiktok/callback', async (request, reply) => {
  const { code, state, error: oauthError, error_description } = request.query;

  if (oauthError) {
    const msg = error_description || oauthError;
    return reply.redirect(`${APP_BASE_URL}/settings?tiktok_error=${encodeURIComponent(msg)}`);
  }
  if (!code) {
    return reply.redirect(`${APP_BASE_URL}/settings?tiktok_error=no_code`);
  }

  try {
    const db = await getDb();
    // Look up PKCE by state value — recovers the workspace ID that initiated the OAuth
    const pkce = await db.collection('platform_credentials').findOne({ state });
    if (!pkce?.codeVerifier) throw new Error('PKCE state not found — try connecting again');
    const ws = pkce.workspaceId || request.workspaceId;

    const appCred = await getCredentials(ws, 'tiktok_app');
    if (!appCred?.clientKey) throw new Error('App credentials not configured');
    const clientSecret = decryptToken(appCred.clientSecret);

    const redirectUri = `${APP_BASE_URL}/api/auth/tiktok/callback`;
    const tokenRes = await axios.post(
      TIKTOK_TOKEN_URL,
      new URLSearchParams({
        client_key: appCred.clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: pkce.codeVerifier,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    const { access_token, refresh_token, expires_in, refresh_expires_in, open_id } = tokenRes.data;
    const tokenExpiry = new Date(Date.now() + (expires_in || 86400) * 1000).toISOString();
    const refreshExpiry = new Date(Date.now() + (refresh_expires_in || 31536000) * 1000).toISOString();

    const userRes = await axios.get(`${TIKTOK_API}/user/info/`, {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { fields: 'open_id,display_name,avatar_url,username' },
      timeout: 10000,
    });
    const user = userRes.data?.data?.user || {};

    await setCredentials(ws, 'tiktok', {
      openId: open_id || user.open_id,
      username: user.username || user.display_name,
      displayName: user.display_name,
      avatar: user.avatar_url || null,
      accessToken: encryptToken(access_token),
      refreshToken: refresh_token ? encryptToken(refresh_token) : null,
      tokenExpiry,
      refreshExpiry,
    });

    // Clean up PKCE temp state
    await db.collection('platform_credentials').deleteOne({ _id: credId(ws, 'tiktok_pkce') });

    log.info({ action: 'tiktok_oauth_callback', username: user.username || user.display_name, outcome: 'success' });
    reply.redirect(`${APP_BASE_URL}/settings?tiktok_connected=1`);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    log.error({ action: 'tiktok_oauth_callback', outcome: 'failure', err: msg });
    reply.redirect(`${APP_BASE_URL}/settings?tiktok_error=${encodeURIComponent(msg)}`);
  }
});

app.delete('/credentials/tiktok', async (request) => {
  const ws = request.workspaceId;
  await deleteCredentials(ws, 'tiktok');
  return { success: true };
});

// ─── Credential Status ────────────────────────────────────────────────────────

// Aggregate connection status for all DB-managed platforms
app.get('/credentials', async (request) => {
  const ws = request.workspaceId;
  const [metaApp, fb, ig, pinterest, tiktok] = await Promise.all([
    getCredentials(ws, 'meta_app'),
    getCredentials(ws, 'facebook'),
    getCredentials(ws, 'instagram'),
    getCredentials(ws, 'pinterest'),
    getCredentials(ws, 'tiktok'),
  ]);

  const fbPages = (fb?.pages || []).filter((p) => p.selected);
  const igAccounts = (ig?.accounts || []).filter((a) => a.selected);
  const pinterestBoards = (pinterest?.boards || []).filter((b) => b.selected);

  return {
    metaApp: { configured: !!(metaApp?.appId) },
    facebook: {
      connected: fbPages.length > 0,
      pages: fbPages.map(({ id, name, picture }) => ({ id, name, picture })),
      allPages: (fb?.pages || []).map(({ id, name, picture, selected }) => ({ id, name, picture, selected: !!selected })),
    },
    instagram: {
      connected: igAccounts.length > 0,
      accounts: igAccounts.map(({ id, username, avatar }) => ({ id, username, avatar })),
      allAccounts: (ig?.accounts || []).map(({ id, username, avatar, selected }) => ({ id, username, avatar, selected: !!selected })),
    },
    pinterest: {
      connected: pinterestBoards.length > 0,
      username: pinterest?.username || null,
      boards: pinterestBoards.map(({ id, name, privacy }) => ({ id, name, privacy })),
      allBoards: (pinterest?.boards || []).map(({ id, name, privacy, selected }) => ({ id, name, privacy, selected })),
    },
    tiktok: {
      connected: !!(tiktok?.accessToken),
      username: tiktok?.username || null,
      displayName: tiktok?.displayName || null,
      avatar: tiktok?.avatar || null,
    },
  };
});

// ─── Schedule Suggestions ────────────────────────────────────────────────────

// Update which Facebook pages are selected for this workspace
app.post('/credentials/facebook/pages', async (request) => {
  const ws = request.workspaceId;
  const { selectedPageIds } = request.body;
  const fb = await getCredentials(ws, 'facebook');
  if (!fb) return { success: false, error: 'Not connected' };
  const updated = (fb.pages || []).map((p) => ({ ...p, selected: selectedPageIds.includes(p.id) }));
  await setCredentials(ws, 'facebook', { pages: updated });
  return { success: true };
});

// Update which Instagram accounts are selected for this workspace
app.post('/credentials/instagram/accounts', async (request) => {
  const ws = request.workspaceId;
  const { selectedAccountIds } = request.body;
  const ig = await getCredentials(ws, 'instagram');
  if (!ig) return { success: false, error: 'Not connected' };
  const updated = (ig.accounts || []).map((a) => ({ ...a, selected: selectedAccountIds.includes(a.id) }));
  await setCredentials(ws, 'instagram', { accounts: updated });
  return { success: true };
});

// [dayOfWeek (0=Sun), hourUTC] pairs — research-based best-practice defaults
const INDUSTRY_DEFAULTS = {
  facebook:  [[2,9],[3,9],[4,9],[2,12],[4,10]],
  instagram: [[1,11],[2,11],[3,11],[2,14],[3,14]],
  twitter:   [[2,9],[3,9],[4,9],[2,12],[3,12]],
  linkedin:  [[2,8],[3,8],[4,8],[3,12],[4,12]],
  mastodon:  [[2,10],[3,10],[4,10],[1,11],[2,11]],
  bluesky:   [[1,10],[2,10],[3,10],[1,11],[2,11]],
  reddit:    [[1,7],[2,7],[3,7],[4,7],[0,9]],
  youtube:   [[4,12],[5,12],[6,12],[4,15],[5,15]],
  pinterest: [[5,12],[6,14],[0,15],[5,20],[6,20]],
  tiktok:    [[2,18],[3,18],[4,18],[5,12],[0,14]],
};
const DEFAULT_SLOTS = [[2,9],[3,9],[4,9],[2,12],[3,12]];

// Returns the next UTC Date that falls on `dayOfWeek` at `hourUTC`:00,
// at least `afterMs` milliseconds in the future.
function nextOccurrence(dayOfWeek, hourUTC, afterMs) {
  const candidate = new Date(afterMs);
  candidate.setUTCHours(hourUTC, 0, 0, 0);

  const daysAhead = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= afterMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  } else {
    candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  }
  return candidate;
}

const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

app.get('/schedule/suggestions', async (request, reply) => {
  const { platform, accountId } = request.query;
  if (!platform) return reply.code(400).send({ error: 'platform is required' });

  const ws = request.workspaceId;
  const db = await getDb();
  const query = { workspaceId: ws, platform, ...(accountId && { accountId }) };
  const dataPoints = await db.collection('post_metrics').countDocuments(query);

  let slots;
  let source;

  if (dataPoints >= 10) {
    const agg = await db.collection('post_metrics').aggregate([
      { $match: query },
      { $group: {
        _id: { day: '$dayOfWeek', hour: '$hourOfDay' },
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        count: { $sum: 1 },
      }},
      { $sort: { avgEngagement: -1 } },
      { $limit: 5 },
    ]).toArray();
    slots = agg.map((r) => [r._id.day, r._id.hour]);
    source = 'history';
  } else {
    slots = INDUSTRY_DEFAULTS[platform] || DEFAULT_SLOTS;
    source = 'default';
  }

  // 30-minute lead time so the user has time to finish writing
  const afterMs = Date.now() + 30 * 60 * 1000;
  const suggestions = slots
    .map(([day, hour]) => {
      const dt = nextOccurrence(day, hour, afterMs);
      const h12 = hour % 12 || 12;
      const ampm = hour < 12 ? 'am' : 'pm';
      return {
        utc: dt.toISOString(),
        dayOfWeek: day,
        hour,
        label: `${DAY_ABBR[day]} ${h12}${ampm}`,
      };
    })
    .sort((a, b) => new Date(a.utc) - new Date(b.utc))
    .slice(0, 4);

  app.log.info({ action: 'schedule_suggestions', platform, source, count: suggestions.length });
  return { source, suggestions };
});

// ─── Analytics Metrics Crawl ─────────────────────────────────────────────────

async function crawlFacebookMetrics(db, ws = 'default') {
  const fb = await getCredentials(ws, 'facebook');
  const pages = (fb?.pages || []).filter((p) => p.selected && p.accessToken);
  if (!pages.length) return { count: 0 };

  let count = 0;
  for (const page of pages) {
    const token = decryptToken(page.accessToken);
    if (!token) continue;
    try {
      const res = await axios.get(`${GRAPH_API}/${page.id}/posts`, {
        params: {
          fields: 'id,message,created_time,reactions.summary(total_count),comments.summary(total_count),shares',
          limit: 100,
          access_token: token,
        },
        timeout: 30000,
      });
      for (const post of res.data.data || []) {
        const likes    = post.reactions?.summary?.total_count || 0;
        const comments = post.comments?.summary?.total_count || 0;
        const shares   = post.shares?.count || 0;
        const publishedAt = new Date(post.created_time);
        await db.collection('post_metrics').updateOne(
          { platform: 'facebook', postId: post.id, workspaceId: ws },
          {
            $set: {
              platform: 'facebook',
              accountId: page.id,
              accountName: page.name,
              postId: post.id,
              content: post.message || null,
              publishedAt,
              metrics: { likes, comments, shares, views: 0, saves: 0, engagementTotal: likes + comments + shares },
              hourOfDay: publishedAt.getUTCHours(),
              dayOfWeek: publishedAt.getUTCDay(),
              workspaceId: ws,
              fetchedAt: new Date(),
            },
          },
          { upsert: true }
        );
        count++;
      }
    } catch (err) {
      app.log.warn({ action: 'metrics_crawl', platform: 'facebook', pageId: page.id, outcome: 'failure', err: err.message });
    }
  }
  return { count };
}

async function crawlInstagramMetrics(db, ws = 'default') {
  const ig = await getCredentials(ws, 'instagram');
  const accounts = (ig?.accounts || []).filter((a) => a.selected && a.accessToken);
  if (!accounts.length) return { count: 0 };

  let count = 0;
  for (const account of accounts) {
    const token = decryptToken(account.accessToken);
    if (!token) continue;
    try {
      const mediaRes = await axios.get(`${GRAPH_API}/${account.id}/media`, {
        params: { fields: 'id,caption,timestamp,like_count,comments_count', limit: 100, access_token: token },
        timeout: 30000,
      });
      for (const media of mediaRes.data.data || []) {
        const likes    = media.like_count    || 0;
        const comments = media.comments_count || 0;
        const publishedAt = new Date(media.timestamp);
        let views = 0;
        let saves = 0;
        try {
          const insRes = await axios.get(`${GRAPH_API}/${media.id}/insights`, {
            params: { metric: 'reach,saved', access_token: token },
            timeout: 10000,
          });
          for (const ins of insRes.data.data || []) {
            if (ins.name === 'reach') views = ins.values?.[0]?.value || 0;
            if (ins.name === 'saved') saves = ins.values?.[0]?.value || 0;
          }
        } catch (_) {}
        await db.collection('post_metrics').updateOne(
          { platform: 'instagram', postId: media.id, workspaceId: ws },
          {
            $set: {
              platform: 'instagram',
              accountId: account.id,
              accountName: account.username,
              postId: media.id,
              content: media.caption || null,
              publishedAt,
              metrics: { likes, comments, shares: 0, views, saves, engagementTotal: likes + comments },
              hourOfDay: publishedAt.getUTCHours(),
              dayOfWeek: publishedAt.getUTCDay(),
              workspaceId: ws,
              fetchedAt: new Date(),
            },
          },
          { upsert: true }
        );
        count++;
      }
    } catch (err) {
      app.log.warn({ action: 'metrics_crawl', platform: 'instagram', accountId: account.id, outcome: 'failure', err: err.message });
    }
  }
  return { count };
}

app.post('/analytics/crawl', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const results = {};
  for (const [platform, crawler] of [['facebook', crawlFacebookMetrics], ['instagram', crawlInstagramMetrics]]) {
    try {
      results[platform] = await crawler(db, ws);
    } catch (err) {
      app.log.error({ action: 'metrics_crawl', platform, outcome: 'failure', err: err.message });
      results[platform] = { count: 0, error: err.message };
    }
  }
  const total = Object.values(results).reduce((sum, r) => sum + (r.count || 0), 0);
  app.log.info({ action: 'metrics_crawl', outcome: 'complete', total });
  return { success: true, total, byPlatform: results };
});

app.get('/analytics/insights', async (request) => {
  const ws = request.workspaceId;
  const filter = parseAccountFilter(request.query.account);
  const metricsMatch = filter
    ? { workspaceId: ws, platform: filter.platform, ...(filter.accountId && { accountId: filter.accountId }) }
    : { workspaceId: ws };
  const db = await getDb();
  const total = await db.collection('post_metrics').countDocuments(metricsMatch);
  if (total === 0) return { empty: true };

  const [byHourRaw, byDayRaw, topPosts, platformComparison, heatmapRaw] = await Promise.all([
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: { _id: '$hourOfDay', avgEngagement: { $avg: '$metrics.engagementTotal' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: { _id: '$dayOfWeek', avgEngagement: { $avg: '$metrics.engagementTotal' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('post_metrics').find(metricsMatch).sort({ 'metrics.engagementTotal': -1 }).limit(5).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: {
        _id: '$platform',
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        avgLikes:      { $avg: '$metrics.likes' },
        avgComments:   { $avg: '$metrics.comments' },
        avgShares:     { $avg: '$metrics.shares' },
        totalPosts:    { $sum: 1 },
      }},
      { $sort: { avgEngagement: -1 } },
    ]).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: {
        _id: { day: '$dayOfWeek', hour: '$hourOfDay' },
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        count: { $sum: 1 },
      }},
    ]).toArray(),
  ]);

  const byHour = Array.from({ length: 24 }, (_, h) => {
    const e = byHourRaw.find((r) => r._id === h);
    return { hour: h, avgEngagement: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });
  const byDay = Array.from({ length: 7 }, (_, d) => {
    const e = byDayRaw.find((r) => r._id === d);
    return { day: d, avgEngagement: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });
  const heatmap = Array.from({ length: 7 * 24 }, (_, i) => {
    const day  = Math.floor(i / 24);
    const hour = i % 24;
    const e = heatmapRaw.find((r) => r._id.day === day && r._id.hour === hour);
    return { day, hour, avg: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });

  return {
    empty: false,
    total,
    byHour,
    byDay,
    heatmap,
    topPosts: topPosts.map((p) => ({
      platform: p.platform, accountName: p.accountName, postId: p.postId,
      content: p.content, publishedAt: p.publishedAt, metrics: p.metrics,
    })),
    platformComparison: platformComparison.map((p) => ({
      platform: p._id,
      avgEngagement: Math.round(p.avgEngagement),
      avgLikes:      Math.round(p.avgLikes),
      avgComments:   Math.round(p.avgComments),
      avgShares:     Math.round(p.avgShares),
      totalPosts:    p.totalPosts,
    })),
  };
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// Parse "platform" or "platform:accountId" filter strings from the account query param.
function parseAccountFilter(account) {
  if (!account) return null;
  const idx = account.indexOf(':');
  if (idx === -1) return { platform: account };
  return { platform: account.slice(0, idx), accountId: account.slice(idx + 1) };
}

// Build a MongoDB match fragment for scheduled_jobs given an account filter.
function sjFilter(filter, workspaceId) {
  const wsClause = workspaceId
    ? { $or: [{ workspaceId }, { workspaceId: { $exists: false } }] }
    : {};
  if (!filter) return wsClause;
  return {
    ...wsClause,
    'destinations.platform': filter.platform,
    ...(filter.accountId && { 'destinations.accountId': filter.accountId }),
  };
}

// Build a MongoDB match fragment for posts (type:immediate) given an account filter.
function ipFilter(filter) {
  if (!filter) return {};
  return {
    'destinations.platform': filter.platform,
    ...(filter.accountId && { 'destinations.accountId': filter.accountId }),
  };
}

app.get('/analytics/summary', async (request) => {
  const ws = request.workspaceId;
  const filter = parseAccountFilter(request.query.account);
  const db = await getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);

  // Post-unwind filter for scheduled_jobs platform breakdown — re-applies the
  // account filter after $unwind so a job targeting multiple platforms only
  // counts the platform(s) that match the filter.
  const unwindFilter = filter ? [{ $match: sjFilter(filter, ws) }] : [];

  const wsIp = { workspaceId: ws };
  const [
    schedCompleted, schedFailed,
    immPublished, immFailed,
    recentSched, recentImm,
    schedPlatformRaw, immPlatformRaw,
    schedDayRaw, immDayRaw,
  ] = await Promise.all([
    db.collection('scheduled_jobs').countDocuments({ status: 'completed', ...sjFilter(filter, ws) }),
    db.collection('scheduled_jobs').countDocuments({ status: 'failed', ...sjFilter(filter, ws) }),
    db.collection('posts').countDocuments({ type: 'immediate', status: { $in: ['published', 'partial'] }, ...wsIp, ...ipFilter(filter) }),
    db.collection('posts').countDocuments({ type: 'immediate', status: 'failed', ...wsIp, ...ipFilter(filter) }),
    db.collection('scheduled_jobs').countDocuments({ status: 'completed', completedAt: { $gte: sevenDaysAgo }, ...sjFilter(filter, ws) }),
    db.collection('posts').countDocuments({ type: 'immediate', publishedAt: { $gte: sevenDaysAgo }, ...wsIp, ...ipFilter(filter) }),
    // Platform breakdown from scheduled_jobs destinations
    db.collection('scheduled_jobs').aggregate([
      { $match: { status: 'completed', ...sjFilter(filter, ws) } },
      { $unwind: '$destinations' },
      ...unwindFilter,
      { $group: { _id: '$destinations.platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    // Platform breakdown from immediate posts platformResults
    db.collection('posts').aggregate([
      { $match: { type: 'immediate', ...wsIp, ...ipFilter(filter) } },
      { $project: { results: { $objectToArray: { $ifNull: ['$platformResults', {}] } } } },
      { $unwind: '$results' },
      { $match: { 'results.v.success': true } },
      { $project: { platform: { $arrayElemAt: [{ $split: ['$results.k', ':'] }, 0] } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
    ]).toArray(),
    // Activity by day from scheduled_jobs (using completedAt)
    db.collection('scheduled_jobs').aggregate([
      { $match: { status: 'completed', completedAt: { $gte: thirtyDaysAgo }, ...sjFilter(filter, ws) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    // Activity by day from immediate posts
    db.collection('posts').aggregate([
      { $match: { type: 'immediate', publishedAt: { $gte: thirtyDaysAgo }, ...wsIp, ...ipFilter(filter) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$publishedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  const dayMap = {};
  for (const { _id, count } of [...schedDayRaw, ...immDayRaw]) {
    dayMap[_id] = (dayMap[_id] || 0) + count;
  }
  const byDay = Object.entries(dayMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  const platformMap = {};
  for (const { _id, count } of [...schedPlatformRaw, ...immPlatformRaw]) {
    if (_id) platformMap[_id] = (platformMap[_id] || 0) + count;
  }

  const published = schedCompleted + immPublished;
  const failed    = schedFailed    + immFailed;
  const total     = published + failed;
  const successRate = total > 0 ? Math.round((published / total) * 100) : 0;
  const recentCount = recentSched + recentImm;

  return { total, published, failed, partial: 0, successRate, byPlatform: platformMap, byDay, recentCount };
});

app.get('/analytics/posts', async (request) => {
  const ws = request.workspaceId;
  const limit  = Math.min(parseInt(request.query.limit || '20', 10), 100);
  const skip   = parseInt(request.query.skip || '0', 10);
  const filter = parseAccountFilter(request.query.account);
  const db = await getDb();

  const sjMatch = { status: { $in: ['completed', 'failed'] }, ...sjFilter(filter, ws) };
  const ipMatch = { type: 'immediate', workspaceId: ws, ...ipFilter(filter) };

  const [scheduledJobs, immediatePosts, schedTotal, immTotal] = await Promise.all([
    db.collection('scheduled_jobs')
      .find(sjMatch)
      .sort({ completedAt: -1, scheduledAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({ content: 1, destinations: 1, status: 1, completedAt: 1, scheduledAt: 1 })
      .toArray(),
    db.collection('posts')
      .find(ipMatch)
      .sort({ publishedAt: -1 })
      .project({ content: 1, destinations: 1, platformResults: 1, status: 1, publishedAt: 1 })
      .toArray(),
    db.collection('scheduled_jobs').countDocuments(sjMatch),
    db.collection('posts').countDocuments(ipMatch),
  ]);

  const normalised = [
    ...scheduledJobs.map((j) => ({
      _id: String(j._id),
      type: 'scheduled',
      content: j.content || null,
      destinations: j.destinations || [],
      platformResults: null,
      status: j.status === 'completed' ? 'published' : 'failed',
      publishedAt: j.completedAt || j.scheduledAt,
    })),
    ...immediatePosts.map((p) => ({
      _id: String(p._id),
      type: 'immediate',
      content: p.content || null,
      destinations: p.destinations || [],
      platformResults: p.platformResults || null,
      status: p.status,
      publishedAt: p.publishedAt,
    })),
  ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
   .slice(0, limit);

  return { posts: normalised, total: schedTotal + immTotal };
});

// ─── Analytics Export ─────────────────────────────────────────────────────────

// GET /analytics/export?format=csv&account=&month=YYYY-MM
// Exports scheduled jobs + immediate posts as a downloadable CSV.
app.get('/analytics/export', async (request, reply) => {
  const ws = request.workspaceId;
  const { format = 'csv', account, month } = request.query;
  const filter = parseAccountFilter(account);
  const db = await getDb();

  let dateFilter = {};
  if (month) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end   = new Date(start);
    end.setMonth(end.getMonth() + 1);
    dateFilter = { $gte: start, $lt: end };
  }

  const sjMatch = {
    status: { $in: ['completed', 'failed'] },
    ...sjFilter(filter, ws),
    ...(month ? { completedAt: dateFilter } : {}),
  };
  const ipMatch = {
    type: 'immediate',
    workspaceId: ws,
    ...ipFilter(filter),
    ...(month ? { publishedAt: dateFilter } : {}),
  };

  const [scheduledJobs, immediatePosts] = await Promise.all([
    db.collection('scheduled_jobs')
      .find(sjMatch)
      .sort({ completedAt: -1 })
      .project({ content: 1, destinations: 1, status: 1, completedAt: 1, scheduledAt: 1 })
      .toArray(),
    db.collection('posts')
      .find(ipMatch)
      .sort({ publishedAt: -1 })
      .project({ content: 1, destinations: 1, platformResults: 1, status: 1, publishedAt: 1 })
      .toArray(),
  ]);

  const rows = [
    ...scheduledJobs.map((j) => ({
      type: 'scheduled',
      date: (j.completedAt || j.scheduledAt)?.toISOString()?.slice(0, 10) ?? '',
      time: (j.completedAt || j.scheduledAt)?.toISOString()?.slice(11, 16) ?? '',
      platforms: (j.destinations || []).map((d) => d.platform).join(' | '),
      status: j.status === 'completed' ? 'published' : 'failed',
      content: j.content || '',
    })),
    ...immediatePosts.map((p) => ({
      type: 'immediate',
      date: p.publishedAt?.toISOString()?.slice(0, 10) ?? '',
      time: p.publishedAt?.toISOString()?.slice(11, 16) ?? '',
      platforms: (p.destinations || []).map((d) => d.platform).join(' | '),
      status: p.status,
      content: p.content || '',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['Date', 'Time (UTC)', 'Type', 'Platforms', 'Status', 'Content'];
  const lines  = [
    header.join(','),
    ...rows.map((r) => [r.date, r.time, r.type, r.platforms, r.status, escape(r.content)].join(',')),
  ];

  const filename = `posts-${month || 'all'}.csv`;
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  return reply.send('﻿' + lines.join('\r\n'));
});

// ─── Brand / Account Audit ────────────────────────────────────────────────────

app.post('/analytics/audit', async (request, reply) => {
  const ws = request.workspaceId;
  const filter = parseAccountFilter(request.query.account);
  const db = await getDb();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);

  const recentPosts = await db.collection('posts').find({
    workspaceId: ws,
    publishedAt: { $gte: thirtyDaysAgo },
    ...ipFilter(filter),
  }, { projection: { content: 1, destinations: 1, publishedAt: 1, status: 1 } }).toArray();

  if (recentPosts.length < 3) {
    return reply.code(400).send({ error: 'Not enough publishing history. Publish at least 3 posts first.' });
  }

  // Posting frequency
  const postsLast30 = recentPosts.length;
  const postsLast7  = recentPosts.filter((p) => new Date(p.publishedAt) >= sevenDaysAgo).length;
  const postsPerWeek = Math.round((postsLast30 / 4) * 10) / 10;

  // Platforms used
  const platforms = [...new Set(recentPosts.flatMap((p) => (p.destinations || []).map((d) => d.platform)).filter(Boolean))];

  // Success rate
  const publishedCount = recentPosts.filter((p) => p.status === 'published').length;
  const successRate    = Math.round((publishedCount / postsLast30) * 100);

  // Top hashtags from post content
  const hashtagCounts = {};
  for (const post of recentPosts) {
    const re = /#([a-zA-Z]\w*)/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(post.content || '')) !== null) {
      const tag = `#${m[1].toLowerCase()}`;
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    }
  }
  const topHashtags = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => `${tag} (${count}x)`)
    .join(', ');

  // Posting hour distribution — identify peak hours
  const hourCounts = {};
  for (const post of recentPosts) {
    if (post.publishedAt) {
      const h = new Date(post.publishedAt).getUTCHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
  }
  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => `${h}:00 UTC`)
    .join(', ');

  // Engagement data from post_metrics
  const metricsFilter = filter
    ? { workspaceId: ws, platform: filter.platform, ...(filter.accountId && { accountId: filter.accountId }) }
    : { workspaceId: ws };
  const metrics = await db.collection('post_metrics')
    .find({ ...metricsFilter, createdAt: { $gte: thirtyDaysAgo } })
    .toArray();

  const avgEngagement = metrics.length > 0
    ? Math.round((metrics.reduce((s, m) => s + (m.metrics?.engagementTotal || 0), 0) / metrics.length) * 10) / 10
    : 0;

  const statsBlock = [
    `Publishing stats (last 30 days):`,
    `- Total posts: ${postsLast30}`,
    `- Posts this week: ${postsLast7}`,
    `- Posts per week (avg): ${postsPerWeek}`,
    `- Platforms used: ${platforms.join(', ') || 'unknown'}`,
    `- Success rate: ${successRate}%`,
    `- Average engagement per post: ${avgEngagement}`,
    `- Current peak posting hours (UTC): ${peakHours || 'not enough data'}`,
    `- Top hashtags in use: ${topHashtags || 'none detected'}`,
  ].join('\n');

  const system = 'You are a social media performance analyst. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Audit this social media account and return a structured report.

${statsBlock}

Return a JSON object with exactly these fields:
{
  "score": <overall health score 0-100>,
  "summary": "<2-3 sentence assessment>",
  "postingFrequency": { "score": <0-10>, "assessment": "<one sentence>" },
  "engagement": { "score": <0-10>, "benchmark": "<Excellent|Good|Average|Below Average>", "assessment": "<one sentence>" },
  "contentMix": { "score": <0-10>, "assessment": "<one sentence on variety and platform fit>" },
  "recommendations": ["<specific action 1>", "<specific action 2>", "<specific action 3>"]
}

Scoring benchmarks: posting 5+x/week = 8-10, 3-4x = 6-7, 1-2x = 4-5, less = 1-3.
Engagement benchmarks: >5 avg = Excellent, 3-5 = Good, 1-3 = Average, <1 = Below Average.
Return ONLY the JSON object.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let audit = null;
    try {
      const jsonStr = (text.match(/\{[\s\S]*\}/) || ['{}'])[0];
      audit = JSON.parse(jsonStr);
      if (typeof audit.score !== 'number') throw new Error();
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid audit format — try again' });
    }

    log.info({ action: 'analytics_audit', account: request.query.account || 'all', outcome: 'success' });
    return {
      success: true,
      ...audit,
      stats: { postsLast30, postsLast7, postsPerWeek, platforms, successRate, avgEngagement },
      generatedAt: new Date(),
    };
  } catch (err) {
    return reply.code(503).send({ error: 'Audit failed', detail: err.message });
  }
});

// ─── Hashtag Groups ───────────────────────────────────────────────────────────

app.get('/hashtag-groups', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const groups = await db.collection('hashtag_groups').find({ workspaceId: ws }).sort({ name: 1 }).toArray();
  return { groups };
});

app.post('/hashtag-groups', async (request, reply) => {
  const ws = request.workspaceId;
  const { name, hashtags } = request.body || {};
  if (!name?.trim()) return reply.code(400).send({ error: 'name is required' });
  const tags = (hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`).toLowerCase()).filter(Boolean);
  const db = await getDb();
  const result = await db.collection('hashtag_groups').insertOne({
    workspaceId: ws,
    name: name.trim(),
    hashtags: [...new Set(tags)],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { success: true, _id: result.insertedId };
});

app.put('/hashtag-groups/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const { id } = request.params;
  const { name, hashtags } = request.body || {};
  const update = { updatedAt: new Date() };
  if (name?.trim()) update.name = name.trim();
  if (hashtags) {
    const tags = hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`).toLowerCase()).filter(Boolean);
    update.hashtags = [...new Set(tags)];
  }
  const db = await getDb();
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid id' }); }
  await db.collection('hashtag_groups').updateOne({ _id: oid, workspaceId: ws }, { $set: update });
  return { success: true };
});

app.delete('/hashtag-groups/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const { id } = request.params;
  const db = await getDb();
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid id' }); }
  await db.collection('hashtag_groups').deleteOne({ _id: oid, workspaceId: ws });
  return { success: true };
});

// ─── Hashtag Stats & Scraper ──────────────────────────────────────────────────

const HASHTAG_RE = /#([a-zA-Z]\w*)/g;

function extractHashtags(text) {
  if (!text) return [];
  const tags = [];
  let m;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(text)) !== null) tags.push(`#${m[1].toLowerCase()}`);
  return tags;
}

function gradeHashtag(count, avgEngagement) {
  if (count >= 5 && avgEngagement >= 10) return 'A';
  if (count >= 3 && avgEngagement >= 3)  return 'B';
  if (count >= 2)                         return 'C';
  return 'D';
}

// POST /hashtags/scrape — scan YOUR published posts per-account.
// Body: { accountKey?: string }  — omit to scan all accounts at once.
app.post('/hashtags/scrape', async (request) => {
  const ws = request.workspaceId;
  const { accountKey: filterAccount } = request.body || {};
  const db = await getDb();

  // tagMap key: `${accountKey}||${hashtag}`
  const tagMap = {};

  function touch(tag, accountKey, platform, engagement) {
    const key = `${accountKey}||${tag}`;
    if (!tagMap[key]) tagMap[key] = { tag, accountKey, count: 0, totalEngagement: 0, platforms: new Set() };
    tagMap[key].count++;
    tagMap[key].totalEngagement += engagement;
    tagMap[key].platforms.add(platform);
  }

  // Engagement lookup keyed by content fingerprint
  const postMetrics = await db.collection('post_metrics').find({ workspaceId: ws }).toArray();
  const metricsByContent = {};
  for (const m of postMetrics) {
    if (m.content) {
      const key = m.content.slice(0, 100).toLowerCase().trim();
      metricsByContent[key] = (metricsByContent[key] || 0) + (m.metrics?.engagementTotal || 0);
    }
  }

  // Scan YOUR published posts only — feeds are others' content, not your performance
  const posts = await db.collection('posts').find({ workspaceId: ws }, { projection: { content: 1, destinations: 1 } }).toArray();

  for (const post of posts) {
    const tags = extractHashtags(post.content || '');
    if (!tags.length) continue;
    const engagement = post.content
      ? (metricsByContent[post.content.slice(0, 100).toLowerCase().trim()] || 0)
      : 0;
    const destinations = post.destinations?.length ? post.destinations : [{ platform: 'unknown' }];

    for (const dest of destinations) {
      const acctKey = dest.accountId ? `${dest.platform}:${dest.accountId}` : dest.platform;
      if (filterAccount && acctKey !== filterAccount) continue;
      for (const tag of tags) {
        touch(tag, acctKey, dest.platform, engagement / Math.max(tags.length, 1));
      }
    }
  }

  let scraped = 0;
  for (const [compoundKey, data] of Object.entries(tagMap)) {
    const avgEngagement = data.count > 0 ? data.totalEngagement / data.count : 0;
    await db.collection('hashtag_stats').updateOne(
      { _id: compoundKey, workspaceId: ws },
      {
        $set: {
          workspaceId: ws,
          hashtag: data.tag,
          accountKey: data.accountKey,
          count: data.count,
          avgEngagement: Math.round(avgEngagement * 10) / 10,
          grade: gradeHashtag(data.count, avgEngagement),
          platforms: [...data.platforms],
          lastScraped: new Date(),
        },
      },
      { upsert: true }
    );
    scraped++;
  }

  log.info({ action: 'hashtag_scrape', accountKey: filterAccount || 'all', outcome: 'success', scraped });
  return { success: true, scraped };
});

app.get('/hashtags/stats', async (request) => {
  const ws = request.workspaceId;
  const { sort, accountKey } = request.query;
  const db = await getDb();
  const sortField = sort === 'engagement' ? 'avgEngagement' : 'count';

  if (accountKey) {
    // Per-account view
    const stats = await db.collection('hashtag_stats')
      .find({ workspaceId: ws, accountKey })
      .sort({ [sortField]: -1 })
      .limit(200)
      .toArray();
    return { stats };
  }

  // Aggregate view: group by hashtag across all accounts in this workspace
  const allStats = await db.collection('hashtag_stats').find({ workspaceId: ws, accountKey: { $exists: true } }).toArray();
  const grouped = new Map();
  for (const s of allStats) {
    if (!s.hashtag) continue;
    if (!grouped.has(s.hashtag)) {
      grouped.set(s.hashtag, { count: 0, totalEngagement: 0, totalCount: 0, platforms: new Set(), lastScraped: null });
    }
    const g = grouped.get(s.hashtag);
    g.count += s.count;
    g.totalEngagement += s.avgEngagement * s.count;
    g.totalCount += s.count;
    for (const p of (s.platforms || [])) g.platforms.add(p);
    if (!g.lastScraped || (s.lastScraped && new Date(s.lastScraped) > new Date(g.lastScraped))) g.lastScraped = s.lastScraped;
  }

  const stats = [...grouped.entries()]
    .map(([tag, g]) => {
      const avgEngagement = g.totalCount > 0 ? Math.round((g.totalEngagement / g.totalCount) * 10) / 10 : 0;
      return {
        _id: tag,
        hashtag: tag,
        accountKey: null,
        count: g.count,
        avgEngagement,
        grade: gradeHashtag(g.count, avgEngagement),
        platforms: [...g.platforms],
        lastScraped: g.lastScraped,
      };
    })
    .sort((a, b) => b[sortField] - a[sortField])
    .slice(0, 200);

  return { stats };
});

app.post('/hashtags/ai-suggest', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey, topTags = [], count = 20 } = request.body || {};

  let profileCtx = '';
  if (accountKey) {
    try {
      const db = await getDb();
      const profile = await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
      if (profile) {
        const parts = [];
        if (profile.businessName)   parts.push(`Business: ${profile.businessName}`);
        if (profile.description)    parts.push(`Description: ${profile.description}`);
        if (profile.industry)       parts.push(`Industry: ${profile.industry}`);
        if (profile.targetAudience) parts.push(`Target audience: ${profile.targetAudience}`);
        if (profile.keywords)       parts.push(`Existing keywords: ${profile.keywords}`);
        if (profile.hashtags)       parts.push(`Current hashtags: ${profile.hashtags}`);
        profileCtx = parts.join('\n');
      }
    } catch (_) {}
  }

  const topTagList = topTags.slice(0, 15).map((t) => t._id || t).join(', ');

  const system = 'You are a social media hashtag strategist. Return ONLY hashtags, space-separated, no explanations.';
  const prompt = [
    `Suggest ${count} high-performing hashtags for a social media account.`,
    profileCtx ? `\nACCOUNT CONTEXT:\n${profileCtx}` : '',
    topTagList ? `\nCURRENT TOP HASHTAGS (by usage):\n${topTagList}` : '',
    `\nReturn exactly ${count} unique hashtags as a space-separated list. Mix popular and niche tags. Include a variety of sizes (broad, medium, niche). Example: #photography #naturephotography #landscapephoto`,
  ].filter(Boolean).join('');

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 60000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 60000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 60000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const tags = [...new Set((text.match(/#[a-zA-Z]\w*/g) || []).map((t) => t.toLowerCase()))].slice(0, count);
    return { success: true, hashtags: tags };
  } catch (err) {
    return reply.code(503).send({ error: 'AI suggestion failed', detail: err.message });
  }
});

// ─── Competitor Intelligence ──────────────────────────────────────────────────

async function extractTextFromUrl(url) {
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialManager/1.0)' } });
    const html = res.data || '';
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    const headings = [...html.matchAll(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 8);
    const paras = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter((t) => t.length > 40).slice(0, 5);
    return [title, desc, ...headings, ...paras].filter(Boolean).join('\n').slice(0, 3000);
  } catch {
    return '';
  }
}

async function scrapeBluesky(profileUrl) {
  try {
    const handle = profileUrl.replace(/^https?:\/\/bsky\.app\/profile\//i, '').replace(/\/$/, '');
    if (!handle) return '';
    const res = await axios.get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=10`, { timeout: 10000 });
    const posts = (res.data.feed || []).map((f) => f.post?.record?.text || '').filter(Boolean);
    return posts.join('\n').slice(0, 3000);
  } catch {
    return '';
  }
}

async function scrapeMastodon(profileUrl) {
  try {
    const m = profileUrl.match(/^https?:\/\/([^/]+)\/@(.+)$/);
    if (!m) return '';
    const [, instance, username] = m;
    const lookupRes = await axios.get(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`, { timeout: 10000 });
    const accountId = lookupRes.data?.id;
    if (!accountId) return '';
    const statusRes = await axios.get(`https://${instance}/api/v1/accounts/${accountId}/statuses?limit=10&exclude_replies=true`, { timeout: 10000 });
    const posts = (statusRes.data || []).map((s) => s.content?.replace(/<[^>]+>/g, '').trim() || '').filter(Boolean);
    return posts.join('\n').slice(0, 3000);
  } catch {
    return '';
  }
}

async function runCompetitorScrape(competitorId) {
  const db = await getDb();
  const competitor = await db.collection('competitors').findOne({ _id: new ObjectId(competitorId) });
  if (!competitor) return { ok: false, message: 'Not found', sources: 0 };

  const newItems = [];

  if (competitor.websiteUrl) {
    const text = await extractTextFromUrl(competitor.websiteUrl);
    if (text) newItems.push({ source: 'website', url: competitor.websiteUrl, text, scrapedAt: new Date() });
  }

  const socialEntries = Object.entries(competitor.socialUrls || {});
  for (const [platform, url] of socialEntries) {
    if (!url) continue;
    let text = '';
    if (platform === 'bluesky') text = await scrapeBluesky(url);
    else if (platform === 'mastodon') text = await scrapeMastodon(url);
    else text = await extractTextFromUrl(url);
    if (text) newItems.push({ source: platform, url, text, scrapedAt: new Date() });
  }

  const existing = competitor.scrapedContent || [];

  // Detect whether any newly scraped content differs from what was previously stored
  const existingFingerprints = new Set(existing.map((s) => s.url + '||' + s.text.slice(0, 200)));
  const contentChanged = newItems.some((item) => !existingFingerprints.has(item.url + '||' + item.text.slice(0, 200)));

  const combined = [...newItems, ...existing].slice(0, 20);

  await db.collection('competitors').updateOne(
    { _id: new ObjectId(competitorId) },
    { $set: { scrapedContent: combined, contentChanged, lastScraped: new Date(), updatedAt: new Date() } },
  );

  return { ok: true, sources: newItems.length, message: newItems.length ? `Scraped ${newItems.length} source(s)` : 'No content found' };
}

async function buildCompetitorSystemSuffix(ws = 'default') {
  try {
    const db = await getDb();
    const competitors = await db.collection('competitors').find({
      workspaceId: ws,
      $or: [{ 'aiAnalysis.positioning': { $nin: ['', null] } }, { aiSummary: { $nin: ['', null] } }],
    }).toArray();
    if (!competitors.length) return '';
    const lines = competitors.map((c) => {
      if (c.aiAnalysis?.positioning) {
        const a = c.aiAnalysis;
        const parts = [`- ${c.name}:`];
        if (a.positioning) parts.push(`  Positioning: ${a.positioning}`);
        if (a.gaps?.length) parts.push(`  Weaknesses/gaps: ${a.gaps.join('; ')}`);
        if (a.themes?.length) parts.push(`  Key themes: ${a.themes.join(', ')}`);
        return parts.join('\n');
      }
      return `- ${c.name}: ${c.aiSummary}`;
    }).join('\n');
    return `\n\nCOMPETITOR CONTEXT (for differentiation — do not copy, use to contrast):\n${lines}\nEmphasise what makes this brand unique compared to the above.`;
  } catch {
    return '';
  }
}

// Save Google Places API key (used for local competitor discovery)
app.post('/credentials/google-places', async (request, reply) => {
  const ws = request.workspaceId;
  const { apiKey } = request.body || {};
  if (!apiKey?.trim()) return reply.code(400).send({ error: 'apiKey is required' });
  await setCredentials(ws, 'google_places', { apiKey: apiKey.trim() });
  return { success: true };
});

app.get('/credentials/google-places', async (request) => {
  const ws = request.workspaceId;
  const cred = await getCredentials(ws, 'google_places');
  return { configured: !!cred?.apiKey, keyHint: cred?.apiKey ? `****${cred.apiKey.slice(-4)}` : null };
});

app.delete('/credentials/google-places', async (request) => {
  const ws = request.workspaceId;
  await deleteCredentials(ws, 'google_places');
  return { success: true };
});

// Discover local competitors via Google Places API
app.post('/competitors/discover-local', async (request, reply) => {
  const ws = request.workspaceId;
  const { location, businessType, radiusMeters = 5000 } = request.body || {};
  if (!location) return reply.code(400).send({ error: 'location is required' });

  const cred = await getCredentials(ws, 'google_places');
  if (!cred?.apiKey) return reply.code(400).send({ error: 'Google Places API key not configured — add it in Settings.' });

  // Step 1: Geocode the location string to coordinates
  let lat, lng;
  try {
    const geoRes = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: location, key: cred.apiKey },
      timeout: 10000,
    });
    const loc = geoRes.data.results?.[0]?.geometry?.location;
    if (!loc) return reply.code(400).send({ error: `Could not geocode location: "${location}"` });
    lat = loc.lat;
    lng = loc.lng;
  } catch (err) {
    return reply.code(503).send({ error: 'Geocoding failed', detail: err.message });
  }

  // Step 2: Text Search for nearby businesses of the given type
  try {
    const query = businessType ? `${businessType} near ${location}` : location;
    const searchRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: {
        query,
        location: `${lat},${lng}`,
        radius: Math.min(radiusMeters, 50000),
        key: cred.apiKey,
      },
      timeout: 10000,
    });

    const places = (searchRes.data.results || []).slice(0, 10);
    if (!places.length) return { success: true, suggestions: [] };

    // Step 3: Fetch website URLs for places that have them
    const suggestions = [];
    for (const place of places.slice(0, 8)) {
      try {
        const detailRes = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
          params: { place_id: place.place_id, fields: 'name,website,formatted_address,rating', key: cred.apiKey },
          timeout: 8000,
        });
        const detail = detailRes.data.result || {};
        suggestions.push({
          name: detail.name || place.name,
          websiteUrl: detail.website || null,
          address: detail.formatted_address || '',
          rating: detail.rating || null,
          reason: `Local ${businessType || 'business'} near ${location}${detail.rating ? ` · ${detail.rating}★` : ''}`,
        });
      } catch {
        suggestions.push({ name: place.name, websiteUrl: null, address: '', rating: null, reason: `Local ${businessType || 'business'} near ${location}` });
      }
    }

    log.info({ action: 'discover_local_competitors', location, count: suggestions.length, outcome: 'success' });
    return { success: true, suggestions };
  } catch (err) {
    return reply.code(503).send({ error: 'Google Places search failed', detail: err.message });
  }
});

// Discover competitors automatically using AI + account profile context
app.post('/competitors/discover', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();

  // Use the first account profile for business context
  const profile = await db.collection('account_profiles').findOne({ workspaceId: ws });
  const contextParts = [];
  if (profile) {
    if (profile.businessName)   contextParts.push(`Business: ${profile.businessName}`);
    if (profile.description)    contextParts.push(`Description: ${profile.description}`);
    if (profile.industry)       contextParts.push(`Industry: ${profile.industry}`);
    if (profile.websiteUrl)     contextParts.push(`Website: ${profile.websiteUrl}`);
    if (profile.targetAudience) contextParts.push(`Target audience: ${profile.targetAudience}`);
  }

  if (!contextParts.length) {
    return reply.code(400).send({ error: 'Set up at least one Account Profile in Settings before discovering competitors.' });
  }

  const system = 'You are a market research analyst. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Based on the following business profile, identify the top 5 direct competitors.

${contextParts.join('\n')}

Return ONLY a JSON array of objects, e.g.:
[{"name":"Competitor Name","websiteUrl":"https://example.com","reason":"One sentence on why they compete directly"}]

Rules:
- Return real, existing businesses only.
- Include only direct competitors (same product/service category, same target audience).
- websiteUrl must be a valid https URL to the competitor's main website.
- No explanation outside the JSON array.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let suggestions = [];
    try {
      const jsonStr = (text.match(/\[[\s\S]*\]/) || ['[]'])[0];
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error();
      suggestions = parsed
        .filter((s) => s && typeof s.name === 'string' && typeof s.websiteUrl === 'string')
        .slice(0, 5)
        .map((s) => ({
          name: s.name.trim(),
          websiteUrl: s.websiteUrl.trim(),
          reason: typeof s.reason === 'string' ? s.reason.trim() : '',
        }));
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid format — try again' });
    }

    log.info({ action: 'competitor_discover', count: suggestions.length, outcome: 'success' });
    return { success: true, suggestions };
  } catch (err) {
    return reply.code(503).send({ error: 'Discovery failed', detail: err.message });
  }
});

// List competitors
app.get('/competitors', async (request) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const list = await db.collection('competitors').find({ workspaceId: ws }).sort({ createdAt: 1 }).toArray();
  return list;
});

// Add competitor (max 5 per workspace)
app.post('/competitors', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const count = await db.collection('competitors').countDocuments({ workspaceId: ws });
  if (count >= 5) return reply.code(400).send({ error: 'Maximum 5 competitors allowed' });
  const { name, websiteUrl, socialUrls = {} } = request.body || {};
  if (!name || !websiteUrl) return reply.code(400).send({ error: 'name and websiteUrl are required' });
  const now = new Date();
  const result = await db.collection('competitors').insertOne({
    workspaceId: ws, name, websiteUrl, socialUrls, scrapedContent: [], aiSummary: '', keywords: [], lastScraped: null, createdAt: now, updatedAt: now,
  });
  const doc = await db.collection('competitors').findOne({ _id: result.insertedId });
  return doc;
});

// Update competitor
app.put('/competitors/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const { name, websiteUrl, socialUrls } = request.body || {};
  const updates = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (websiteUrl !== undefined) updates.websiteUrl = websiteUrl;
  if (socialUrls !== undefined) updates.socialUrls = socialUrls;
  const oid = new ObjectId(request.params.id);
  await db.collection('competitors').updateOne({ _id: oid, workspaceId: ws }, { $set: updates });
  const doc = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  return doc;
});

// Delete competitor
app.delete('/competitors/:id', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  await db.collection('competitors').deleteOne({ _id: new ObjectId(request.params.id), workspaceId: ws });
  return { success: true };
});

// Scrape one competitor — returns jobId immediately, runs in background
app.post('/competitors/:id/scrape', async (request, reply) => {
  const jobId = new ObjectId().toString();
  activeScrapeJobs.set(jobId, { status: 'running', sources: 0, message: '' });

  (async () => {
    try {
      const result = await runCompetitorScrape(request.params.id);
      activeScrapeJobs.set(jobId, {
        status: result.ok ? 'done' : 'failed',
        sources: result.sources,
        message: result.message,
      });
    } catch (err) {
      activeScrapeJobs.set(jobId, { status: 'failed', sources: 0, message: err.message });
    }
  })();

  return reply.code(202).send({ jobId });
});

// Poll scrape job status
app.get('/competitors/:id/scrape-status/:jobId', async (request, reply) => {
  const job = activeScrapeJobs.get(request.params.jobId);
  if (!job) return reply.code(404).send({ error: 'Job not found or expired' });
  return job;
});

// Scrape all competitors (called by scheduler — always operates on default workspace)
app.post('/competitors/scrape-all', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const all = await db.collection('competitors').find({ workspaceId: ws }).toArray();
  const results = [];
  for (const c of all) {
    const r = await runCompetitorScrape(c._id.toString());
    results.push({ id: c._id.toString(), name: c.name, ...r });
  }
  return { success: true, results };
});

// Summarize competitor content with AI — returns structured analysis
app.post('/competitors/:id/summarize', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const oid = new ObjectId(request.params.id);
  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });

  const content = (competitor.scrapedContent || []).map((s) => `[${s.source}] ${s.text}`).join('\n\n').slice(0, 6000);
  if (!content) return reply.code(400).send({ error: 'No scraped content to summarize' });

  const system = 'You are a competitive intelligence analyst. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Analyse the following content from "${competitor.name}" and return a JSON object with exactly these fields:
{
  "themes": ["3-5 main content topics or pillars they focus on"],
  "tone": "one sentence describing their voice and communication style",
  "positioning": "one sentence on how they position themselves in the market",
  "gaps": ["2-3 topics or angles they ignore or handle poorly — opportunities for you"],
  "moves": ["3 specific content angles you could use to stand out against them"],
  "profile": {
    "pricing": "one sentence on their pricing model or tier (e.g. 'Freemium with $49/mo Pro plan', 'Premium only, starts at $99/mo', or 'Pricing not visible' if unclear)",
    "keyFeatures": ["3-5 core product or service features they emphasise"],
    "marketingChannels": ["2-4 social/marketing channels they actively use based on content"],
    "targetCustomer": "one sentence describing their apparent ideal customer"
  },
  "prediction": {
    "satisfiedWithPosition": <true if they appear content with their current position, false if they seem to be pushing for growth>,
    "likelyNextMoves": ["2-3 strategic moves they will probably make based on current trajectory"],
    "vulnerabilities": ["2-3 specific weaknesses or blind spots visible in their content"],
    "retaliationTriggers": ["1-2 moves by a competitor that would most likely provoke a strong response from them"]
  }
}

Content:
${content}

Return ONLY the JSON object. No explanation, no markdown.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 180000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 180000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 180000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let aiAnalysis = null;
    try {
      const jsonStr = (text.match(/\{[\s\S]*\}/) || ['{}'])[0];
      aiAnalysis = JSON.parse(jsonStr);
      if (!Array.isArray(aiAnalysis.themes)) aiAnalysis.themes = [];
      if (typeof aiAnalysis.tone !== 'string') aiAnalysis.tone = '';
      if (typeof aiAnalysis.positioning !== 'string') aiAnalysis.positioning = '';
      if (!Array.isArray(aiAnalysis.gaps)) aiAnalysis.gaps = [];
      if (!Array.isArray(aiAnalysis.moves)) aiAnalysis.moves = [];
      // Validate profile block
      if (!aiAnalysis.profile || typeof aiAnalysis.profile !== 'object') aiAnalysis.profile = {};
      if (typeof aiAnalysis.profile.pricing !== 'string') aiAnalysis.profile.pricing = '';
      if (!Array.isArray(aiAnalysis.profile.keyFeatures)) aiAnalysis.profile.keyFeatures = [];
      if (!Array.isArray(aiAnalysis.profile.marketingChannels)) aiAnalysis.profile.marketingChannels = [];
      if (typeof aiAnalysis.profile.targetCustomer !== 'string') aiAnalysis.profile.targetCustomer = '';
      // Validate prediction block
      if (!aiAnalysis.prediction || typeof aiAnalysis.prediction !== 'object') aiAnalysis.prediction = {};
      if (typeof aiAnalysis.prediction.satisfiedWithPosition !== 'boolean') aiAnalysis.prediction.satisfiedWithPosition = true;
      if (!Array.isArray(aiAnalysis.prediction.likelyNextMoves)) aiAnalysis.prediction.likelyNextMoves = [];
      if (!Array.isArray(aiAnalysis.prediction.vulnerabilities)) aiAnalysis.prediction.vulnerabilities = [];
      if (!Array.isArray(aiAnalysis.prediction.retaliationTriggers)) aiAnalysis.prediction.retaliationTriggers = [];
    } catch {
      aiAnalysis = null;
    }
    if (!aiAnalysis) return reply.code(503).send({ error: 'AI returned invalid analysis format — try again' });

    await db.collection('competitors').updateOne(
      { _id: oid, workspaceId: ws },
      { $set: { aiAnalysis, aiSummary: '', updatedAt: new Date() } },
    );
    return { success: true, aiAnalysis };
  } catch (err) {
    return reply.code(503).send({ error: 'Summarization failed', detail: err.message });
  }
});

// Extract keywords from scraped content using AI (item 34)
app.post('/competitors/:id/extract-keywords', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const oid = new ObjectId(request.params.id);
  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });

  const content = (competitor.scrapedContent || []).map((s) => s.text).join('\n\n').slice(0, 6000);
  if (!content) return reply.code(400).send({ error: 'No scraped content to extract keywords from' });

  const system = 'You are an SEO and content strategist. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Analyse the following content from "${competitor.name}" and extract the top 20 keywords and key phrases they appear to be targeting. For each keyword, classify its search intent using one of these four types:
- informational: user wants to learn ("how to", "what is", "guide", "tips")
- commercial: user is evaluating options ("best", "vs", "review", "top", "alternative")
- transactional: user is ready to act ("buy", "free", "pricing", "download", "get started")
- navigational: user is searching for a specific brand or tool by name

Content:
${content}

Return ONLY a JSON array, e.g.:
[{"term": "project management software", "intent": "commercial"}, {"term": "how to manage tasks", "intent": "informational"}]
No explanation, no markdown.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const VALID_INTENTS = new Set(['informational', 'commercial', 'transactional', 'navigational']);
    let keywords = [];
    try {
      const jsonStr = (text.match(/\[[\s\S]*\]/) || ['[]'])[0];
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error();
      const now = new Date();
      keywords = parsed
        .filter((k) => k && typeof k.term === 'string' && k.term.trim())
        .slice(0, 20)
        .map((k) => ({
          term: k.term.trim(),
          intent: VALID_INTENTS.has(k.intent) ? k.intent : 'informational',
          extractedAt: now,
        }));
    } catch {
      keywords = [];
    }

    await db.collection('competitors').updateOne(
      { _id: oid, workspaceId: ws },
      { $set: { keywords, updatedAt: new Date() } },
    );
    return { success: true, keywords };
  } catch (err) {
    return reply.code(503).send({ error: 'Keyword extraction failed', detail: err.message });
  }
});

// Analyse content gaps — compare competitor keywords against user's hashtag_stats
app.post('/competitors/:id/analyze-gaps', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const oid = new ObjectId(request.params.id);
  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });

  const keywords = (competitor.keywords || []);
  if (!keywords.length) return reply.code(400).send({ error: 'Extract keywords first before analysing gaps' });

  const hashtagDocs = await db.collection('hashtag_stats')
    .find({ workspaceId: ws, accountKey: { $exists: true } }, { projection: { _id: 0, hashtag: 1 } })
    .toArray();
  const hashtagStatsEmpty = hashtagDocs.length === 0;

  // Deduplicate across accounts — same hashtag used by any account counts as covered
  const uniqueTags = [...new Set(hashtagDocs.map((h) => h.hashtag).filter(Boolean))];
  const hashtagTexts = uniqueTags.map((tag) => ({ id: tag, text: tag.replace(/^#/, '').toLowerCase() }));

  const INTENT_ORDER = { transactional: 0, commercial: 1, informational: 2, navigational: 3 };

  function findMatchingHashtags(term) {
    const words = term.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    return hashtagTexts
      .filter(({ text }) => words.some((w) => text.includes(w)))
      .map(({ id }) => id);
  }

  const gaps = [];
  const covered = [];

  for (const kw of keywords) {
    const term = typeof kw === 'string' ? kw : kw.term;
    const intent = typeof kw === 'string' ? 'informational' : (kw.intent || 'informational');
    const matched = findMatchingHashtags(term);
    if (matched.length) {
      covered.push({ term, intent, matchedHashtags: matched.slice(0, 4) });
    } else {
      gaps.push({ term, intent });
    }
  }

  gaps.sort((a, b) => (INTENT_ORDER[a.intent] ?? 99) - (INTENT_ORDER[b.intent] ?? 99));

  const gapAnalysis = { gaps, covered, totalKeywords: keywords.length, hashtagStatsEmpty, lastAnalyzed: new Date() };

  await db.collection('competitors').updateOne(
    { _id: oid, workspaceId: ws },
    { $set: { gapAnalysis, updatedAt: new Date() } },
  );
  return { success: true, ...gapAnalysis };
});

// Detect and classify market signals from latest scraped content
app.post('/competitors/:id/detect-signals', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const oid = new ObjectId(request.params.id);
  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });

  const recentContent = (competitor.scrapedContent || []).slice(0, 10);
  if (!recentContent.length) return reply.code(400).send({ error: 'Scrape first before detecting signals' });

  const contentText = recentContent.map((s) => `[${s.source}] ${s.text}`).join('\n\n').slice(0, 4000);
  const baseline = competitor.aiAnalysis
    ? `Previous profile — Themes: ${(competitor.aiAnalysis.themes || []).join(', ')}. Tone: ${competitor.aiAnalysis.tone || 'unknown'}.`
    : 'No prior analysis available.';

  const system = 'You are a competitive intelligence analyst specialising in market signal detection. Return only valid JSON with no explanation, no markdown.';
  const prompt = `Analyse the latest content from competitor "${competitor.name}" and detect any notable changes or strategic signals.

Baseline context:
${baseline}

Latest scraped content:
${contentText}

Classify any changes you detect. Use these signal types:
- topic_expansion: new content themes or topics not previously seen
- tone_shift: measurable change in communication style or voice
- campaign_launch: evidence of a new marketing campaign or product promotion
- pricing_change: any mention of new pricing, offers, or discounts
- market_entry: signs of entering a new platform, audience, or geography
- competitive_aggression: direct competitor comparisons, attack marketing, or poaching language
- frequency_change: evidence of significantly more or less content activity

Return ONLY a JSON array (empty array [] if no significant signals):
[{"type":"<type>","description":"<one sentence describing the specific change>","severity":"<low|medium|high>"}]

Severity guide: high = major strategic shift, medium = notable change worth monitoring, low = minor or uncertain change.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const VALID_TYPES = new Set(['topic_expansion', 'tone_shift', 'campaign_launch', 'pricing_change', 'market_entry', 'competitive_aggression', 'frequency_change']);
    const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
    let signals = [];
    try {
      const jsonStr = (text.match(/\[[\s\S]*\]/) || ['[]'])[0];
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error();
      const now = new Date();
      signals = parsed
        .filter((s) => s && VALID_TYPES.has(s.type) && typeof s.description === 'string')
        .slice(0, 8)
        .map((s) => ({
          type: s.type,
          description: s.description.trim(),
          severity: VALID_SEVERITIES.has(s.severity) ? s.severity : 'medium',
          detectedAt: now,
        }));
    } catch {
      signals = [];
    }

    await db.collection('competitors').updateOne(
      { _id: oid, workspaceId: ws },
      { $set: { signals, contentChanged: false, updatedAt: new Date() } },
    );
    log.info({ action: 'detect_signals', competitorId: request.params.id, count: signals.length, outcome: 'success' });
    return { success: true, signals };
  } catch (err) {
    return reply.code(503).send({ error: 'Signal detection failed', detail: err.message });
  }
});

// Generate a 5-post content roadmap from competitor keywords and gaps
app.post('/competitors/:id/content-roadmap', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const oid = new ObjectId(request.params.id);
  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });

  const keywords = (competitor.keywords || []);
  const hasKeywords = keywords.length > 0;
  const hasContent = (competitor.scrapedContent || []).length > 0;
  if (!hasKeywords && !hasContent) return reply.code(400).send({ error: 'Extract keywords first before generating a roadmap' });

  const kwList = hasKeywords
    ? keywords.map((k) => (typeof k === 'string' ? k : k.term)).join(', ')
    : '';
  const gaps = competitor.aiAnalysis?.gaps || [];
  const moves = competitor.aiAnalysis?.moves || [];

  const gapsSection = gaps.length ? `\nCompetitor gaps/weaknesses:\n${gaps.map((g) => `- ${g}`).join('\n')}` : '';
  const movesSection = moves.length ? `\nSuggested differentiation angles:\n${moves.map((m) => `- ${m}`).join('\n')}` : '';
  const kwSection = kwList ? `\nCompetitor's keywords: ${kwList}` : '';

  const system = 'You are a content strategist. Return only valid JSON with no explanation, no markdown code blocks.';
  const prompt = `Create a 5-post content roadmap to compete against "${competitor.name}".
${kwSection}${gapsSection}${movesSection}

Generate 5 post ideas that exploit their weaknesses and differentiate clearly. For each post return:
- topic: short topic name, max 8 words
- headline: an engaging opening line or hook ready to use as post content (1-2 sentences)
- keywords: array of 2-3 keywords from the competitor's list to target (use exact terms where available)
- rationale: one sentence on why this post wins against ${competitor.name}

Return ONLY a JSON array:
[{"topic":"...","headline":"...","keywords":["..."],"rationale":"..."}]
No explanation, no markdown.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 180000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 180000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 180000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    let roadmap = [];
    try {
      const jsonStr = (text.match(/\[[\s\S]*\]/) || ['[]'])[0];
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error();
      roadmap = parsed
        .filter((p) => p && typeof p.topic === 'string' && typeof p.headline === 'string')
        .slice(0, 5)
        .map((p) => ({
          topic: p.topic.trim(),
          headline: p.headline.trim(),
          keywords: Array.isArray(p.keywords) ? p.keywords.filter((k) => typeof k === 'string').slice(0, 3) : [],
          rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
        }));
    } catch {
      roadmap = [];
    }
    if (!roadmap.length) return reply.code(503).send({ error: 'AI returned invalid roadmap format — try again' });

    await db.collection('competitors').updateOne(
      { _id: oid, workspaceId: ws },
      { $set: { contentRoadmap: roadmap, updatedAt: new Date() } },
    );
    return { success: true, contentRoadmap: roadmap };
  } catch (err) {
    return reply.code(503).send({ error: 'Roadmap generation failed', detail: err.message });
  }
});

// ─── Quantitative Competitor Extraction ──────────────────────────────────────

app.post('/competitors/:id/extract-quantitative', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  let oid;
  try { oid = new ObjectId(request.params.id); } catch { return reply.code(400).send({ error: 'Invalid id' }); }

  const competitor = await db.collection('competitors').findOne({ _id: oid, workspaceId: ws });
  if (!competitor) return reply.code(404).send({ error: 'Competitor not found' });
  if (!competitor.websiteUrl) return reply.code(400).send({ error: 'Competitor has no website URL' });

  const baseUrl = competitor.websiteUrl.replace(/\/$/, '');

  // Fetch additional sub-pages: /pricing, /features, /about, /careers
  const subPaths = ['/pricing', '/features', '/about', '/careers'];
  const pageTexts = await Promise.all([
    extractTextFromUrl(baseUrl),
    ...subPaths.map((p) => extractTextFromUrl(baseUrl + p)),
  ]);
  const combinedText = pageTexts.filter(Boolean).join('\n\n---\n\n').slice(0, 8000);

  if (!combinedText.trim()) {
    return reply.code(503).send({ error: 'Could not fetch any content from the competitor site' });
  }

  const system = 'You are a competitive intelligence analyst. Return only valid JSON with no markdown or explanation.';
  const prompt = `Extract quantitative competitive data from this competitor's website content.
Competitor: ${competitor.name} (${baseUrl})

Website content:
${combinedText}

Return this JSON:
{
  "pricingTiers": [{ "name": "<tier name>", "price": "<price or 'Free' or 'Contact us'>", "highlights": ["<feature>"] }],
  "keyFeatures": ["<feature 1>", "<feature 2>", "<feature 3>", "<feature 4>", "<feature 5>"],
  "techStack": ["<detected technology>"],
  "targetCustomer": "<one-sentence ICP>",
  "jobPostings": <number of open roles detected, 0 if none>,
  "growthSignals": ["<any hiring, funding, expansion, or new product signals>"],
  "productCount": <estimated number of distinct products/services, 0 if unclear>
}

If data is not available for a field, use null for numbers and [] for arrays. Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    let profile = null;
    try {
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      profile = JSON.parse(jsonStr);
      if (!profile.keyFeatures) throw new Error('Missing keyFeatures');
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid extraction format — try again' });
    }

    await db.collection('competitors').updateOne(
      { _id: oid, workspaceId: ws },
      { $set: { quantitativeProfile: profile, quantitativeExtractedAt: new Date(), updatedAt: new Date() } },
    );

    log.info({ action: 'extract_quantitative', competitor: competitor.name, outcome: 'success' });
    return { success: true, quantitativeProfile: profile, extractedAt: new Date() };
  } catch (err) {
    return reply.code(503).send({ error: 'Quantitative extraction failed', detail: err.message });
  }
});

// ─── Strategic Group Map ─────────────────────────────────────────────────────

const STRATEGIC_DIMENSIONS = [
  'Price level',
  'Product / service breadth',
  'Brand strength',
  'Technology leadership',
  'Market coverage',
  'Service quality',
  'Marketing intensity',
  'Geographic reach',
];

app.post('/competitors/strategic-map', async (request, reply) => {
  const ws = request.workspaceId;
  const { xAxis, yAxis, accountKey } = request.body || {};
  if (!xAxis || !yAxis) return reply.code(400).send({ error: 'xAxis and yAxis are required' });
  if (xAxis === yAxis) return reply.code(400).send({ error: 'xAxis and yAxis must be different dimensions' });

  const db = await getDb();
  const competitors = await db.collection('competitors')
    .find({ workspaceId: ws, aiAnalysis: { $exists: true } })
    .toArray();

  if (competitors.length < 1) {
    return reply.code(400).send({ error: 'Run "Summarise with AI" on at least one competitor first.' });
  }

  const profile = accountKey
    ? await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws })
    : await db.collection('account_profiles').findOne({ workspaceId: ws });

  const competitorBlocks = competitors.map((c) => {
    const a = c.aiAnalysis || {};
    return `${c.name}: positioning="${a.positioning || 'unknown'}", tone="${a.tone || 'unknown'}", themes=[${(a.themes || []).join(', ')}]`;
  }).join('\n');

  const yourBrand = profile
    ? `Your brand: "${profile.businessName || 'Your brand'}" — ${profile.description || ''} — ${profile.toneOfVoice || ''}`
    : 'Your brand: unknown';

  const system = 'You are a Porter strategy analyst. Return only valid JSON with no markdown or explanation.';
  const prompt = `Plot these players on a strategic group map using two dimensions: X = "${xAxis}", Y = "${yAxis}".

${yourBrand}
${competitorBlocks}

Assign each player a score 1–10 on each axis. 1 = lowest/weakest on that dimension, 10 = highest/strongest.

Return:
{
  "players": [
    { "name": "<name>", "x": <1-10>, "y": <1-10>, "isYou": <true if your brand, false otherwise>, "note": "<one phrase describing their position>" }
  ],
  "clusters": ["<describe a cluster group if 2+ players are close together>"],
  "whitespace": ["<opportunity in a part of the map with no players>", "<second opportunity>"],
  "insight": "<2-sentence strategic insight from the map>"
}

Include your brand as a player with isYou: true. Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    let result = null;
    try {
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      result = JSON.parse(jsonStr);
      if (!Array.isArray(result.players)) throw new Error('Missing players array');
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid strategic map format — try again' });
    }

    log.info({ action: 'strategic_map', xAxis, yAxis, players: result.players.length, outcome: 'success' });
    return { success: true, xAxis, yAxis, ...result, generatedAt: new Date() };
  } catch (err) {
    return reply.code(503).send({ error: 'Strategic map failed', detail: err.message });
  }
});

// ─── Competitor Social Matrix ────────────────────────────────────────────────

app.post('/competitors/social-matrix', async (request, reply) => {
  const ws = request.workspaceId;
  const db = await getDb();
  const competitors = await db.collection('competitors')
    .find({ workspaceId: ws, aiAnalysis: { $exists: true } })
    .toArray();

  if (competitors.length < 2) {
    return reply.code(400).send({ error: 'Run "Summarise with AI" on at least 2 competitors first.' });
  }

  const competitorBlocks = competitors.map((c) => {
    const a = c.aiAnalysis || {};
    return [
      `Competitor: ${c.name}`,
      `  Positioning: ${a.positioning || 'unknown'}`,
      `  Tone: ${a.tone || 'unknown'}`,
      `  Themes: ${(a.themes || []).join(', ') || 'none'}`,
      `  Weaknesses/Gaps: ${(a.gaps || []).join(', ') || 'none'}`,
      `  Top keywords: ${(c.keywords || []).slice(0, 5).map((k) => k.term).join(', ') || 'none'}`,
    ].join('\n');
  }).join('\n\n');

  const system = 'You are a competitive intelligence analyst. Write in plain text, no markdown or bullet points.';
  const prompt = `Here are ${competitors.length} competitors you are analysing:

${competitorBlocks}

Write a concise competitive landscape synthesis (3–4 sentences) that:
1. Identifies the dominant positioning gap none of them own (the white space).
2. Names the competitor with the weakest differentiation.
3. States the single highest-leverage content angle for someone competing against all of them.

Write as direct, specific analysis. No fluff.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    if (!text.trim()) return reply.code(503).send({ error: 'AI returned empty response — try again' });
    log.info({ action: 'competitor_matrix', count: competitors.length, outcome: 'success' });
    return { success: true, synthesis: text.trim(), generatedAt: new Date() };
  } catch (err) {
    return reply.code(503).send({ error: 'Matrix synthesis failed', detail: err.message });
  }
});

// ─── Porter's Five Forces Analysis ───────────────────────────────────────────

app.post('/ai/five-forces', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.body || {};
  if (!accountKey) return reply.code(400).send({ error: 'accountKey is required' });

  const db = await getDb();
  const profileId = accountKey === 'workspace' ? `${ws}:workspace` : accountKey;
  const profile = await db.collection('account_profiles').findOne({ _id: profileId })
    || await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
  if (!profile) return reply.code(404).send({ error: 'Save your workspace profile first, then run Five Forces.' });

  if (!profile.industry && !profile.businessName) {
    return reply.code(400).send({ error: 'Add at least a business name or industry to the profile first.' });
  }

  const profileBlock = [
    profile.businessName   ? `Business: ${profile.businessName}` : '',
    profile.industry       ? `Industry: ${profile.industry}` : '',
    profile.description    ? `Description: ${profile.description}` : '',
    profile.targetAudience ? `Target audience: ${profile.targetAudience}` : '',
    profile.keywords       ? `Keywords / products: ${profile.keywords}` : '',
  ].filter(Boolean).join('\n');

  // Load competitor data for richer rivalry analysis
  const competitors = await db.collection('competitors').find({ workspaceId: ws }, { projection: { name: 1, aiAnalysis: 1 } }).toArray();
  const competitorBlock = competitors.length
    ? `Known direct competitors: ${competitors.map((c) => c.name).join(', ')}.`
    : '';

  const system = 'You are a Porter strategy analyst. Return only valid JSON with no markdown or explanation.';
  const prompt = `Analyse this business using Porter\'s Five Forces framework.

${profileBlock}
${competitorBlock}

Score each force 1–10 (1 = very weak/favourable, 10 = very strong/unfavourable) and return exactly:
{
  "attractiveness": "<High|Moderate|Low> — one sentence on overall industry attractiveness",
  "overallScore": <0–100, where 100 = maximally attractive>,
  "governingForce": "<name of the single most impactful force>",
  "forces": [
    {
      "name": "Competitive Rivalry",
      "score": <1–10>,
      "assessment": "<one sentence>",
      "drivers": ["<driver 1>", "<driver 2>", "<driver 3>"]
    },
    {
      "name": "Threat of New Entrants",
      "score": <1–10>,
      "assessment": "<one sentence>",
      "drivers": ["<driver>", "<driver>", "<driver>"]
    },
    {
      "name": "Threat of Substitutes",
      "score": <1–10>,
      "assessment": "<one sentence>",
      "drivers": ["<driver>", "<driver>", "<driver>"]
    },
    {
      "name": "Supplier Power",
      "score": <1–10>,
      "assessment": "<one sentence>",
      "drivers": ["<driver>", "<driver>", "<driver>"]
    },
    {
      "name": "Buyer Power",
      "score": <1–10>,
      "assessment": "<one sentence>",
      "drivers": ["<driver>", "<driver>", "<driver>"]
    }
  ],
  "positioning": ["<strategic recommendation 1>", "<strategic recommendation 2>", "<strategic recommendation 3>"]
}

Scoring: overallScore = 100 minus the average of all five force scores × 10. Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    let result = null;
    try {
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      result = JSON.parse(jsonStr);
      if (!Array.isArray(result.forces) || result.forces.length !== 5) throw new Error('Missing forces array');
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid Five Forces format — try again' });
    }

    await db.collection('account_profiles').updateOne(
      { _id: profileId },
      { $set: { industryAnalysis: result, industryAnalyzedAt: new Date(), updatedAt: new Date() } },
    );

    log.info({ action: 'five_forces', account: accountKey, governingForce: result.governingForce, outcome: 'success' });
    return { success: true, ...result, analyzedAt: new Date() };
  } catch (err) {
    const aiBody = err.response?.data;
    const detail = aiBody ? (aiBody.error || aiBody.message || JSON.stringify(aiBody)) : err.message;
    return reply.code(503).send({ error: 'Five Forces analysis failed', detail });
  }
});

// ─── Industry Type Diagnosis ─────────────────────────────────────────────────

app.post('/ai/industry-diagnosis', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.body || {};
  if (!accountKey) return reply.code(400).send({ error: 'accountKey is required' });

  const db = await getDb();
  const profileId = accountKey === 'workspace' ? `${ws}:workspace` : accountKey;
  const profile = await db.collection('account_profiles').findOne({ _id: profileId })
    || await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
  if (!profile) return reply.code(404).send({ error: 'Save your workspace profile first, then run Industry Diagnosis.' });

  const fields = [profile.businessName, profile.description, profile.industry, profile.toneOfVoice].filter(Boolean);
  if (fields.length < 2) return reply.code(400).send({ error: 'Fill in at least a business name and description before running diagnosis.' });

  const profileBlock = [
    profile.businessName ? `Business name: ${profile.businessName}` : '',
    profile.description  ? `Description: ${profile.description}` : '',
    profile.industry     ? `Self-reported industry: ${profile.industry}` : '',
    profile.targetAudience ? `Target audience: ${profile.targetAudience}` : '',
    profile.toneOfVoice  ? `Brand tone: ${profile.toneOfVoice}` : '',
    profile.keywords     ? `Keywords: ${profile.keywords}` : '',
    profile.postingGuidelines ? `Posting guidelines: ${profile.postingGuidelines}` : '',
  ].filter(Boolean).join('\n');

  const system = 'You are a social media strategy expert. Return only valid JSON with no markdown or explanation.';
  const prompt = `Diagnose this brand's industry archetype based on the profile below and return strategic recommendations.

${profileBlock}

Industry archetypes to choose from (pick the closest fit):
B2B SaaS, B2B Services, E-commerce (Product), Retail / Local Business, Hospitality / Food & Beverage,
Personal Brand / Creator, Health & Wellness, Finance / Fintech, Education / EdTech, Non-profit,
Media / Entertainment, Real Estate, Professional Services (Law / Consulting / Accounting).

Return this exact JSON:
{
  "diagnosedType": "<archetype name>",
  "confidence": <0-100>,
  "summary": "<2-sentence explanation of why this archetype fits>",
  "characteristics": ["<trait 1>", "<trait 2>", "<trait 3>"],
  "tactics": [
    { "title": "<tactic name>", "rationale": "<why it works for this archetype>", "action": "<specific concrete action>" },
    { "title": "<tactic name>", "rationale": "<why it works>", "action": "<specific action>" },
    { "title": "<tactic name>", "rationale": "<why it works>", "action": "<specific action>" }
  ],
  "contentMix": { "educational": <pct>, "social_proof": <pct>, "promotional": <pct>, "engagement": <pct> }
}

The contentMix percentages must sum to 100.
Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    let result = null;
    try {
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      result = JSON.parse(jsonStr);
      if (!result.diagnosedType) throw new Error();
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid diagnosis format — try again' });
    }

    // Persist the diagnosis on the account profile for future use
    await db.collection('account_profiles').updateOne(
      { _id: profileId },
      { $set: { industryDiagnosis: result, industryDiagnosedAt: new Date(), updatedAt: new Date() } },
    );

    log.info({ action: 'industry_diagnosis', account: accountKey, diagnosedType: result.diagnosedType, outcome: 'success' });
    return { success: true, ...result, diagnosedAt: new Date() };
  } catch (err) {
    const aiBody = err.response?.data;
    const detail = aiBody ? (aiBody.error || aiBody.message || JSON.stringify(aiBody)) : err.message;
    return reply.code(503).send({ error: 'Industry diagnosis failed', detail });
  }
});

// ─── Social Channel Audit ────────────────────────────────────────────────────

app.post('/ai/channel-audit', async (request, reply) => {
  const ws = request.workspaceId;
  const { accountKey } = request.body || {};
  const db = await getDb();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Load profile (optional — enriches completeness & bio quality sections)
  let profile = null;
  if (accountKey) {
    profile = await db.collection('account_profiles').findOne({ _id: accountKey, workspaceId: ws });
  }

  // Load recent posts, optionally filtered by account
  const postFilter = accountKey
    ? { workspaceId: ws, publishedAt: { $gte: thirtyDaysAgo }, 'destinations.key': accountKey }
    : { workspaceId: ws, publishedAt: { $gte: thirtyDaysAgo } };
  const recentPosts = await db.collection('posts')
    .find(postFilter, { projection: { content: 1, destinations: 1, publishedAt: 1, status: 1 } })
    .toArray();

  if (recentPosts.length < 2) {
    return reply.code(400).send({ error: 'Not enough publishing history. Publish at least 2 posts first.' });
  }

  // ── Local stats computation ──────────────────────────────────────────────
  const totalPosts = recentPosts.length;

  // Format diversity: posts with imageUrl/videoUrl in any destination
  const postsWithMedia = recentPosts.filter((p) =>
    (p.destinations || []).some((d) => d.imageUrl || d.videoUrl),
  ).length;
  const mediaRatio = Math.round((postsWithMedia / totalPosts) * 100);

  // CTA detection
  const ctaWords = ['click', 'link in bio', 'shop', 'buy', 'register', 'sign up', 'subscribe', 'follow', 'comment', 'share', 'tag', 'dm'];
  const postsWithCta = recentPosts.filter((p) =>
    ctaWords.some((w) => (p.content || '').toLowerCase().includes(w)),
  ).length;
  const ctaRatio = Math.round((postsWithCta / totalPosts) * 100);

  // Hashtag stats
  const hashtagCounts = recentPosts.map((p) => ((p.content || '').match(/#\w+/g) || []).length);
  const avgHashtags = Math.round((hashtagCounts.reduce((s, c) => s + c, 0) / totalPosts) * 10) / 10;

  // Caption length
  const avgCaptionLength = Math.round(recentPosts.reduce((s, p) => s + (p.content || '').length, 0) / totalPosts);

  // Posting consistency: days between posts
  const dates = recentPosts.map((p) => new Date(p.publishedAt).getTime()).sort((a, b) => a - b);
  const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / (1000 * 60 * 60 * 24));
  const avgGap = gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length * 10) / 10 : 30;
  const maxGap = gaps.length > 0 ? Math.round(Math.max(...gaps) * 10) / 10 : 30;

  // Engagement from post_metrics
  const metricsFilter = accountKey
    ? { workspaceId: ws, accountKey }
    : { workspaceId: ws };
  const metrics = await db.collection('post_metrics')
    .find({ ...metricsFilter, createdAt: { $gte: thirtyDaysAgo } })
    .toArray();
  const avgEngagement = metrics.length > 0
    ? Math.round((metrics.reduce((s, m) => s + (m.metrics?.engagementTotal || 0), 0) / metrics.length) * 10) / 10
    : null;

  // Profile completeness score (0-100)
  let profileScore = 0;
  let profileNote = 'No profile configured for this account.';
  if (profile) {
    const fields = [profile.businessName, profile.description, profile.industry, profile.toneOfVoice, profile.targetAudience, profile.keywords, profile.websiteUrl];
    const filled = fields.filter((f) => f && (Array.isArray(f) ? f.length > 0 : String(f).trim().length > 0)).length;
    profileScore = Math.round((filled / fields.length) * 100);
    profileNote = `${filled}/${fields.length} profile fields completed. Business name: ${profile.businessName || 'missing'}, industry: ${profile.industry || 'missing'}.`;
  }

  const statsBlock = [
    `Total posts (last 30 days): ${totalPosts}`,
    `Posts with media (images/video): ${mediaRatio}%`,
    `Posts with a CTA (click, shop, follow, etc.): ${ctaRatio}%`,
    `Average hashtags per post: ${avgHashtags}`,
    `Average caption length: ${avgCaptionLength} characters`,
    `Average days between posts: ${avgGap} (max gap: ${maxGap} days)`,
    `Average engagement per post: ${avgEngagement !== null ? avgEngagement : 'no data'}`,
    `Account profile completeness: ${profileScore}% — ${profileNote}`,
    profile?.description ? `Bio/description: "${profile.description.slice(0, 200)}"` : 'No bio/description set.',
    profile?.toneOfVoice ? `Brand tone: ${profile.toneOfVoice}` : '',
  ].filter(Boolean).join('\n');

  const system = 'You are a professional social media channel auditor. Return only valid JSON with no markdown or explanation.';
  const prompt = `Audit this social media channel and return a quality score report.

${statsBlock}

Score each dimension 0-10 and return this exact JSON:
{
  "score": <overall 0-100>,
  "sections": [
    { "name": "Profile Completeness", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] },
    { "name": "Posting Consistency", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] },
    { "name": "Visual Content", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] },
    { "name": "CTA Usage", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] },
    { "name": "Hashtag Strategy", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] },
    { "name": "Engagement Quality", "score": <0-10>, "assessment": "<one sentence>", "recommendations": ["<action>", "<action>"] }
  ],
  "topActions": ["<highest-impact action 1>", "<highest-impact action 2>", "<highest-impact action 3>"]
}

Scoring benchmarks:
- Profile Completeness: 100% filled = 10, 70%+ = 7, 50%+ = 5, below = 2
- Posting Consistency: daily = 10, every 2-3 days = 7, weekly = 5, less = 2; long gaps hurt the score
- Visual Content: 80%+ posts with media = 10, 50%+ = 7, 25%+ = 4, 0% = 1
- CTA Usage: 60%+ posts with CTA = 10, 40%+ = 7, 20%+ = 4, none = 2
- Hashtag Strategy: 3-10 hashtags avg = 10, 1-2 or 11-20 = 7, 0 or 21+ = 3
- Engagement Quality: avg engagement >5 = 10, 3-5 = 7, 1-3 = 5, <1 = 2, no data = 5 (neutral)
Return ONLY valid JSON.`;

  try {
    const pconf = await getActiveProviderConfig(request.workspaceId);
    const model = pconf.model;
    let text = '';

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 120000 });
      text = res.data.response;
    } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 120000 });
      text = res.data.choices[0]?.message?.content || '';
    } else if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 120000 },
      );
      text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      return reply.code(400).send({ error: 'AI not configured' });
    }

    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
    let result = null;
    try {
      const jsonStr = (cleaned.match(/\{[\s\S]*\}/) || ['{}'])[0];
      result = JSON.parse(jsonStr);
      if (!Array.isArray(result.sections)) throw new Error();
    } catch {
      return reply.code(503).send({ error: 'AI returned invalid channel audit format — try again' });
    }

    log.info({ action: 'channel_audit', account: accountKey || 'all', outcome: 'success' });
    return { success: true, ...result, generatedAt: new Date() };
  } catch (err) {
    return reply.code(503).send({ error: 'Channel audit failed', detail: err.message });
  }
});

module.exports = app;
