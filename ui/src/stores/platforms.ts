import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

export interface PlatformStatus {
  platform: string
  connected: boolean
  username?: string
  displayName?: string
  avatar?: string
  error?: string
  pageCount?: number
  accountCount?: number
}

export interface MetaPage {
  id: string
  name: string
  picture?: string
}

export interface MetaIgAccount {
  id: string
  username: string
  avatar?: string
  pageId: string
}

export interface MetaDiscovery {
  pages: MetaPage[]
  igAccounts: MetaIgAccount[]
}

export interface PinterestBoard {
  id: string
  name: string
  privacy?: string
  selected?: boolean
}

export interface PinterestCredentials {
  configured: boolean
  clientId?: string
  clientSecretHint?: string
}

export interface MetaCredentials {
  configured: boolean
  appId?: string
  appSecretHint?: string
}

export interface TokenExpiryAccount {
  id: string
  username: string
  expiresAt: string | null
  daysLeft: number | null
  isValid: boolean
}

export const PLATFORM_META: Record<string, { label: string; color: string; icon: string }> = {
  twitter:   { label: 'Twitter/X',  color: '#000000', icon: 'fa-brands fa-x-twitter' },
  linkedin:  { label: 'LinkedIn',   color: '#0077B5', icon: 'fa-brands fa-linkedin' },
  mastodon:  { label: 'Mastodon',   color: '#6364FF', icon: 'fa-brands fa-mastodon' },
  bluesky:   { label: 'Bluesky',    color: '#0085FF', icon: 'fa-solid fa-cloud' },
  instagram: { label: 'Instagram',  color: '#E1306C', icon: 'fa-brands fa-instagram' },
  facebook:  { label: 'Facebook',   color: '#1877F2', icon: 'fa-brands fa-facebook' },
  reddit:    { label: 'Reddit',     color: '#FF4500', icon: 'fa-brands fa-reddit' },
  youtube:   { label: 'YouTube',    color: '#FF0000', icon: 'fa-brands fa-youtube' },
  pinterest: { label: 'Pinterest',  color: '#E60023', icon: 'fa-brands fa-pinterest' },
  tiktok:    { label: 'TikTok',     color: '#EE1D52', icon: 'fa-brands fa-tiktok' },
}

export const usePlatformsStore = defineStore('platforms', () => {
  const statuses = ref<PlatformStatus[]>([])
  const loading = ref(false)

  // Meta-specific state
  const metaCredentials = ref<MetaCredentials>({ configured: false })
  const metaDiscovery = ref<MetaDiscovery | null>(null)
  const metaLoading = ref(false)
  const metaError = ref<string | null>(null)

  // Connected pages/accounts (fetched from gateway)
  const connectedPages = ref<MetaPage[]>([])
  const connectedIgAccounts = ref<MetaIgAccount[]>([])
  // All pages/accounts including unselected ones (for per-workspace selection UI)
  const allFbPages = ref<(MetaPage & { selected: boolean })[]>([])
  const allIgAccounts = ref<(MetaIgAccount & { selected: boolean })[]>([])

  // Pinterest
  const pinterestCredentials = ref<PinterestCredentials>({ configured: false })
  const pinterestLoading = ref(false)
  const pinterestError = ref<string | null>(null)
  const connectedPinterestBoards = ref<PinterestBoard[]>([])
  const allPinterestBoards = ref<PinterestBoard[]>([])

  // Token expiry
  const tokenExpiry = ref<TokenExpiryAccount[]>([])
  const tokenExpiryDismissed = ref(false)

  const expiringAccounts = computed(() =>
    tokenExpiry.value.filter((a: TokenExpiryAccount) => a.daysLeft !== null && a.daysLeft < 7)
  )

  const hasExpiryWarning = computed(() =>
    !tokenExpiryDismissed.value && expiringAccounts.value.length > 0
  )

  async function fetchTokenExpiry() {
    try {
      const res = await axios.get('/api/meta/token-expiry')
      tokenExpiry.value = res.data.accounts || []
    } catch (err) {
      console.error('Token expiry check error:', err)
    }
  }

  function dismissTokenWarning() {
    tokenExpiryDismissed.value = true
  }

  async function refreshMetaTokens() {
    const res = await axios.post('/api/meta/token-refresh', {})
    // Re-fetch expiry so the banner updates immediately
    await fetchTokenExpiry()
    return res.data
  }

  async function fetchMetaConnections() {
    try {
      const res = await axios.get('/api/credentials')
      const data = res.data
      connectedPages.value = data.facebook?.pages || []
      allFbPages.value = data.facebook?.allPages || []
      connectedIgAccounts.value = data.instagram?.accounts || []
      allIgAccounts.value = data.instagram?.allAccounts || []
      connectedPinterestBoards.value = data.pinterest?.boards || []
      allPinterestBoards.value = data.pinterest?.allBoards || []
      tiktokConnected.value = data.tiktok?.connected ?? false
      tiktokUsername.value = data.tiktok?.username || null
    } catch (_) { /* ignore */ }
  }

  async function fetchPinterestCredentials() {
    try {
      const res = await axios.get('/api/credentials/pinterest-app')
      pinterestCredentials.value = res.data
    } catch (err) {
      console.error('Pinterest credentials fetch error:', err)
    }
  }

  async function savePinterestApp(clientId: string, clientSecret: string) {
    pinterestLoading.value = true
    pinterestError.value = null
    try {
      await axios.post('/api/credentials/pinterest-app', { clientId, clientSecret })
      pinterestCredentials.value = { configured: true, clientId, clientSecretHint: `****${clientSecret.slice(-4)}` }
    } catch (err: any) {
      pinterestError.value = err.response?.data?.error || 'Failed to save app credentials'
    } finally {
      pinterestLoading.value = false
    }
  }

  async function startPinterestOAuth() {
    pinterestLoading.value = true
    pinterestError.value = null
    try {
      const res = await axios.get('/api/auth/pinterest/init')
      window.location.href = res.data.url
    } catch (err: any) {
      pinterestError.value = err.response?.data?.error || 'Failed to start OAuth'
      pinterestLoading.value = false
    }
  }

  async function savePinterestBoards(selectedBoardIds: string[]) {
    pinterestLoading.value = true
    pinterestError.value = null
    try {
      await axios.post('/api/credentials/pinterest/boards', { selectedBoardIds })
      allPinterestBoards.value = allPinterestBoards.value.map((b) => ({
        ...b,
        selected: selectedBoardIds.includes(b.id),
      }))
      connectedPinterestBoards.value = allPinterestBoards.value.filter((b) => b.selected)
    } catch (err: any) {
      pinterestError.value = err.response?.data?.error || 'Failed to save board selection'
    } finally {
      pinterestLoading.value = false
    }
  }

  async function disconnectPinterest() {
    pinterestLoading.value = true
    try {
      await axios.delete('/api/credentials/pinterest')
      connectedPinterestBoards.value = []
      allPinterestBoards.value = []
      await fetchStatuses()
    } catch (err) {
      console.error('Pinterest disconnect error:', err)
    } finally {
      pinterestLoading.value = false
    }
  }

  // ─── TikTok ───────────────────────────────────────────────────────────────

  interface TikTokCredentials {
    configured: boolean
    clientKey?: string
    clientSecretHint?: string
  }

  const tiktokCredentials = ref<TikTokCredentials>({ configured: false })
  const tiktokLoading = ref(false)
  const tiktokError = ref<string | null>(null)
  const tiktokConnected = ref(false)
  const tiktokUsername = ref<string | null>(null)

  async function fetchTikTokCredentials() {
    try {
      const res = await axios.get('/api/credentials/tiktok-app')
      tiktokCredentials.value = res.data
    } catch (err) {
      console.error('TikTok credentials fetch error:', err)
    }
  }

  async function saveTikTokApp(clientKey: string, clientSecret: string) {
    tiktokLoading.value = true
    tiktokError.value = null
    try {
      await axios.post('/api/credentials/tiktok-app', { clientKey, clientSecret })
      tiktokCredentials.value = { configured: true, clientKey, clientSecretHint: `****${clientSecret.slice(-4)}` }
    } catch (err: any) {
      tiktokError.value = err.response?.data?.error || 'Failed to save app credentials'
    } finally {
      tiktokLoading.value = false
    }
  }

  async function startTikTokOAuth() {
    tiktokLoading.value = true
    tiktokError.value = null
    try {
      const res = await axios.get('/api/auth/tiktok/init')
      window.location.href = res.data.url
    } catch (err: any) {
      tiktokError.value = err.response?.data?.error || 'Failed to start OAuth'
      tiktokLoading.value = false
    }
  }

  async function disconnectTikTok() {
    tiktokLoading.value = true
    try {
      await axios.delete('/api/credentials/tiktok')
      tiktokConnected.value = false
      tiktokUsername.value = null
      await fetchStatuses()
    } catch (err) {
      console.error('TikTok disconnect error:', err)
    } finally {
      tiktokLoading.value = false
    }
  }

  // ─── Platform status ──────────────────────────────────────────────────────

  async function fetchStatuses() {
    loading.value = true
    try {
      const res = await axios.get('/feeds/platform-status')
      statuses.value = res.data
    } catch (err) {
      console.error('Platform status error:', err)
    } finally {
      loading.value = false
    }
  }

  function getStatus(platform: string): PlatformStatus | undefined {
    return statuses.value.find((s: PlatformStatus) => s.platform === platform)
  }

  function isConnected(platform: string): boolean {
    return getStatus(platform)?.connected ?? false
  }

  // ─── Meta App credentials ─────────────────────────────────────────────────

  async function fetchMetaCredentials() {
    try {
      const res = await axios.get('/api/credentials/meta-app')
      metaCredentials.value = res.data
    } catch (err) {
      console.error('Meta credentials fetch error:', err)
    }
  }

  async function saveMetaApp(appId: string, appSecret: string) {
    metaLoading.value = true
    metaError.value = null
    try {
      await axios.post('/api/credentials/meta-app', { appId, appSecret })
      metaCredentials.value = { configured: true, appId, appSecretHint: `****${appSecret.slice(-4)}` }
    } catch (err: any) {
      metaError.value = err.response?.data?.error || 'Failed to save app credentials'
    } finally {
      metaLoading.value = false
    }
  }

  // ─── OAuth flow ───────────────────────────────────────────────────────────

  async function startMetaOAuth() {
    metaLoading.value = true
    metaError.value = null
    try {
      const res = await axios.get('/api/auth/meta/init')
      // Redirect the browser to Facebook OAuth
      window.location.href = res.data.url
    } catch (err: any) {
      metaError.value = err.response?.data?.error || 'Failed to start OAuth'
      metaLoading.value = false
    }
  }

  async function fetchMetaDiscovery() {
    try {
      const res = await axios.get('/api/auth/meta/discovered')
      metaDiscovery.value = res.data
    } catch (err) {
      console.error('Meta discovery fetch error:', err)
    }
  }

  async function saveMetaSelection(selectedPageIds: string[], selectedIgAccountIds: string[]) {
    metaLoading.value = true
    metaError.value = null
    try {
      await axios.post('/api/auth/meta/save', { selectedPageIds, selectedIgAccountIds })
      metaDiscovery.value = null
      await fetchStatuses()
    } catch (err: any) {
      metaError.value = err.response?.data?.error || 'Failed to save selection'
    } finally {
      metaLoading.value = false
    }
  }

  async function disconnectMeta() {
    metaLoading.value = true
    try {
      await axios.delete('/api/credentials/meta')
      await fetchStatuses()
    } catch (err) {
      console.error('Meta disconnect error:', err)
    } finally {
      metaLoading.value = false
    }
  }

  async function saveFbPageSelection(selectedPageIds: string[]) {
    metaLoading.value = true
    try {
      await axios.post('/api/credentials/facebook/pages', { selectedPageIds })
      allFbPages.value = allFbPages.value.map((p) => ({ ...p, selected: selectedPageIds.includes(p.id) }))
      connectedPages.value = allFbPages.value.filter((p) => p.selected)
    } catch (err: any) {
      metaError.value = err.response?.data?.error || 'Failed to save page selection'
    } finally {
      metaLoading.value = false
    }
  }

  async function saveIgAccountSelection(selectedAccountIds: string[]) {
    metaLoading.value = true
    try {
      await axios.post('/api/credentials/instagram/accounts', { selectedAccountIds })
      allIgAccounts.value = allIgAccounts.value.map((a) => ({ ...a, selected: selectedAccountIds.includes(a.id) }))
      connectedIgAccounts.value = allIgAccounts.value.filter((a) => a.selected)
    } catch (err: any) {
      metaError.value = err.response?.data?.error || 'Failed to save account selection'
    } finally {
      metaLoading.value = false
    }
  }

  return {
    statuses, loading, fetchStatuses, getStatus, isConnected,
    metaCredentials, metaDiscovery, metaLoading, metaError,
    connectedPages, connectedIgAccounts, allFbPages, allIgAccounts,
    fetchMetaConnections, fetchMetaCredentials, saveMetaApp, startMetaOAuth,
    fetchMetaDiscovery, saveMetaSelection, disconnectMeta,
    saveFbPageSelection, saveIgAccountSelection,
    tokenExpiry, expiringAccounts, hasExpiryWarning,
    fetchTokenExpiry, dismissTokenWarning, refreshMetaTokens,
    pinterestCredentials, pinterestLoading, pinterestError,
    connectedPinterestBoards, allPinterestBoards,
    fetchPinterestCredentials, savePinterestApp, startPinterestOAuth,
    savePinterestBoards, disconnectPinterest,
    tiktokCredentials, tiktokLoading, tiktokError, tiktokConnected, tiktokUsername,
    fetchTikTokCredentials, saveTikTokApp, startTikTokOAuth, disconnectTikTok,
  }
})
