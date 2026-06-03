require('dotenv').config();
const { createRestAPIClient } = require('masto');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');

const MASTODON_INSTANCE_URL = process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social';
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';

class MastodonService extends BasePlatformService {
  constructor() {
    super('mastodon');
    this.client = null;
  }

  _initClient() {
    if (!MASTODON_ACCESS_TOKEN) return null;
    return createRestAPIClient({
      url: MASTODON_INSTANCE_URL,
      accessToken: MASTODON_ACCESS_TOKEN,
    });
  }

  async getStatus() {
    if (!MASTODON_ACCESS_TOKEN) {
      return { connected: false, platform: 'mastodon', error: 'Access token not configured' };
    }
    try {
      const client = this._initClient();
      const account = await client.v1.accounts.verifyCredentials();
      return {
        connected: true,
        platform: 'mastodon',
        username: account.username,
        displayName: account.displayName,
        avatar: account.avatar,
        instance: MASTODON_INSTANCE_URL,
      };
    } catch (err) {
      return { connected: false, platform: 'mastodon', error: err.message };
    }
  }

  async fetchFeed({ limit = 40 } = {}) {
    const client = this._initClient();
    if (!client) throw new Error('Mastodon access token not configured');

    const statuses = await client.v1.timelines.home.list({ limit: Number(limit) });

    const items = statuses.map((status) =>
      this.normalizeFeedItem({
        originalId: status.id,
        author: {
          name: status.account.displayName || status.account.username,
          username: `${status.account.username}@${new URL(MASTODON_INSTANCE_URL).hostname}`,
          avatar: status.account.avatar,
          profileUrl: status.account.url,
        },
        content: status.text || _stripHtml(status.content),
        contentHtml: status.content,
        media: (status.mediaAttachments || []).map((m) => ({
          url: m.url,
          type: m.type,
          thumbnail: m.previewUrl,
          alt: m.description,
        })),
        platformTags: (status.tags || []).map((t) => t.name),
        metrics: {
          likes: status.favouritesCount,
          shares: status.reblogsCount,
          comments: status.repliesCount,
        },
        url: status.url,
        createdAt: status.createdAt,
      })
    );

    // MongoDB'ye kaydet (upsert)
    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of items) {
        await col.updateOne(
          { platform: 'mastodon', originalId: item.originalId },
          { $set: item },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'mastodon', outcome: 'failure', err: err.message });
    }

    return items;
  }

  async publishPost({ content, media = [], sensitive = false, spoilerText = '', firstComment } = {}) {
    const client = this._initClient();
    if (!client) throw new Error('Mastodon access token not configured');

    const status = await client.v1.statuses.create({
      status: content,
      sensitive,
      spoilerText,
      mediaIds: media,
    });

    if (firstComment?.trim()) {
      try {
        await client.v1.statuses.create({
          status: firstComment.trim(),
          inReplyToId: status.id,
        });
        this.app.log.info({ action: 'first_comment', platform: 'mastodon', statusId: status.id, outcome: 'success' });
      } catch (err) {
        this.app.log.warn({ action: 'first_comment', platform: 'mastodon', statusId: status.id, outcome: 'failure', err: err.message });
      }
    }

    return { id: status.id, url: status.url };
  }
}

function _stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, '').trim();
}

const service = new MastodonService();
service.start(process.env.PORT || 3003);
