require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');
const { decryptToken, warnIfNoKey } = require('./utils/crypto');
const { getWorkspaceCredential } = require('./utils/credentials');

const GRAPH_API = 'https://graph.facebook.com/v22.0';
// Internal Docker URL for downloading local media files (nginx serves /media/*)
const MEDIA_INTERNAL_URL = (process.env.MEDIA_INTERNAL_URL || 'http://nginx:8081').replace(/\/$/, '');

function isLocalUrl(url) {
  return !url || url.startsWith('/') || /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);
}

function resolveInternalUrl(url) {
  if (url.startsWith('/')) return `${MEDIA_INTERNAL_URL}${url}`;
  return url.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, MEDIA_INTERNAL_URL);
}

class FacebookService extends BasePlatformService {
  constructor() {
    super('facebook');
  }

  // Read selected Facebook Pages from MongoDB.
  // Falls back to env vars for backwards compatibility.
  async _getPages(workspaceId = 'default') {
    try {
      const db = await getDb();
      const cred = await getWorkspaceCredential(db, 'facebook', workspaceId);
      const dbPages = (cred?.pages || []).filter((p) => p.selected);
      if (dbPages.length > 0) {
        return dbPages.map((p) => ({ ...p, accessToken: decryptToken(p.accessToken) })).filter((p) => p.accessToken);
      }
    } catch (_) { /* fall through */ }

    // Env var fallback (legacy single-page mode)
    const { FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID } = process.env;
    if (FACEBOOK_PAGE_ACCESS_TOKEN && FACEBOOK_PAGE_ID) {
      return [{ id: FACEBOOK_PAGE_ID, accessToken: FACEBOOK_PAGE_ACCESS_TOKEN }];
    }

    return [];
  }

  async getStatus(workspaceId = 'default') {
    const pages = await this._getPages(workspaceId);
    if (pages.length === 0) {
      return { connected: false, platform: 'facebook', error: 'No Facebook Pages connected — use Settings to connect via Facebook OAuth' };
    }
    try {
      const first = pages[0];
      const res = await axios.get(`${GRAPH_API}/${first.id}`, {
        params: {
          fields: 'id,name,username,picture',
          access_token: first.accessToken,
        },
      });
      return {
        connected: true,
        platform: 'facebook',
        username: res.data.username || res.data.name,
        displayName: res.data.name,
        avatar: res.data.picture?.data?.url,
        pageCount: pages.length,
      };
    } catch (err) {
      return { connected: false, platform: 'facebook', error: err.response?.data?.error?.message || err.message };
    }
  }

  async fetchFeed({ limit = 20, workspaceId = 'default' } = {}) {
    const pages = await this._getPages(workspaceId);
    if (pages.length === 0) throw new Error('No Facebook Pages connected');

    const allItems = [];

    for (const page of pages) {
      const res = await axios.get(`${GRAPH_API}/${page.id}/feed`, {
        params: {
          fields: 'id,message,story,full_picture,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
          limit: Math.min(Number(limit), 100),
          access_token: page.accessToken,
        },
      });

      const items = (res.data.data || []).map((post) =>
        this.normalizeFeedItem({
          originalId: post.id,
          author: {
            name: page.name || '',
            username: page.name || '',
          },
          content: post.message || post.story || '',
          media: post.full_picture ? [{ url: post.full_picture, type: 'image' }] : [],
          metrics: {
            likes: post.likes?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0,
            shares: post.shares?.count || 0,
          },
          url: post.permalink_url,
          createdAt: post.created_time,
        })
      );

      allItems.push(...items);
    }

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of allItems) {
        await col.updateOne(
          { platform: 'facebook', originalId: item.originalId, workspaceId },
          { $set: { ...item, workspaceId } },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'facebook', outcome: 'failure', err: err.message });
    }

    return allItems;
  }

  // Upload a photo to a Facebook Page.
  // - Local/relative URLs are downloaded from the internal Docker network and uploaded as binary.
  // - Public external URLs are submitted via the `url` parameter (Facebook downloads them directly).
  // Returns the post_id (visible on the Page timeline).
  async _uploadPhoto(pageId, accessToken, message, imageUrl) {
    if (isLocalUrl(imageUrl)) {
      // Download from internal nginx and binary-upload — Facebook's servers cannot reach localhost
      const internalUrl = resolveInternalUrl(imageUrl);
      this.app.log.info({ action: 'photo_upload', pageId, method: 'binary', internalUrl });
      const imgRes = await axios.get(internalUrl, { responseType: 'arraybuffer', timeout: 15000 });
      const mime = imgRes.headers['content-type'] || 'image/jpeg';

      const form = new FormData();
      form.append('message', message);
      form.append('access_token', accessToken);
      form.append('source', new Blob([imgRes.data], { type: mime }), 'image.jpg');

      const photoRes = await fetch(`${GRAPH_API}/${pageId}/photos`, { method: 'POST', body: form });
      if (!photoRes.ok) {
        const errBody = await photoRes.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Facebook API error ${photoRes.status}`);
      }
      const data = await photoRes.json();
      return data.post_id || data.id;
    } else {
      // External public URL — Facebook downloads it directly
      const res = await axios.post(`${GRAPH_API}/${pageId}/photos`, null, {
        params: { message, url: imageUrl, access_token: accessToken },
      });
      return res.data.post_id || res.data.id;
    }
  }

  async publishPost({ content, link, imageUrl, accountId, firstComment, workspaceId = 'default' } = {}) {
    const allPages = await this._getPages(workspaceId);
    if (allPages.length === 0) throw new Error('No Facebook Pages connected');
    if (!content) throw new Error('content is required');

    // If a specific page is requested, target only that page
    const pages = accountId ? allPages.filter((p) => p.id === accountId) : allPages;
    if (pages.length === 0) throw new Error(`Facebook page ${accountId} not found or not connected`);

    const results = [];
    for (const page of pages) {
      let postId;

      if (imageUrl) {
        // Photo post — use /photos endpoint (binary for local URLs, url param for external)
        postId = await this._uploadPhoto(page.id, page.accessToken, content, imageUrl);
      } else {
        // Text-only post (optionally with a link preview)
        const params = { message: content, access_token: page.accessToken };
        if (link) params.link = link;
        const res = await axios.post(`${GRAPH_API}/${page.id}/feed`, null, { params });
        postId = res.data.id;
      }

      if (firstComment?.trim()) {
        try {
          await axios.post(`${GRAPH_API}/${postId}/comments`, null, {
            params: { message: firstComment.trim(), access_token: page.accessToken },
            timeout: 10000,
          });
          this.app.log.info({ action: 'first_comment', platform: 'facebook', postId, outcome: 'success' });
        } catch (err) {
          this.app.log.warn({ action: 'first_comment', platform: 'facebook', postId, outcome: 'failure', err: err.response?.data?.error?.message || err.message });
        }
      }

      results.push({ pageId: page.id, pageName: page.name, postId });
    }

    return results;
  }
}

const service = new FacebookService();
warnIfNoKey('facebook');
service.start(process.env.PORT || 3006);
