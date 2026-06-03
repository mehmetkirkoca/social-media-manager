const Fastify = require('fastify');
const RabbitMQConnector = require('./RabbitMQConnector');
const { createLogger } = require('./logger');

/**
 * BasePlatformService — tüm platform servisleri bu sınıftan extend eder.
 *
 * Her platform servisi şu metodları override etmeli:
 *   - fetchFeed()        → platform API'sinden feed çeker
 *   - publishPost(post)  → platforma içerik gönderir
 *   - getStatus()        → bağlantı durumu döner
 *   - authenticate(code) → OAuth callback işler
 */
class BasePlatformService extends RabbitMQConnector {
  constructor(platformName) {
    super();
    this.platformName = platformName;
    this.log = createLogger(platformName);
    this.app = Fastify({ logger: this.log });
    this._setupRoutes();
  }

  /** HTTP route'ları kaydet — platform servisleri override edebilir */
  _setupRoutes() {
    this.app.get('/status', async (request) => {
      const workspaceId = request.headers['x-workspace-id'] || 'default';
      return this.getStatus(workspaceId);
    });

    this.app.get('/feed', async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] || 'default';
      try {
        const items = await this.fetchFeed({ ...request.query, workspaceId });
        return { success: true, platform: this.platformName, count: items.length, items };
      } catch (err) {
        const graphMsg = err.response?.data?.error?.message;
        const apiError = graphMsg || err.message;
        this.log.error({ action: 'fetch_feed', platform: this.platformName, outcome: 'failure', err: String(apiError) });
        reply.code(500).send({ success: false, error: String(apiError) });
      }
    });

    this.app.post('/post', async (request, reply) => {
      const workspaceId = request.headers['x-workspace-id'] || 'default';
      try {
        const result = await this.publishPost({ ...request.body, workspaceId });
        return { success: true, platform: this.platformName, result };
      } catch (err) {
        // Extract the actual third-party API error (e.g. Facebook Graph API error body)
        // rather than the generic axios "Request failed with status code 4xx" message.
        const graphMsg = err.response?.data?.error?.message;
        const graphCode = err.response?.data?.error?.code;
        const apiError = graphMsg
          ? (graphCode ? `[#${graphCode}] ${graphMsg}` : graphMsg)
          : (typeof err.response?.data?.error === 'string' ? err.response.data.error : err.message);
        this.log.error({ action: 'publish_post', platform: this.platformName, outcome: 'failure', err: String(apiError) });
        reply.code(500).send({ success: false, error: String(apiError) });
      }
    });

    this.app.get('/auth/callback', async (request, reply) => {
      try {
        const result = await this.authenticate(request.query);
        return { success: true, platform: this.platformName, result };
      } catch (err) {
        reply.code(500).send({ success: false, error: err.message });
      }
    });
  }

  /** HTTP sunucusunu başlat */
  async start(port = 3000) {
    await this.connect();
    await this.app.listen({ port, host: '0.0.0.0' });
    this.app.log.info({ action: 'service_start', port, outcome: 'success' }, `${this.platformName} service started`);
  }

  // ─── Alt sınıfların override edeceği metodlar ───────────────────────────────

  /** @returns {{ connected: boolean, platform: string, username?: string }} */
  async getStatus() {
    return { connected: false, platform: this.platformName };
  }

  /** @returns {Array<FeedItem>} normalize edilmiş feed öğeleri */
  async fetchFeed() {
    throw new Error(`[${this.platformName}] fetchFeed() implement edilmedi`);
  }

  /** @param {{ content: string, media?: Array, tags?: Array }} post */
  async publishPost() {
    throw new Error(`[${this.platformName}] publishPost() implement edilmedi`);
  }

  /** @param {{ code: string, state?: string }} query — OAuth callback params */
  async authenticate() {
    throw new Error(`[${this.platformName}] authenticate() implement edilmedi`);
  }

  // ─── Yardımcı metodlar ───────────────────────────────────────────────────────

  /**
   * Normalize edilmiş feed öğesi oluştur.
   * Platform servisleri bu şablonu kullanarak veriyi standartlaştırır.
   */
  normalizeFeedItem({
    originalId,
    author,
    content,
    contentHtml = null,
    media = [],
    links = [],
    platformTags = [],
    metrics = {},
    url = null,
    createdAt = new Date(),
  }) {
    return {
      platform: this.platformName,
      originalId: String(originalId),
      author: {
        name: author.name || '',
        username: author.username || '',
        avatar: author.avatar || null,
        profileUrl: author.profileUrl || null,
      },
      content,
      contentHtml,
      media,
      links,
      tags: [],
      platformTags,
      metrics: {
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0,
        views: metrics.views || 0,
        bookmarks: metrics.bookmarks || 0,
      },
      url,
      createdAt: new Date(createdAt),
      fetchedAt: new Date(),
    };
  }
}

module.exports = BasePlatformService;
