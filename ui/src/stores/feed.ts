import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { usePlatformsStore } from './platforms'

export interface FeedItem {
  _id?: string
  platform: string
  originalId: string
  author: { name: string; username: string; avatar?: string; profileUrl?: string }
  content: string
  media: Array<{ url: string; type: string; thumbnail?: string; alt?: string }>
  platformTags: string[]
  tags: string[]
  metrics: { likes: number; comments: number; shares: number; views: number }
  url?: string
  createdAt: string
  fetchedAt: string
}

export const useFeedStore = defineStore('feed', () => {
  const items = ref<FeedItem[]>([])
  const loading = ref(false)
  const activePlatforms = ref<Set<string>>(new Set(['twitter', 'mastodon', 'bluesky', 'linkedin', 'instagram', 'facebook', 'pinterest', 'tiktok']))
  const activePageIds = ref<Set<string>>(new Set())
  const activeIgAccountIds = ref<Set<string>>(new Set())
  const activeTag = ref<string | null>(null)
  const searchQuery = ref('')

  const filteredItems = computed(() => {
    const platformsStore = usePlatformsStore()
    return items.value.filter((item) => {
      if (!activePlatforms.value.has(item.platform)) return false
      if (activeTag.value && !item.tags.includes(activeTag.value)) return false

      // Facebook page sub-filter (only when specific pages are selected)
      if (item.platform === 'facebook' && activePageIds.value.size > 0) {
        const activePages = platformsStore.connectedPages.filter((p) => activePageIds.value.has(p.id))
        if (!activePages.some((p) => p.name === item.author.username || p.name === item.author.name)) return false
      }

      // Instagram account sub-filter (only when specific accounts are selected)
      if (item.platform === 'instagram' && activeIgAccountIds.value.size > 0) {
        const activeAccounts = platformsStore.connectedIgAccounts.filter((a) => activeIgAccountIds.value.has(a.id))
        if (!activeAccounts.some((a) => a.username === item.author.username)) return false
      }

      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase()
        return (
          item.content.toLowerCase().includes(q) ||
          item.author.username.toLowerCase().includes(q)
        )
      }
      return true
    })
  })

  async function fetchFeeds(platform?: string) {
    loading.value = true
    try {
      const params: Record<string, string | number> = { limit: 100 }
      if (platform) params.platform = platform
      if (activeTag.value) params.tag = activeTag.value
      const res = await axios.get('/feeds/feeds', { params })
      items.value = res.data.items || []
    } catch (err) {
      console.error('Feed fetch error:', err)
    } finally {
      loading.value = false
    }
  }

  async function refreshFeeds() {
    try {
      await axios.post('/feeds/fetch')
      await fetchFeeds()
    } catch (err) {
      console.error('Refresh error:', err)
    }
  }

  function addItem(item: FeedItem) {
    const exists = items.value.some(
      (i) => i.platform === item.platform && i.originalId === item.originalId
    )
    if (!exists) items.value.unshift(item)
  }

  function togglePlatform(platform: string) {
    if (activePlatforms.value.has(platform)) {
      activePlatforms.value.delete(platform)
    } else {
      activePlatforms.value.add(platform)
    }
  }

  function togglePage(pageId: string) {
    if (activePageIds.value.has(pageId)) activePageIds.value.delete(pageId)
    else activePageIds.value.add(pageId)
  }

  function toggleIgAccount(accountId: string) {
    if (activeIgAccountIds.value.has(accountId)) activeIgAccountIds.value.delete(accountId)
    else activeIgAccountIds.value.add(accountId)
  }

  return {
    items, loading, activePlatforms, activePageIds, activeIgAccountIds, activeTag, searchQuery,
    filteredItems, fetchFeeds, refreshFeeds, addItem, togglePlatform, togglePage, toggleIgAccount,
  }
})
