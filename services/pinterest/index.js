require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');
const { decryptToken, warnIfNoKey } = require('./utils/crypto');
const { getWorkspaceCredential } = require('./utils/credentials');

const PINTEREST_API = 'https://api.pinterest.com/v5';

class PinterestService extends BasePlatformService {
  constructor() {
    super('pinterest');
  }

  async _getAccount(workspaceId = 'default') {
    try {
      const db = await getDb();
      const cred = await getWorkspaceCredential(db, 'pinterest', workspaceId);
      if (cred?.accessToken) {
        return { ...cred, accessToken: decryptToken(cred.accessToken) };
      }
    } catch (_) {}
    return null;
  }

  async getStatus(workspaceId = 'default') {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) {
      return { connected: false, platform: 'pinterest', error: 'Not connected — use Settings to connect via Pinterest OAuth' };
    }
    try {
      const res = await axios.get(`${PINTEREST_API}/user_account`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
        timeout: 10000,
      });
      const selectedBoards = (account.boards || []).filter((b) => b.selected);
      return {
        connected: selectedBoards.length > 0,
        platform: 'pinterest',
        username: res.data.username,
        displayName: res.data.business_name || res.data.username,
        avatar: res.data.profile_image,
        boardCount: selectedBoards.length,
      };
    } catch (err) {
      return { connected: false, platform: 'pinterest', error: err.response?.data?.message || err.message };
    }
  }

  async fetchFeed({ limit = 25, workspaceId = 'default' } = {}) {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) throw new Error('Pinterest not connected');

    const allItems = [];
    const selectedBoards = (account.boards || []).filter((b) => b.selected);
    const boardsToFetch = selectedBoards.length > 0 ? selectedBoards : (account.boards || []).slice(0, 3);

    for (const board of boardsToFetch) {
      try {
        const res = await axios.get(`${PINTEREST_API}/boards/${board.id}/pins`, {
          headers: { Authorization: `Bearer ${account.accessToken}` },
          params: { page_size: Math.min(Math.ceil(Number(limit) / Math.max(boardsToFetch.length, 1)), 50) },
          timeout: 15000,
        });

        const items = (res.data.items || []).map((pin) =>
          this.normalizeFeedItem({
            originalId: pin.id,
            author: {
              name: account.displayName || account.username || 'Pinterest',
              username: account.username || '',
            },
            content: pin.description || pin.title || '',
            media: pin.media?.images?.['600x']?.url
              ? [{ url: pin.media.images['600x'].url, type: 'image' }]
              : [],
            metrics: { likes: pin.save_count || 0, comments: pin.comment_count || 0, shares: 0 },
            url: `https://www.pinterest.com/pin/${pin.id}/`,
            createdAt: pin.created_at || new Date(),
          })
        );

        allItems.push(...items);
      } catch (err) {
        this.app.log.warn({ action: 'feed_fetch', platform: 'pinterest', boardId: board.id, outcome: 'failure', err: err.message });
      }
    }

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of allItems) {
        await col.updateOne(
          { platform: 'pinterest', originalId: item.originalId, workspaceId },
          { $set: { ...item, workspaceId } },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'pinterest', outcome: 'failure', err: err.message });
    }

    return allItems;
  }

  async publishPost({ content, imageUrl, accountId: boardId, workspaceId = 'default' } = {}) {
    const account = await this._getAccount(workspaceId);
    if (!account?.accessToken) throw new Error('Pinterest not connected');
    if (!boardId) throw new Error('boardId is required for Pinterest — select a board as destination');
    if (!imageUrl) throw new Error('Pinterest requires an image URL');

    const pinData = {
      board_id: boardId,
      description: content || '',
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    };

    if (content) {
      pinData.title = content.slice(0, 100);
    }

    try {
      const res = await axios.post(`${PINTEREST_API}/pins`, pinData, {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      this.app.log.info({ action: 'publish_post', platform: 'pinterest', boardId, pinId: res.data.id, outcome: 'success' });
      return { pinId: res.data.id, boardId };
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      this.app.log.error({ action: 'publish_post', platform: 'pinterest', boardId, outcome: 'failure', err: msg });
      throw new Error(msg);
    }
  }
}

const service = new PinterestService();

// Returns selected boards from DB (used by gateway/compose to list destinations)
service.app.get('/boards', async (request, reply) => {
  try {
    const workspaceId = request.headers['x-workspace-id'] || 'default';
    const account = await service._getAccount(workspaceId);
    if (!account) return { boards: [] };
    const selected = (account.boards || []).filter((b) => b.selected);
    return { boards: selected };
  } catch (err) {
    reply.code(500).send({ success: false, error: err.message });
  }
});

warnIfNoKey('pinterest');
service.start(process.env.PORT || 3008);
