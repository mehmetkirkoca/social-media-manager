import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface CompetitorProfile {
  pricing: string
  keyFeatures: string[]
  marketingChannels: string[]
  targetCustomer: string
}

export type SignalSeverity = 'low' | 'medium' | 'high'

export interface CompetitorSignal {
  type: string
  description: string
  severity: SignalSeverity
  detectedAt: string
}

export interface CompetitorPrediction {
  satisfiedWithPosition: boolean
  likelyNextMoves: string[]
  vulnerabilities: string[]
  retaliationTriggers: string[]
}

export interface AiAnalysis {
  themes: string[]
  tone: string
  positioning: string
  gaps: string[]
  moves: string[]
  profile?: CompetitorProfile
  prediction?: CompetitorPrediction
}

export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'

export interface CompetitorKeyword {
  term: string
  intent: KeywordIntent
  extractedAt?: string
}

export interface GapItem {
  term: string
  intent: KeywordIntent
}

export interface CoveredItem extends GapItem {
  matchedHashtags: string[]
}

export interface GapAnalysis {
  gaps: GapItem[]
  covered: CoveredItem[]
  totalKeywords: number
  hashtagStatsEmpty: boolean
  lastAnalyzed: string
}

export interface RoadmapPost {
  topic: string
  headline: string
  keywords: string[]
  rationale: string
}

export interface CompetitorSuggestion {
  name: string
  websiteUrl: string
  reason: string
}

export interface Competitor {
  _id: string
  name: string
  websiteUrl: string
  socialUrls: Partial<Record<string, string>>
  scrapedContent: { source: string; url: string; text: string; scrapedAt: string }[]
  aiSummary: string
  aiAnalysis?: AiAnalysis
  keywords: CompetitorKeyword[]
  contentChanged?: boolean
  signals?: CompetitorSignal[]
  gapAnalysis?: GapAnalysis
  contentRoadmap?: RoadmapPost[]
  lastScraped: string | null
  createdAt: string
  updatedAt: string
}

export const useCompetitorStore = defineStore('competitors', () => {
  const competitors = ref<Competitor[]>([])
  const loading = ref(false)
  const scraping = ref<Record<string, boolean>>({})
  const summarizing = ref<Record<string, boolean>>({})
  const extractingKeywords = ref<Record<string, boolean>>({})
  const analyzingGaps = ref<Record<string, boolean>>({})
  const generatingRoadmap = ref<Record<string, boolean>>({})
  const scrapeResults = ref<Record<string, { sources: number; ok: boolean; message: string }>>({})
  const error = ref<string | null>(null)

  async function fetchCompetitors() {
    loading.value = true
    error.value = null
    try {
      const res = await axios.get('/api/competitors')
      competitors.value = res.data
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load competitors'
    } finally {
      loading.value = false
    }
  }

  async function addCompetitor(data: { name: string; websiteUrl: string; socialUrls?: Record<string, string> }): Promise<boolean> {
    error.value = null
    try {
      const res = await axios.post('/api/competitors', data)
      competitors.value.push(res.data)
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to add competitor'
      return false
    }
  }

  async function updateCompetitor(id: string, data: Partial<Pick<Competitor, 'name' | 'websiteUrl' | 'socialUrls'>>): Promise<boolean> {
    error.value = null
    try {
      const res = await axios.put(`/api/competitors/${id}`, data)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx] = res.data
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to update competitor'
      return false
    }
  }

  async function deleteCompetitor(id: string): Promise<boolean> {
    error.value = null
    try {
      await axios.delete(`/api/competitors/${id}`)
      competitors.value = competitors.value.filter((c) => c._id !== id)
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to delete competitor'
      return false
    }
  }

  async function pollScrapeJob(competitorId: string, jobId: string): Promise<{ ok: boolean; sources: number; message: string }> {
    return new Promise((resolve) => {
      const check = async () => {
        try {
          const res = await axios.get(`/api/competitors/${competitorId}/scrape-status/${jobId}`)
          const { status, sources, message } = res.data
          if (status === 'done' || status === 'failed') {
            resolve({ ok: status === 'done', sources: sources ?? 0, message: message || '' })
          } else {
            setTimeout(check, 2000)
          }
        } catch {
          resolve({ ok: false, sources: 0, message: 'Status check failed' })
        }
      }
      check()
    })
  }

  async function scrapeCompetitor(id: string): Promise<void> {
    scraping.value = { ...scraping.value, [id]: true }
    try {
      const res = await axios.post(`/api/competitors/${id}/scrape`)
      const { jobId } = res.data
      const result = await pollScrapeJob(id, jobId)
      scrapeResults.value = { ...scrapeResults.value, [id]: result }
      await fetchCompetitors()
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.response?.data?.error || err.message
      scrapeResults.value = { ...scrapeResults.value, [id]: { sources: 0, ok: false, message: msg } }
    } finally {
      scraping.value = { ...scraping.value, [id]: false }
    }
  }

  async function summarizeCompetitor(id: string): Promise<void> {
    summarizing.value = { ...summarizing.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/summarize`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) {
        competitors.value[idx].aiAnalysis = res.data.aiAnalysis
        competitors.value[idx].aiSummary = ''
      }
    } catch (err: any) {
      // Long AI calls can exceed the proxy timeout while the server still completes.
      // Re-fetch before showing an error — if the data saved, surface it silently.
      await fetchCompetitors()
      const saved = competitors.value.find((c) => c._id === id)?.aiAnalysis
      if (!saved) {
        error.value = err.response?.data?.detail || err.response?.data?.error || 'Summarization failed'
      }
    } finally {
      summarizing.value = { ...summarizing.value, [id]: false }
    }
  }

  async function extractKeywords(id: string): Promise<void> {
    extractingKeywords.value = { ...extractingKeywords.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/extract-keywords`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx].keywords = res.data.keywords || []
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Keyword extraction failed'
    } finally {
      extractingKeywords.value = { ...extractingKeywords.value, [id]: false }
    }
  }

  async function analyzeGaps(id: string): Promise<void> {
    analyzingGaps.value = { ...analyzingGaps.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/analyze-gaps`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx].gapAnalysis = res.data
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Gap analysis failed'
    } finally {
      analyzingGaps.value = { ...analyzingGaps.value, [id]: false }
    }
  }

  async function generateRoadmap(id: string): Promise<void> {
    generatingRoadmap.value = { ...generatingRoadmap.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/content-roadmap`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx].contentRoadmap = res.data.contentRoadmap
    } catch (err: any) {
      // Long AI calls can exceed the proxy timeout while the server still completes.
      // Re-fetch before showing an error — if the data saved, surface it silently.
      await fetchCompetitors()
      const saved = competitors.value.find((c) => c._id === id)?.contentRoadmap
      if (!saved?.length) {
        error.value = err.response?.data?.detail || err.response?.data?.error || 'Roadmap generation failed'
      }
    } finally {
      generatingRoadmap.value = { ...generatingRoadmap.value, [id]: false }
    }
  }

  const detectingSignals = ref<Record<string, boolean>>({})
  const discoveringCompetitors = ref(false)
  const discoverySuggestions = ref<CompetitorSuggestion[]>([])

  async function detectSignals(id: string): Promise<void> {
    detectingSignals.value = { ...detectingSignals.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/detect-signals`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) {
        competitors.value[idx].signals = res.data.signals
        competitors.value[idx].contentChanged = false
      }
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Signal detection failed'
    } finally {
      detectingSignals.value = { ...detectingSignals.value, [id]: false }
    }
  }

  async function discoverCompetitors(): Promise<void> {
    discoveringCompetitors.value = true
    error.value = null
    discoverySuggestions.value = []
    try {
      const res = await axios.post('/api/competitors/discover')
      discoverySuggestions.value = res.data.suggestions || []
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Discovery failed'
    } finally {
      discoveringCompetitors.value = false
    }
  }

  return {
    competitors, loading, scraping, summarizing, extractingKeywords, analyzingGaps, generatingRoadmap,
    detectingSignals, discoveringCompetitors, discoverySuggestions, scrapeResults, error,
    fetchCompetitors, addCompetitor, updateCompetitor, deleteCompetitor,
    scrapeCompetitor, summarizeCompetitor, extractKeywords, analyzeGaps, generateRoadmap,
    detectSignals, discoverCompetitors,
  }
})
