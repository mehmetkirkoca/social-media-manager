require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');
const { encryptToken, decryptToken, warnIfNoKey } = require('./utils/crypto');
const { getWorkspaceCredential } = require('./utils/credentials');

const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const TOKEN_URL = `${TIKTOK_API}/oauth/token/`;

class TikTokService extends BasePlatformService {
  constructor() {
    super('tiktok');
  }

  async _getAccount(workspaceId = 'default') {
    try {
      const db = await getDb();
      const [cred, appCred] = await Promise.all([
        getWorkspaceCredential(db, 'tiktok', workspaceId),
        db.collection('platform_credentials').findOne({ _id: 'tiktok_app' }),
      ]);

      if (!cred?.accessToken || !appCred?.clientKey) return null;

      // Auto-refresh if access token is expired or expires within 5 minutes
      if (cred.tokenExpiry && new Date(cred.tokenExpiry) < new Date(Date.now() + 5 * 60 * 1000)) {
        if (cred.refreshToken && cred.refreshExpiry && new Date(cred.refreshExpiry) > new Date()) {
          try {
            const clientSecret = decryptToken(appCred.clientSecret);
            const refreshRes = await axios.post(
              TOKEN_URL,
              new URLSearchParams({
                client_key: appCred.clientKey,
                client_secret: clientSecret,
                grant_type: 'refresh_token',
                refresh_token: decryptToken(cred.refreshToken),
              }).toString(),
              { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
            );
            const { access_token, refresh_token: newRefresh, expires_in, refresh_expires_in } = refreshRes.data;
            const tokenExpiry = new Date(Date.now() + (expires_in || 86400) * 1000).toISOString();
            const refreshExpiry = newRefresh
              ? new Date(Date.now() + (refresh_expires_in || 31536000) * 1000).toISOString()
              : cred.refreshExpiry;

            await db.collection('platform_credentials').updateOne(
              { _id: cred._id },
              {
                $set: {
                  accessToken: encryptToken(access_token),
                  refreshToken: newRefresh ? encryptToken(newRefresh) : cred.refreshToken,
                  tokenExpiry,
                  refreshExpiry,
                  updatedAt: new Date(),
                },
              }
            );

            this.app.log.info({ action: 'token_refresh', platform: 'tiktok', outcome: 'success' });
            return { ...cred, accessToken: access_token };
          } catch (err) {
            this.app.log.warn({ action: 'token_refresh', platform: 'tiktok', outcome: 'failure', err: err.message });
          }
        }
      }

      return { ...cred, accessToken: decryptToken(cred.accessToken) };
    } catch (_) {}
    return null;
  }

  async getStatus(workspaceId = 'default') {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) {
      return { connected: false, platform: 'tiktok', error: 'Not connected — use Settings to connect via TikTok OAuth' };
    }
    try {
      const res = await axios.get(`${TIKTOK_API}/user/info/`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
        params: { fields: 'open_id,display_name,avatar_url,username' },
        timeout: 10000,
      });
      const user = res.data?.data?.user || {};
      return {
        connected: true,
        platform: 'tiktok',
        username: user.username || user.display_name,
        displayName: user.display_name,
        avatar: user.avatar_url,
      };
    } catch (err) {
      return { connected: false, platform: 'tiktok', error: err.response?.data?.error?.message || err.message };
    }
  }

  async fetchFeed({ limit = 20, workspaceId = 'default' } = {}) {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) throw new Error('TikTok not connected');

    const res = await axios.post(
      `${TIKTOK_API}/video/list/`,
      { max_count: Math.min(Number(limit), 20) },
      {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        params: { fields: 'id,title,video_description,share_url,view_count,like_count,comment_count,share_count,create_time,cover_image_url' },
        timeout: 15000,
      }
    );

    const videos = res.data?.data?.videos || [];
    const items = videos.map((v) =>
      this.normalizeFeedItem({
        originalId: v.id,
        author: {
          name: account.displayName || account.username || 'TikTok',
          username: account.username || '',
          avatar: account.avatar || null,
        },
        content: v.video_description || v.title || '',
        media: v.cover_image_url ? [{ url: v.cover_image_url, type: 'image' }] : [],
        metrics: {
          likes: v.like_count || 0,
          comments: v.comment_count || 0,
          shares: v.share_count || 0,
          views: v.view_count || 0,
        },
        url: v.share_url || '',
        createdAt: v.create_time ? new Date(v.create_time * 1000) : new Date(),
      })
    );

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of items) {
        await col.updateOne(
          { platform: 'tiktok', originalId: item.originalId, workspaceId },
          { $set: { ...item, workspaceId } },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'tiktok', outcome: 'failure', err: err.message });
    }

    return items;
  }

  async publishPost({ content, videoUrl, workspaceId = 'default' } = {}) {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) throw new Error('TikTok not connected');
    if (!videoUrl) throw new Error('TikTok requires a video URL — text-only posts are not supported');

    const body = {
      post_info: {
        title: (content || '').slice(0, 2200),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    };

    try {
      const res = await axios.post(`${TIKTOK_API}/post/publish/video/init/`, body, {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        timeout: 30000,
      });
      const publishId = res.data?.data?.publish_id;
      this.app.log.info({ action: 'publish_post', platform: 'tiktok', publishId, outcome: 'success' });
      return { publishId };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      this.app.log.error({ action: 'publish_post', platform: 'tiktok', outcome: 'failure', err: msg });
      throw new Error(msg);
    }
  }
}

const service = new TikTokService();
warnIfNoKey('tiktok');
service.start(process.env.PORT || 3007);
