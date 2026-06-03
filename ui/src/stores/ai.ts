import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface AiConfig {
  provider: string
  endpoint: string
  model: string
  visionModel: string
  enabled: boolean
}

export interface ProviderInfo {
  name: string
  configured: boolean
  active: boolean
  model: string
  // ollama-specific
  endpoint?: string
  visionModel?: string
  // cloud-specific
  apiKeyHint?: string | null
}

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  groq:   ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
}

export const useAiStore = defineStore('ai', () => {
  const config = ref<AiConfig>({
    provider: 'ollama',
    endpoint: 'http://ollama:11434',
    model: 'llama3.2',
    visionModel: 'llava',
    enabled: true,
  })
  const providers = ref<ProviderInfo[]>([])
  const models = ref<string[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const modelsLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchConfig() {
    try {
      const res = await axios.get('/api/ai/config')
      config.value = res.data
    } catch (err) {
      console.error('AI config fetch error:', err)
    }
  }

  async function fetchProviders() {
    try {
      const res = await axios.get('/api/ai/providers')
      providers.value = res.data.providers || []
      // Keep config.provider in sync with the active provider
      const active = res.data.active
      if (active) config.value.provider = active
    } catch (err) {
      console.error('AI providers fetch error:', err)
    }
  }

  async function saveProvider(
    name: string,
    payload: { apiKey?: string; model?: string; endpoint?: string; visionModel?: string; setActive?: boolean },
  ): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      await axios.put(`/api/ai/provider/${name}`, payload)
      await fetchProviders()
      if (payload.setActive) config.value.provider = name
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || `Failed to save ${name} config`
      return false
    } finally {
      saving.value = false
    }
  }

  async function deleteProvider(name: string): Promise<boolean> {
    try {
      await axios.delete(`/api/ai/provider/${name}`)
      await fetchProviders()
      if (config.value.provider === name) config.value.provider = 'ollama'
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || `Failed to disconnect ${name}`
      return false
    }
  }

  async function fetchProviderModels(name: string, payload?: { apiKey?: string; endpoint?: string }): Promise<string[]> {
    try {
      const res = await axios.post(`/api/ai/provider/${name}/models`, payload || {})
      return res.data.models || []
    } catch {
      return []
    }
  }

  async function saveConfig(updates: Partial<AiConfig>): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      const merged = { ...config.value, ...updates }
      await axios.put('/api/ai/config', merged)
      config.value = merged
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to save config'
      return false
    } finally {
      saving.value = false
    }
  }

  async function fetchModels(overrideEndpoint?: string): Promise<boolean> {
    modelsLoading.value = true
    error.value = null
    try {
      const params = overrideEndpoint ? { endpoint: overrideEndpoint } : {}
      const res = await axios.get('/api/ai/models', { params })
      models.value = res.data.models || []
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Could not connect to Ollama'
      models.value = []
      return false
    } finally {
      modelsLoading.value = false
    }
  }

  async function generate(prompt: string, system?: string, model?: string): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const res = await axios.post('/api/ai/generate', { prompt, system, model })
      return res.data.text as string
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Generation failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function generateCaption(imageUrl: string): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const res = await axios.post('/api/ai/caption', {
        imageUrl,
        model: config.value.visionModel,
      })
      return res.data.caption as string
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Caption generation failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function* streamGenerate(
    prompt: string,
    system?: string,
    model?: string,
    signal?: AbortSignal,
    useCompetitorContext?: boolean,
    destinations?: { platform: string; key: string }[],
    useResearchBrief?: boolean,
    accountKey?: string,
  ): AsyncGenerator<string> {
    const response = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system, model, useCompetitorContext, destinations, useResearchBrief, accountKey }),
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Stream request failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6)
        try {
          const parsed = JSON.parse(payload) as { token?: string; done?: boolean; error?: string }
          if (parsed.error) throw new Error(parsed.error)
          if (parsed.token) yield parsed.token
          if (parsed.done) return
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  }

  return {
    config, providers, models, loading, saving, modelsLoading, error,
    fetchConfig, fetchProviders, saveProvider, deleteProvider, fetchProviderModels,
    saveConfig, fetchModels, generate, generateCaption, streamGenerate,
  }
})
