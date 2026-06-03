require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');
const { decryptToken, warnIfNoKey } = require('./utils/crypto');
const { getWorkspaceCredential } = require('./utils/credentials');

const GRAPH_API = 'https://graph.facebook.com/v22.0';
// Instagram's Container API requires a publicly accessible image URL.
// If APP_BASE_URL is set to a public domain, relative /media/ paths are resolved against it.
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

function resolveInstagramMediaUrl(url) {
  if (!url) return url;
  if (url.startsWith('/')) {
    if (!APP_BASE_URL) {
      throw new Error('Instagram requires a publicly accessible image URL. Set APP_BASE_URL to your public domain (e.g. https://social.example.com) to post images from the media library.');
    }
    const full = `${APP_BASE_URL}${url}`;
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(full)) {
      throw new Error(`Instagram requires a publicly accessible image URL. The app (${APP_BASE_URL}) is not reachable from the internet. Use an external image URL or deploy to a public server.`);
    }
    return full;
  }
  // Already a full URL — warn if it looks local but still try
  if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new Error(`Instagram requires a publicly accessible image URL. "${url}" is not reachable from the internet. Use an external image URL or deploy to a public server.`);
  }
  return url;
}

// Instagram's two-step publish requires the container to reach FINISHED status before
// calling media_publish. Poll up to maxAttempts × intervalMs ms before giving up.
async function waitForContainerReady(creationId, accessToken, maxAttempts = 12, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await axios.get(`${GRAPH_API}/${creationId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
    });
    const { status_code, status } = res.data;
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR') throw new Error(`Instagram media processing failed: ${status || 'unknown error'}`);
    if (status_code === 'EXPIRED') throw new Error('Instagram media container expired before it could be published');
    // IN_PROGRESS — wait and retry
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Instagram media container did not finish processing in time (36s). Try again or use a faster-loading image URL.');
}

class InstagramService extends BasePlatformService {
  constructor() {
    super('instagram');
  }

  // Read selected Instagram Business Accounts from MongoDB.
  // Falls back to env vars for backwards compatibility.
  async _getAccounts(workspaceId = 'default') {
    try {
      const db = await getDb();
      const cred = await getWorkspaceCredential(db, 'instagram', workspaceId);
      const dbAccounts = (cred?.accounts || []).filter((a) => a.selected);
      if (dbAccounts.length > 0) {
        return dbAccounts.map((a) => ({ ...a, accessToken: decryptToken(a.accessToken) })).filter((a) => a.accessToken);
      }
    } catch (_) { /* fall through */ }

    // Env var fallback (legacy single-account mode)
    const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID } = process.env;
    if (INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      return [{ id: INSTAGRAM_BUSINESS_ACCOUNT_ID, accessToken: INSTAGRAM_ACCESS_TOKEN }];
    }

    return [];
  }

  async getStatus(workspaceId = 'default') {
    const accounts = await this._getAccounts(workspaceId);
    if (accounts.length === 0) {
      return { connected: false, platform: 'instagram', error: 'No Instagram accounts connected — use Settings to connect via Facebook OAuth' };
    }
    try {
      const first = accounts[0];
      const res = await axios.get(`${GRAPH_API}/${first.id}`, {
        params: {
          fields: 'id,name,username,profile_picture_url',
          access_token: first.accessToken,
        },
      });
      return {
        connected: true,
        platform: 'instagram',
        username: res.data.username || res.data.name,
        displayName: res.data.name,
        avatar: res.data.profile_picture_url,
        accountCount: accounts.length,
      };
    } catch (err) {
      return { connected: false, platform: 'instagram', error: err.response?.data?.error?.message || err.message };
    }
  }

  async fetchFeed({ limit = 20, workspaceId = 'default' } = {}) {
    const accounts = await this._getAccounts(workspaceId);
    if (accounts.length === 0) throw new Error('No Instagram accounts connected');

    const allItems = [];

    for (const account of accounts) {
      const res = await axios.get(`${GRAPH_API}/${account.id}/media`, {
        params: {
          fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username',
          limit: Math.min(Number(limit), 100),
          access_token: account.accessToken,
        },
      });

      const items = (res.data.data || []).map((post) =>
        this.normalizeFeedItem({
          originalId: post.id,
          author: {
            name: post.username || account.username || '',
            username: post.username || account.username || '',
            profileUrl: `https://www.instagram.com/${post.username || account.username || ''}/`,
          },
          content: post.caption || '',
          media: post.media_url
            ? [{
                url: post.media_url,
                type: (post.media_type || 'IMAGE').toLowerCase(),
                thumbnail: post.thumbnail_url || post.media_url,
              }]
            : [],
          metrics: {
            likes: post.like_count || 0,
            comments: post.comments_count || 0,
          },
          url: post.permalink,
          createdAt: post.timestamp,
        })
      );

      allItems.push(...items);
    }

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of allItems) {
        await col.updateOne(
          { platform: 'instagram', originalId: item.originalId, workspaceId },
          { $set: { ...item, workspaceId } },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'instagram', outcome: 'failure', err: err.message });
    }

    return allItems;
  }

  // Instagram requires media (image_url or video_url) — text-only posts are not supported.
  async publishPost({ content, imageUrl, videoUrl, accountId, firstComment, workspaceId = 'default' } = {}) {
    const allAccounts = await this._getAccounts(workspaceId);
    if (allAccounts.length === 0) throw new Error('No Instagram accounts connected');

    if (!imageUrl && !videoUrl) {
      throw new Error('Instagram requires imageUrl or videoUrl — text-only posts are not supported by the Graph API');
    }

    // If a specific account is requested, target only that account
    const accounts = accountId ? allAccounts.filter((a) => a.id === accountId) : allAccounts;
    if (accounts.length === 0) throw new Error(`Instagram account ${accountId} not found or not connected`);

    const results = [];
    for (const account of accounts) {
      const containerParams = {
        caption: content,
        access_token: account.accessToken,
      };
      if (videoUrl) {
        containerParams.media_type = 'REELS';
        containerParams.video_url = resolveInstagramMediaUrl(videoUrl);
      } else {
        containerParams.image_url = resolveInstagramMediaUrl(imageUrl);
      }

      const containerRes = await axios.post(
        `${GRAPH_API}/${account.id}/media`,
        null,
        { params: containerParams }
      );
      const creationId = containerRes.data.id;

      // Wait for Instagram to finish processing the media before publishing
      await waitForContainerReady(creationId, account.accessToken);

      const publishRes = await axios.post(
        `${GRAPH_API}/${account.id}/media_publish`,
        null,
        { params: { creation_id: creationId, access_token: account.accessToken } }
      );
      const postId = publishRes.data.id;

      if (firstComment?.trim()) {
        try {
          await axios.post(`${GRAPH_API}/${postId}/comments`, null, {
            params: { message: firstComment.trim(), access_token: account.accessToken },
            timeout: 10000,
          });
          this.app.log.info({ action: 'first_comment', platform: 'instagram', postId, outcome: 'success' });
        } catch (err) {
          this.app.log.warn({ action: 'first_comment', platform: 'instagram', postId, outcome: 'failure', err: err.response?.data?.error?.message || err.message });
        }
      }

      results.push({ accountId: account.id, username: account.username, postId });
    }

    return results;
  }
}

const service = new InstagramService();
warnIfNoKey('instagram');
service.start(process.env.PORT || 3005);
