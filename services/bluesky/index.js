require('dotenv').config();
const { BskyAgent, RichText } = require('@atproto/api');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');

const BLUESKY_IDENTIFIER = process.env.BLUESKY_IDENTIFIER || '';
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || '';
const BLUESKY_SERVICE = process.env.BLUESKY_SERVICE || 'https://bsky.social';

class BlueskyService extends BasePlatformService {
  constructor() {
    super('bluesky');
    this.agent = new BskyAgent({ service: BLUESKY_SERVICE });
    this.loggedIn = false;
  }

  async _ensureLoggedIn() {
    if (this.loggedIn) return;
    if (!BLUESKY_IDENTIFIER || !BLUESKY_APP_PASSWORD) {
      throw new Error('Bluesky credentials not configured');
    }
    await this.agent.login({
      identifier: BLUESKY_IDENTIFIER,
      password: BLUESKY_APP_PASSWORD,
    });
    this.loggedIn = true;
  }

  async getStatus() {
    if (!BLUESKY_IDENTIFIER || !BLUESKY_APP_PASSWORD) {
      return { connected: false, platform: 'bluesky', error: 'Credentials not configured' };
    }
    try {
      await this._ensureLoggedIn();
      const profile = await this.agent.getProfile({ actor: BLUESKY_IDENTIFIER });
      return {
        connected: true,
        platform: 'bluesky',
        username: profile.data.handle,
        displayName: profile.data.displayName,
        avatar: profile.data.avatar,
      };
    } catch (err) {
      this.loggedIn = false;
      return { connected: false, platform: 'bluesky', error: err.message };
    }
  }

  async fetchFeed({ limit = 50 } = {}) {
    await this._ensureLoggedIn();

    const response = await this.agent.getTimeline({ limit: Number(limit) });
    const items = response.data.feed
      .filter((entry) => entry.post)
      .map((entry) => {
        const post = entry.post;
        const author = post.author;
        const record = post.record;

        return this.normalizeFeedItem({
          originalId: post.uri,
          author: {
            name: author.displayName || author.handle,
            username: author.handle,
            avatar: author.avatar,
            profileUrl: `https://bsky.app/profile/${author.handle}`,
          },
          content: record.text || '',
          media: _extractMedia(post.embed),
          platformTags: _extractTags(record.facets),
          metrics: {
            likes: post.likeCount || 0,
            shares: post.repostCount || 0,
            comments: post.replyCount || 0,
          },
          url: `https://bsky.app/profile/${author.handle}/post/${post.uri.split('/').pop()}`,
          createdAt: record.createdAt,
        });
      });

    // MongoDB'ye kaydet (upsert)
    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of items) {
        await col.updateOne(
          { platform: 'bluesky', originalId: item.originalId },
          { $set: item },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'bluesky', outcome: 'failure', err: err.message });
    }

    return items;
  }

  async publishPost({ content, media = [], firstComment } = {}) {
    await this._ensureLoggedIn();

    const rt = new RichText({ text: content });
    await rt.detectFacets(this.agent);

    const postData = { text: rt.text, facets: rt.facets };

    if (media.length > 0) {
      postData.embed = { $type: 'app.bsky.embed.images', images: media };
    }

    const result = await this.agent.post(postData);

    if (firstComment?.trim()) {
      try {
        const commentRt = new RichText({ text: firstComment.trim() });
        await commentRt.detectFacets(this.agent);
        await this.agent.post({
          text: commentRt.text,
          facets: commentRt.facets,
          reply: {
            root: { uri: result.uri, cid: result.cid },
            parent: { uri: result.uri, cid: result.cid },
          },
        });
        this.app.log.info({ action: 'first_comment', platform: 'bluesky', uri: result.uri, outcome: 'success' });
      } catch (err) {
        this.app.log.warn({ action: 'first_comment', platform: 'bluesky', uri: result.uri, outcome: 'failure', err: err.message });
      }
    }

    return { uri: result.uri, cid: result.cid };
  }
}

function _extractMedia(embed) {
  if (!embed) return [];
  if (embed.$type === 'app.bsky.embed.images#view') {
    return (embed.images || []).map((img) => ({
      url: img.fullsize || img.thumb,
      type: 'image',
      thumbnail: img.thumb,
      alt: img.alt,
    }));
  }
  return [];
}

function _extractTags(facets = []) {
  if (!facets) return [];
  return facets
    .filter((f) => f.features?.some((feat) => feat.$type === 'app.bsky.richtext.facet#tag'))
    .flatMap((f) => f.features.filter((feat) => feat.$type === 'app.bsky.richtext.facet#tag').map((feat) => feat.tag));
}

const service = new BlueskyService();
service.start(process.env.PORT || 3004);
