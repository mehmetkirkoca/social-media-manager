require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');

const {
  TWITTER_API_KEY,
  TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_SECRET,
  TWITTER_BEARER_TOKEN,
} = process.env;

class TwitterService extends BasePlatformService {
  constructor() {
    super('twitter');
    this.client = null;
    this.roClient = null;
  }

  _initClients() {
    if (!TWITTER_BEARER_TOKEN && !TWITTER_API_KEY) return;

    // Read-only client (Bearer token — feed okuma için)
    if (TWITTER_BEARER_TOKEN) {
      this.roClient = new TwitterApi(TWITTER_BEARER_TOKEN);
    }

    // Read-write client (OAuth 1.0a — tweet atmak için)
    if (TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_SECRET) {
      this.client = new TwitterApi({
        appKey: TWITTER_API_KEY,
        appSecret: TWITTER_API_SECRET,
        accessToken: TWITTER_ACCESS_TOKEN,
        accessSecret: TWITTER_ACCESS_SECRET,
      });
    }
  }

  async getStatus() {
    this._initClients();
    if (!this.client) {
      return { connected: false, platform: 'twitter', error: 'Twitter credentials not configured' };
    }
    try {
      const me = await this.client.v2.me();
      return {
        connected: true,
        platform: 'twitter',
        userId: me.data.id,
        username: me.data.username,
        displayName: me.data.name,
      };
    } catch (err) {
      return { connected: false, platform: 'twitter', error: err.message };
    }
  }

  async fetchFeed({ limit = 20 } = {}) {
    this._initClients();
    const client = this.client || this.roClient;
    if (!client) throw new Error('Twitter credentials not configured');

    // Home timeline (OAuth 1.0a gerektirir)
    const me = await this.client.v2.me();
    const timeline = await this.client.v2.homeTimeline({
      max_results: Math.min(Number(limit), 100),
      'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'entities'],
      expansions: ['author_id', 'attachments.media_keys'],
      'user.fields': ['name', 'username', 'profile_image_url'],
      'media.fields': ['url', 'preview_image_url', 'alt_text', 'type'],
    });

    const users = {};
    const media = {};
    (timeline.includes?.users || []).forEach((u) => (users[u.id] = u));
    (timeline.includes?.media || []).forEach((m) => (media[m.media_key] = m));

    const items = (timeline.data?.data || []).map((tweet) => {
      const author = users[tweet.author_id] || {};
      const tweetMedia = (tweet.attachments?.media_keys || [])
        .map((key) => media[key])
        .filter(Boolean)
        .map((m) => ({ url: m.url || m.preview_image_url, type: m.type, alt: m.alt_text }));

      return this.normalizeFeedItem({
        originalId: tweet.id,
        author: {
          name: author.name || '',
          username: author.username || '',
          avatar: author.profile_image_url,
          profileUrl: `https://twitter.com/${author.username}`,
        },
        content: tweet.text,
        media: tweetMedia,
        platformTags: (tweet.entities?.hashtags || []).map((h) => h.tag),
        metrics: {
          likes: tweet.public_metrics?.like_count || 0,
          shares: tweet.public_metrics?.retweet_count || 0,
          comments: tweet.public_metrics?.reply_count || 0,
          views: tweet.public_metrics?.impression_count || 0,
        },
        url: `https://twitter.com/${author.username}/status/${tweet.id}`,
        createdAt: tweet.created_at,
      });
    });

    // MongoDB'ye kaydet (upsert)
    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of items) {
        await col.updateOne(
          { platform: 'twitter', originalId: item.originalId },
          { $set: item },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'twitter', outcome: 'failure', err: err.message });
    }

    return items;
  }

  async publishPost({ content } = {}) {
    this._initClients();
    if (!this.client) throw new Error('Twitter write credentials not configured');

    const result = await this.client.v2.tweet(content);
    return { id: result.data.id, text: result.data.text };
  }
}

const service = new TwitterService();
service.start(process.env.PORT || 3001);
