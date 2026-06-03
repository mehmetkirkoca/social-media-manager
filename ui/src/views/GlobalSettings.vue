<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto space-y-8">

      <div>
        <h1 class="text-2xl font-bold mb-1">{{ $t('globalSettings.title') }}</h1>
        <p class="text-sm text-gray-400">{{ $t('globalSettings.subtitle') }}</p>
      </div>

      <!-- ═══ FACEBOOK & INSTAGRAM APP CREDENTIALS ═════════════════════════════ -->
      <div id="meta-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="flex gap-1.5">
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#1877F2">f</span>
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E1306C">I</span>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.meta.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="metaAppConfigured && !editingMetaApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.meta.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.metaCredentials.appId }})</span>
            </div>
            <button @click="editingMetaApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">
              Edit
            </button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appIdLabel') }}</label>
              <input v-model="metaAppId" type="text" :placeholder="$t('settings.meta.appIdPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appSecretLabel') }}</label>
              <input v-model="metaAppSecret" type="password"
                :placeholder="metaAppConfigured ? platformsStore.metaCredentials.appSecretHint : $t('settings.meta.appSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                {{ $t('settings.meta.getAppHelp') }}
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" class="text-blue-400 hover:text-blue-300 underline">{{ $t('settings.meta.devPortal') }}</a>
              </p>
              <button @click="saveMetaApp" :disabled="!metaAppId || !metaAppSecret || platformsStore.metaLoading"
                class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.metaLoading ? $t('settings.meta.saving') : $t('settings.meta.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ PINTEREST APP CREDENTIALS ════════════════════════════════════════ -->
      <div id="pinterest-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E60023">P</span>
          <div>
            <p class="font-semibold">{{ $t('settings.pinterest.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="pinterestAppConfigured && !editingPinterestApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.pinterest.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.pinterestCredentials.clientId }})</span>
            </div>
            <button @click="editingPinterestApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.pinterest.clientIdLabel') }}</label>
              <input v-model="pinterestClientId" type="text" :placeholder="$t('settings.pinterest.clientIdPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-red-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.pinterest.clientSecretLabel') }}</label>
              <input v-model="pinterestClientSecret" type="password"
                :placeholder="pinterestAppConfigured ? platformsStore.pinterestCredentials.clientSecretHint : $t('settings.pinterest.clientSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-red-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noopener" class="text-red-400 hover:text-red-300 underline">{{ $t('settings.pinterest.devPortal') }}</a>
              </p>
              <button @click="savePinterestApp" :disabled="!pinterestClientId || !pinterestClientSecret || platformsStore.pinterestLoading"
                class="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.pinterestLoading ? $t('settings.pinterest.saving') : $t('settings.pinterest.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ TIKTOK APP CREDENTIALS ════════════════════════════════════════════ -->
      <div id="tiktok-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#EE1D52">T</span>
          <div>
            <p class="font-semibold">{{ $t('settings.tiktok.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="tiktokAppConfigured && !editingTikTokApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.tiktok.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.tiktokCredentials.clientKey }})</span>
            </div>
            <button @click="editingTikTokApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.tiktok.clientKeyLabel') }}</label>
              <input v-model="tiktokClientKey" type="text" :placeholder="$t('settings.tiktok.clientKeyPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-pink-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.tiktok.clientSecretLabel') }}</label>
              <input v-model="tiktokClientSecret" type="password"
                :placeholder="tiktokAppConfigured ? platformsStore.tiktokCredentials.clientSecretHint : $t('settings.tiktok.clientSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-pink-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                <a href="https://developers.tiktok.com/" target="_blank" rel="noopener" class="text-pink-400 hover:text-pink-300 underline">{{ $t('settings.tiktok.devPortal') }}</a>
              </p>
              <button @click="saveTikTokApp" :disabled="!tiktokClientKey || !tiktokClientSecret || platformsStore.tiktokLoading"
                class="px-4 py-1.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.tiktokLoading ? $t('settings.tiktok.saving') : $t('settings.tiktok.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ AI INTEGRATION — Ollama ══════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-white text-sm font-bold shrink-0">AI</div>
          <div>
            <p class="font-semibold">{{ $t('ai.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('ai.sectionSubtitle') }}</p>
          </div>
          <div class="ml-auto flex items-center gap-2 shrink-0">
            <span v-if="aiStore.config.provider === 'ollama'" class="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-900/50 text-violet-300 border border-violet-700">{{ $t('ai.active') }}</span>
            <span v-if="aiConnected !== null" class="text-xs px-2 py-0.5 rounded-full font-medium" :class="aiConnected ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/40 text-red-400 border border-red-800'">
              {{ aiConnected ? $t('ai.connected') : $t('ai.connectionFailed') }}
            </span>
          </div>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.endpointLabel') }}</label>
            <div class="flex gap-2">
              <input v-model="aiEndpoint" type="text" :placeholder="$t('ai.endpointPlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
              <button @click="testAiConnection" :disabled="aiStore.modelsLoading || !aiEndpoint"
                class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded-lg text-xs font-medium transition-colors whitespace-nowrap">
                {{ aiStore.modelsLoading ? $t('ai.testing') : $t('ai.testConnection') }}
              </button>
            </div>
            <p class="text-xs text-gray-600 mt-1">{{ $t('ai.endpointHint') }}</p>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
            <select v-model="aiModel" :disabled="!aiModels.length"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500 disabled:opacity-40">
              <option value="">{{ $t('ai.modelPlaceholder') }}</option>
              <option v-for="m in aiModels" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.visionModelLabel') }}</label>
            <input v-model="aiVisionModel" type="text" :placeholder="$t('ai.visionModelPlaceholder')"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
            <p class="text-xs text-gray-600 mt-1">{{ $t('ai.visionModelHint') }}</p>
          </div>
          <div class="flex items-center justify-end gap-3">
            <span v-if="aiSaved" class="text-xs text-green-400">{{ $t('ai.saved') }}</span>
            <button @click="saveAiConfig" :disabled="aiStore.saving || !aiEndpoint"
              class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
              {{ aiStore.saving ? $t('ai.saving') : $t('ai.saveConfig') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ AI PROVIDERS — OpenAI, Groq, Gemini ═══════════════════════════════ -->
      <template v-for="providerName in ['openai', 'groq', 'gemini']" :key="providerName">
        <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div class="p-5 border-b border-gray-800 flex items-center gap-3">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              :class="providerName === 'openai' ? 'bg-emerald-700' : providerName === 'groq' ? 'bg-orange-700' : 'bg-blue-700'">
              {{ providerName === 'openai' ? 'OAI' : providerName === 'groq' ? 'GRQ' : 'GEM' }}
            </div>
            <div>
              <p class="font-semibold">{{ $t(`ai.${providerName}.sectionTitle`) }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ $t(`ai.${providerName}.sectionSubtitle`) }}</p>
            </div>
            <div class="ml-auto flex items-center gap-2 shrink-0">
              <span v-if="aiStore.config.provider === providerName" class="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-900/50 text-violet-300 border border-violet-700">{{ $t('ai.active') }}</span>
              <span v-else-if="getProvider(providerName)?.configured" class="text-xs px-2 py-0.5 rounded-full font-medium bg-green-900/50 text-green-400 border border-green-700">✓ {{ $t('ai.apiKeyConfigured') }}</span>
            </div>
          </div>
          <div class="p-5 space-y-4">
            <div v-if="getProvider(providerName)?.configured && !providerForms[providerName].editing">
              <div class="flex items-center justify-between text-sm">
                <div class="space-y-1">
                  <p class="text-xs text-gray-400">{{ $t('ai.apiKeyLabel') }}: <span class="font-mono text-gray-300">{{ getProvider(providerName)?.apiKeyHint }}</span></p>
                  <p v-if="providerForms[providerName].saved" class="text-xs text-green-400">{{ $t('ai.providerSaved') }}</p>
                </div>
                <div class="flex gap-2">
                  <button @click="providerForms[providerName].editing = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
                  <button v-if="aiStore.config.provider !== providerName" @click="setActiveProvider(providerName)" :disabled="aiStore.saving"
                    class="text-xs px-2.5 py-1 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-md text-white transition-colors">
                    {{ $t('ai.setAsActive') }}
                  </button>
                  <button @click="disconnectCloudProvider(providerName)" class="text-xs px-2.5 py-1 bg-red-900/40 hover:bg-red-900/60 border border-red-800 rounded-md text-red-400 hover:text-red-300 transition-colors">{{ $t('ai.disconnect') }}</button>
                </div>
              </div>
              <div class="mt-3">
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
                <select v-model="providerForms[providerName].model" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500">
                  <option v-for="m in (PROVIDER_MODELS[providerName] || [])" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="flex justify-end mt-3">
                <button @click="saveCloudProvider(providerName, aiStore.config.provider === providerName)" :disabled="providerForms[providerName].saving"
                  class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.saveProvider') }}
                </button>
              </div>
            </div>
            <div v-else class="space-y-3">
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.apiKeyLabel') }}</label>
                <input v-model="providerForms[providerName].apiKey" type="password" :placeholder="$t('ai.apiKeyPlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                <p class="text-xs text-gray-600 mt-1">{{ $t(`ai.${providerName}.getKeyHint`) }}</p>
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
                <select v-model="providerForms[providerName].model" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500">
                  <option v-for="m in (PROVIDER_MODELS[providerName] || [])" :key="m" :value="m">{{ m }}</option>
                </select>
              </div>
              <div class="flex items-center justify-end gap-2">
                <button v-if="providerForms[providerName].editing" @click="providerForms[providerName].editing = false" class="text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors">Cancel</button>
                <button @click="saveCloudProvider(providerName, false)" :disabled="providerForms[providerName].saving || !providerForms[providerName].apiKey"
                  class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded-lg text-xs font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.saveProvider') }}
                </button>
                <button @click="saveCloudProvider(providerName, true)" :disabled="providerForms[providerName].saving || !providerForms[providerName].apiKey"
                  class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.connectAndActivate') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ═══ GOOGLE PLACES ═════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-green-700 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-location-dot text-white text-sm"></i>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.googlePlaces.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.googlePlaces.sectionSubtitle') }}</p>
          </div>
        </div>
        <div class="p-5 space-y-4">
          <div v-if="placesConfigured" class="flex items-center justify-between">
            <span class="text-sm text-gray-300">{{ $t('settings.googlePlaces.keyConfigured', { hint: placesKeyHint }) }}</span>
            <button @click="removePlacesKey" class="text-xs px-3 py-1.5 border border-red-800/60 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">{{ $t('settings.googlePlaces.disconnect') }}</button>
          </div>
          <div v-else class="space-y-3">
            <p class="text-xs text-gray-500">{{ $t('settings.googlePlaces.getKeyHint') }}</p>
            <div class="flex gap-2">
              <input v-model="placesApiKey" type="password" :placeholder="$t('settings.googlePlaces.keyPlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500" />
              <button @click="savePlacesKey" :disabled="!placesApiKey.trim() || placesSaving"
                class="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors">
                {{ placesSaving ? $t('settings.googlePlaces.saving') : $t('settings.googlePlaces.save') }}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore } from '../stores/platforms'
import { useAiStore, PROVIDER_MODELS } from '../stores/ai'

const { t } = useI18n()
const platformsStore = usePlatformsStore()
const aiStore = useAiStore()

// ─── Meta app credentials ─────────────────────────────────────────────────────
const metaAppId = ref('')
const metaAppSecret = ref('')
const editingMetaApp = ref(false)
const metaAppConfigured = computed(() => platformsStore.metaCredentials.configured)

async function saveMetaApp() {
  await platformsStore.saveMetaApp(metaAppId.value, metaAppSecret.value)
  if (!platformsStore.metaError) {
    editingMetaApp.value = false
    metaAppSecret.value = ''
  }
}

// ─── Pinterest app credentials ────────────────────────────────────────────────
const pinterestClientId = ref('')
const pinterestClientSecret = ref('')
const editingPinterestApp = ref(false)
const pinterestAppConfigured = computed(() => platformsStore.pinterestCredentials.configured)

async function savePinterestApp() {
  await platformsStore.savePinterestApp(pinterestClientId.value, pinterestClientSecret.value)
  if (!platformsStore.pinterestError) {
    editingPinterestApp.value = false
    pinterestClientSecret.value = ''
  }
}

// ─── TikTok app credentials ───────────────────────────────────────────────────
const tiktokClientKey = ref('')
const tiktokClientSecret = ref('')
const editingTikTokApp = ref(false)
const tiktokAppConfigured = computed(() => platformsStore.tiktokCredentials.configured)

async function saveTikTokApp() {
  await platformsStore.saveTikTokApp(tiktokClientKey.value, tiktokClientSecret.value)
  if (!platformsStore.tiktokError) {
    editingTikTokApp.value = false
    tiktokClientSecret.value = ''
  }
}

// ─── Google Places ────────────────────────────────────────────────────────────
const placesApiKey = ref('')
const placesConfigured = ref(false)
const placesKeyHint = ref<string | null>(null)
const placesSaving = ref(false)

async function loadPlacesConfig() {
  try {
    const res = await axios.get('/api/credentials/google-places')
    placesConfigured.value = res.data.configured
    placesKeyHint.value = res.data.keyHint
  } catch { /* not configured */ }
}

async function savePlacesKey() {
  if (!placesApiKey.value.trim()) return
  placesSaving.value = true
  try {
    await axios.post('/api/credentials/google-places', { apiKey: placesApiKey.value.trim() })
    placesConfigured.value = true
    placesKeyHint.value = `****${placesApiKey.value.trim().slice(-4)}`
    placesApiKey.value = ''
  } finally {
    placesSaving.value = false
  }
}

async function removePlacesKey() {
  if (!confirm(t('settings.googlePlaces.disconnectConfirm'))) return
  await axios.delete('/api/credentials/google-places')
  placesConfigured.value = false
  placesKeyHint.value = null
}

// ─── AI Configuration — Ollama ────────────────────────────────────────────────
const aiEndpoint = ref('')
const aiModel = ref('')
const aiVisionModel = ref('')
const aiModels = computed(() => aiStore.models)
const aiConnected = ref<boolean | null>(null)
const aiSaved = ref(false)

async function testAiConnection() {
  const ok = await aiStore.fetchModels(aiEndpoint.value)
  aiConnected.value = ok
  if (ok && !aiModel.value && aiStore.models.length) aiModel.value = aiStore.models[0]
}

async function saveAiConfig() {
  const ok = await aiStore.saveProvider('ollama', { endpoint: aiEndpoint.value, model: aiModel.value, visionModel: aiVisionModel.value, setActive: true })
  if (ok) {
    aiSaved.value = true
    setTimeout(() => { aiSaved.value = false }, 2500)
  }
}

// ─── Cloud AI providers ───────────────────────────────────────────────────────
interface ProviderFormState {
  apiKey: string; model: string; editing: boolean; saving: boolean; saved: boolean
}

const providerForms = ref<Record<string, ProviderFormState>>({
  openai: { apiKey: '', model: '', editing: false, saving: false, saved: false },
  groq:   { apiKey: '', model: '', editing: false, saving: false, saved: false },
  gemini: { apiKey: '', model: '', editing: false, saving: false, saved: false },
})

function getProvider(name: string) {
  return aiStore.providers.find((p) => p.name === name)
}

async function saveCloudProvider(name: string, setActive = false) {
  const form = providerForms.value[name]
  form.saving = true
  const ok = await aiStore.saveProvider(name, { apiKey: form.apiKey || undefined, model: form.model || undefined, setActive })
  form.saving = false
  if (ok) {
    form.saved = true
    form.editing = false
    form.apiKey = ''
    setTimeout(() => { form.saved = false }, 2500)
  }
}

async function setActiveProvider(name: string) {
  if (!getProvider(name)?.configured) return
  await aiStore.saveProvider(name, { setActive: true })
}

async function disconnectCloudProvider(name: string) {
  if (!confirm(t('ai.disconnectConfirm'))) return
  await aiStore.deleteProvider(name)
}

// ─── On mount ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    platformsStore.fetchMetaCredentials(),
    platformsStore.fetchPinterestCredentials(),
    platformsStore.fetchTikTokCredentials(),
    aiStore.fetchConfig(),
    aiStore.fetchProviders(),
    loadPlacesConfig(),
  ])
  aiEndpoint.value = aiStore.config.endpoint
  aiModel.value = aiStore.config.model
  aiVisionModel.value = aiStore.config.visionModel
  for (const p of aiStore.providers) {
    if (p.name === 'ollama') continue
    const form = providerForms.value[p.name]
    if (form) form.model = p.model || ''
  }
})
</script>
