import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface HashtagGroup {
  _id: string
  name: string
  hashtags: string[]
  createdAt: string
  updatedAt: string
}

export interface HashtagStat {
  _id: string             // compound key e.g. 'facebook:PAGE_ID||#photography', or hashtag in aggregate view
  hashtag: string         // e.g. '#photography'
  accountKey: string | null  // null in aggregate view
  count: number
  avgEngagement: number
  grade: 'A' | 'B' | 'C' | 'D'
  platforms: string[]
  lastScraped: string
}

export const useHashtagStore = defineStore('hashtags', () => {
  const groups = ref<HashtagGroup[]>([])
  const stats = ref<HashtagStat[]>([])
  const groupsLoading = ref(false)
  const statsLoading = ref(false)
  const scraping = ref(false)
  const aiSuggesting = ref(false)
  const aiSuggestions = ref<string[]>([])
  const error = ref('')

  async function fetchGroups() {
    groupsLoading.value = true
    error.value = ''
    try {
      const res = await axios.get('/api/hashtag-groups')
      groups.value = res.data.groups || []
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message
    } finally {
      groupsLoading.value = false
    }
  }

  async function createGroup(name: string, hashtags: string[]) {
    const res = await axios.post('/api/hashtag-groups', { name, hashtags })
    await fetchGroups()
    return res.data._id
  }

  async function updateGroup(id: string, name: string, hashtags: string[]) {
    await axios.put(`/api/hashtag-groups/${id}`, { name, hashtags })
    await fetchGroups()
  }

  async function deleteGroup(id: string) {
    await axios.delete(`/api/hashtag-groups/${id}`)
    groups.value = groups.value.filter((g) => g._id !== id)
  }

  async function scrapeHashtags(accountKey?: string) {
    scraping.value = true
    error.value = ''
    try {
      await axios.post('/api/hashtags/scrape', accountKey ? { accountKey } : {})
      await fetchStats('count', accountKey)
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message
    } finally {
      scraping.value = false
    }
  }

  async function fetchStats(sort: 'count' | 'engagement' = 'count', accountKey?: string) {
    statsLoading.value = true
    try {
      const params: Record<string, string> = { sort }
      if (accountKey) params.accountKey = accountKey
      const res = await axios.get('/api/hashtags/stats', { params })
      stats.value = res.data.stats || []
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message
    } finally {
      statsLoading.value = false
    }
  }

  async function aiSuggest(accountKey?: string, count = 20) {
    aiSuggesting.value = true
    aiSuggestions.value = []
    error.value = ''
    try {
      // Pass top tags from whichever account is currently in view
      const topTags = stats.value.slice(0, 15)
      const res = await axios.post('/api/hashtags/ai-suggest', { accountKey, topTags, count })
      aiSuggestions.value = res.data.hashtags || []
    } catch (err: any) {
      error.value = err.response?.data?.error || err.message
    } finally {
      aiSuggesting.value = false
    }
  }

  return {
    groups, stats, groupsLoading, statsLoading, scraping, aiSuggesting, aiSuggestions, error,
    fetchGroups, createGroup, updateGroup, deleteGroup,
    scrapeHashtags, fetchStats, aiSuggest,
  }
})
