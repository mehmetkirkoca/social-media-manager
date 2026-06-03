<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="max-w-5xl mx-auto px-6 py-8">

      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-white">{{ $t('calendarPlan.title') }}</h1>
        <p class="text-sm text-gray-500 mt-1">{{ $t('calendarPlan.subtitle') }}</p>
      </div>

      <!-- Configuration card -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <!-- Month -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.month') }}</label>
            <input
              v-model="selectedMonth"
              type="month"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500"
            />
          </div>

          <!-- Account -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.account') }}</label>
            <select
              v-model="selectedAccount"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500"
            >
              <option value="">{{ $t('calendarPlan.allAccounts') }}</option>
              <option v-for="acc in connectedAccounts" :key="acc.key" :value="acc.key">{{ acc.label }}</option>
            </select>
          </div>

          <!-- Posts per week -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.postsPerWeek') }}</label>
            <div class="flex items-center gap-2">
              <button
                @click="postsPerWeek = Math.max(1, postsPerWeek - 1)"
                class="w-8 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-lg font-medium transition-colors"
              >−</button>
              <span class="flex-1 text-center text-sm font-semibold text-white">{{ postsPerWeek }}</span>
              <button
                @click="postsPerWeek = Math.min(7, postsPerWeek + 1)"
                class="w-8 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-lg font-medium transition-colors"
              >+</button>
            </div>
            <p class="text-[11px] text-gray-600 mt-1 text-center">
              {{ $t('calendarPlan.postsPerWeekHint', { total: postsPerWeek * 4, grand: Math.min(selectedPlatforms.length * postsPerWeek * 4, 60) }) }}
            </p>
          </div>
        </div>

        <!-- Platform checkboxes + action buttons row -->
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex-1 min-w-0">
            <label class="block text-xs text-gray-400 mb-2">{{ $t('calendarPlan.platforms') }}</label>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="p in PLATFORMS"
                :key="p.key"
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors"
                :class="selectedPlatforms.includes(p.key)
                  ? 'text-white border-transparent'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'"
                :style="selectedPlatforms.includes(p.key) ? { background: p.color + '33', borderColor: p.color } : {}"
              >
                <input type="checkbox" class="sr-only" :value="p.key" v-model="selectedPlatforms" />
                <i :class="p.icon" class="text-[11px]"></i>
                {{ p.label }}
              </label>
            </div>
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              @click="generateBrief"
              :disabled="briefLoading || loading || !selectedPlatforms.length"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <i class="fa-solid fa-file-lines text-xs" :class="{ 'animate-pulse': briefLoading }"></i>
              {{ briefLoading ? $t('calendarPlan.generatingBrief') : $t('calendarPlan.generateBrief') }}
            </button>
            <button
              @click="generate"
              :disabled="loading || !selectedPlatforms.length"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <i class="fa-solid fa-calendar-days text-xs" :class="{ 'animate-pulse': loading }"></i>
              {{ loading ? $t('calendarPlan.generating') : $t('calendarPlan.generate') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Brief preview (approval step) -->
      <div v-if="pendingBrief && !calendar" class="bg-gray-900 border border-sky-800/50 rounded-2xl p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-file-lines text-sky-400 text-sm"></i>
            <h2 class="font-semibold text-white">{{ $t('calendarPlan.briefPreviewTitle') }}</h2>
            <span class="text-xs text-gray-500">{{ pendingBriefMonthName }}</span>
          </div>
          <div class="flex gap-2">
            <button
              @click="generateBrief"
              :disabled="briefLoading"
              class="flex items-center gap-1.5 text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-lg text-gray-200 transition-colors"
            >
              <i class="fa-solid fa-rotate-right text-[10px]" :class="{ 'animate-spin': briefLoading }"></i>
              {{ $t('calendarPlan.regenerateBrief') }}
            </button>
            <button
              @click="approveAndGenerate"
              :disabled="loading"
              class="flex items-center gap-1.5 text-sm px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-lg text-white font-medium transition-colors"
            >
              <i class="fa-solid fa-check text-xs" :class="{ 'animate-pulse': loading }"></i>
              {{ loading ? $t('calendarPlan.generating') : $t('calendarPlan.approveBrief') }}
            </button>
          </div>
        </div>

        <div class="p-4 bg-sky-950/40 border border-sky-800/30 rounded-xl mb-4">
          <div class="text-xs text-sky-400 font-medium mb-1">{{ $t('calendarPlan.theme') }}</div>
          <p class="text-sm text-gray-200">{{ pendingBrief.theme }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div v-if="pendingBrief.pillars?.length">
            <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.pillars') }}</div>
            <ul class="space-y-1">
              <li v-for="p in pendingBrief.pillars" :key="p" class="flex gap-1.5 text-xs text-gray-300">
                <span class="text-sky-400">▪</span>{{ p }}
              </li>
            </ul>
          </div>
          <div v-if="pendingBrief.toneGuidance">
            <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.toneGuidance') }}</div>
            <p class="text-xs text-gray-300 italic">{{ pendingBrief.toneGuidance }}</p>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">
        {{ error }}
      </div>

      <!-- Calendar results -->
      <div v-if="calendar">
        <!-- Narrative brief -->
        <div class="bg-gray-900 border border-violet-800/40 rounded-2xl p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="font-semibold text-white">{{ $t('calendarPlan.briefTitle') }}</h2>
              <p class="text-xs text-gray-500 mt-0.5">{{ calendar.monthName }}</p>
            </div>
            <div class="flex gap-2">
              <button
                @click="exportCalendarCsv"
                class="flex items-center gap-1.5 text-sm px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors"
              >
                <i class="fa-solid fa-file-csv text-xs"></i>
                {{ $t('calendarPlan.exportCsv') }}
              </button>
              <button
                @click="saveAllDrafts"
                :disabled="savingAll"
                class="flex items-center gap-1.5 text-sm px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg text-white transition-colors"
              >
                <i class="fa-solid fa-floppy-disk text-xs"></i>
                {{ savingAll ? $t('calendarPlan.savingAll') : $t('calendarPlan.saveAllDraftsScheduled', { count: calendar.posts.length }) }}
              </button>
            </div>
          </div>

          <div class="p-4 bg-gray-800/50 rounded-xl mb-4">
            <div class="text-xs text-violet-400 font-medium mb-1">{{ $t('calendarPlan.theme') }}</div>
            <p class="text-sm text-gray-200">{{ calendar.brief.theme }}</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.pillars') }}</div>
              <ul class="space-y-1">
                <li v-for="p in calendar.brief.pillars" :key="p" class="flex gap-1.5 text-xs text-gray-300">
                  <span class="text-violet-400">▪</span>{{ p }}
                </li>
              </ul>
            </div>
            <div v-if="calendar.brief.toneGuidance">
              <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.toneGuidance') }}</div>
              <p class="text-xs text-gray-300 italic">{{ calendar.brief.toneGuidance }}</p>
            </div>
          </div>
        </div>

        <!-- Posts by platform -->
        <div class="space-y-4">
          <div
            v-for="platform in calendar.platforms"
            :key="platform"
            class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
          >
            <!-- Platform header -->
            <div class="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
              <i :class="platformIcon(platform)" class="text-sm" :style="{ color: platformColor(platform) }"></i>
              <span class="font-medium text-sm capitalize">{{ platform }}</span>
              <span v-if="calendar.brief.platformNotes?.[platform]" class="text-xs text-gray-500 ml-2 italic">{{ calendar.brief.platformNotes[platform] }}</span>
            </div>

            <!-- Posts for this platform -->
            <div class="divide-y divide-gray-800/60">
              <div
                v-for="post in postsForPlatform(platform)"
                :key="post.week + post.content.slice(0, 20)"
                class="p-4"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-xs text-gray-500">{{ $t('calendarPlan.week', { n: post.week }) }}</span>
                      <span v-if="post.suggestedDay" class="text-xs text-gray-500">· {{ post.suggestedDay }}</span>
                      <span v-if="post.suggestedTime" class="text-xs text-gray-500">{{ $t('calendarPlan.at') }} {{ post.suggestedTime }}</span>
                      <span
                        class="text-xs px-1.5 py-0.5 rounded capitalize"
                        :class="{
                          'bg-blue-900/40 text-blue-300': post.postType === 'educational',
                          'bg-violet-900/40 text-violet-300': post.postType === 'promotional',
                          'bg-green-900/40 text-green-300': post.postType === 'engagement',
                          'bg-amber-900/40 text-amber-300': post.postType === 'storytelling',
                        }"
                      >{{ post.postType }}</span>
                    </div>
                    <p class="text-sm text-gray-200 mb-2 whitespace-pre-line leading-relaxed">{{ post.content }}</p>
                    <div v-if="post.hashtags?.length" class="flex flex-wrap gap-1">
                      <span v-for="tag in post.hashtags" :key="tag" class="text-xs text-emerald-400 font-mono">{{ tag }}</span>
                    </div>
                  </div>
                  <button
                    @click="draftPost(post)"
                    class="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded-lg"
                  >
                    <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                    {{ $t('calendarPlan.draft') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'
import { useComposeStore } from '../stores/compose'

const router = useRouter()
const platformsStore = usePlatformsStore()
const composeStore = useComposeStore()

const PLATFORMS = [
  { key: 'linkedin',  label: 'LinkedIn',   color: '#0077B5', icon: 'fa-brands fa-linkedin' },
  { key: 'instagram', label: 'Instagram',  color: '#E1306C', icon: 'fa-brands fa-instagram' },
  { key: 'facebook',  label: 'Facebook',   color: '#1877F2', icon: 'fa-brands fa-facebook' },
  { key: 'twitter',   label: 'Twitter/X',  color: '#000000', icon: 'fa-brands fa-x-twitter' },
  { key: 'tiktok',    label: 'TikTok',     color: '#EE1D52', icon: 'fa-brands fa-tiktok' },
  { key: 'pinterest', label: 'Pinterest',  color: '#E60023', icon: 'fa-brands fa-pinterest' },
  { key: 'youtube',   label: 'YouTube',    color: '#FF0000', icon: 'fa-brands fa-youtube' },
  { key: 'mastodon',  label: 'Mastodon',   color: '#6364FF', icon: 'fa-brands fa-mastodon' },
  { key: 'bluesky',   label: 'Bluesky',    color: '#0085FF', icon: 'fa-brands fa-bluesky' },
  { key: 'reddit',    label: 'Reddit',     color: '#FF4500', icon: 'fa-brands fa-reddit' },
]

const selectedMonth   = ref(new Date().toISOString().slice(0, 7))
const selectedAccount = ref('')
const selectedPlatforms = ref<string[]>(['linkedin', 'instagram'])
const postsPerWeek = ref(3)
const loading    = ref(false)
const savingAll  = ref(false)
const error      = ref('')
const calendar   = ref<any>(null)

const briefLoading       = ref(false)
const pendingBrief       = ref<any>(null)
const pendingBriefMonthName = ref('')

interface ProfileAccount { key: string; label: string }
const connectedAccounts = computed((): ProfileAccount[] => {
  const list: ProfileAccount[] = []
  for (const [platform] of Object.entries(PLATFORM_META)) {
    if (['facebook', 'instagram', 'pinterest', 'tiktok'].includes(platform)) continue
    if (platformsStore.isConnected(platform)) {
      list.push({ key: platform, label: platform.charAt(0).toUpperCase() + platform.slice(1) })
    }
  }
  for (const page of platformsStore.connectedPages) {
    list.push({ key: `facebook:${page.id}`, label: page.name })
  }
  for (const acc of platformsStore.connectedIgAccounts) {
    list.push({ key: `instagram:${acc.id}`, label: `@${acc.username}` })
  }
  return list
})

function platformColor(p: string): string {
  return PLATFORMS.find((x) => x.key === p)?.color ?? '#6b7280'
}
function platformIcon(p: string): string {
  return PLATFORMS.find((x) => x.key === p)?.icon ?? 'fa-solid fa-globe'
}

function postsForPlatform(platform: string) {
  return (calendar.value?.posts ?? []).filter((p: any) => p.platform === platform)
}

async function generateBrief() {
  if (!selectedPlatforms.value.length) return
  briefLoading.value = true
  error.value = ''
  calendar.value = null
  try {
    const res = await axios.post('/api/ai/content-brief', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
    })
    pendingBrief.value = res.data.brief
    pendingBriefMonthName.value = res.data.monthName
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Brief generation failed'
  } finally {
    briefLoading.value = false
  }
}

async function approveAndGenerate() {
  if (!pendingBrief.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await axios.post('/api/ai/content-calendar', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
      approvedBrief: pendingBrief.value,
      postsPerWeek: postsPerWeek.value,
    })
    calendar.value = res.data
    pendingBrief.value = null
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Calendar generation failed'
  } finally {
    loading.value = false
  }
}

async function generate() {
  if (!selectedPlatforms.value.length) return
  loading.value = true
  error.value = ''
  pendingBrief.value = null
  try {
    const res = await axios.post('/api/ai/content-calendar', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
      postsPerWeek: postsPerWeek.value,
    })
    calendar.value = res.data
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Calendar generation failed'
  } finally {
    loading.value = false
  }
}

function computeScheduledDate(month: string, week: number, suggestedDay: string, suggestedTime: string): string {
  const DAY_MAP: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
  const firstDay = new Date(month + '-01')
  const targetDow = DAY_MAP[suggestedDay] ?? 1
  const firstDow = firstDay.getDay()
  const offset = (targetDow - firstDow + 7) % 7
  const d = new Date(firstDay)
  d.setDate(1 + offset + (week - 1) * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${suggestedTime || '09:00'}`
}

function exportCalendarCsv() {
  if (!calendar.value?.posts?.length) return
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const header = ['Platform', 'Week', 'Suggested Day', 'Suggested Time', 'Post Type', 'Content', 'Hashtags']
  const rows = calendar.value.posts.map((p: any) => [
    p.platform, p.week, p.suggestedDay || '', p.suggestedTime || '', p.postType || '', escape(p.content), (p.hashtags || []).join(' '),
  ].join(','))
  const csv = '﻿' + [header.join(','), ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `content-plan-${calendar.value.month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function draftPost(post: any) {
  composeStore.content = post.content
  if (post.week && post.suggestedDay) {
    composeStore.scheduledAt = computeScheduledDate(selectedMonth.value, post.week, post.suggestedDay, post.suggestedTime || '09:00')
  }
  router.push('/compose')
}

async function saveAllDrafts() {
  if (!calendar.value?.posts?.length) return
  savingAll.value = true
  try {
    for (const post of calendar.value.posts) {
      const scheduledAt = post.week && post.suggestedDay
        ? computeScheduledDate(calendar.value.month, post.week, post.suggestedDay, post.suggestedTime || '09:00')
        : ''
      await axios.post('/api/drafts', {
        content: post.content,
        mediaUrl: '',
        scheduledAt,
        destinations: [],
      })
    }
    alert(`Saved ${calendar.value.posts.length} drafts — find them in Scheduler → Drafts.`)
  } catch {
    error.value = 'Failed to save some drafts'
  } finally {
    savingAll.value = false
  }
}

onMounted(() => {
  platformsStore.fetchMetaConnections()
})
</script>
