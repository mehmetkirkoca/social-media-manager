<template>
  <div class="h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-100">

    <!-- Header + tabs — always constrained, never scrolls -->
    <div class="flex-shrink-0 max-w-3xl mx-auto w-full px-6 pt-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">{{ $t('scheduler.title') }}</h1>
        <router-link
          to="/compose"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          {{ $t('scheduler.newSchedule') }}
        </router-link>
      </div>

      <div class="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        <button
          v-for="tab in modeTabs"
          :key="tab.value"
          @click="mode = tab.value"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
          :class="mode === tab.value ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ tab.label }}
          <span v-if="tab.badge" class="text-xs bg-gray-600 px-1.5 py-0.5 rounded-full">{{ tab.badge }}</span>
        </button>
      </div>
    </div>

    <!-- ── Scheduled panel — scrollable, constrained width ── -->
    <template v-if="mode === 'scheduled'">
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <div class="max-w-3xl mx-auto">
          <div class="flex gap-2 mb-6">
            <button
              v-for="s in statusOptions"
              :key="s.value"
              @click="activeStatus = s.value"
              class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border"
              :class="activeStatus === s.value
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'border-gray-800 text-gray-500 hover:border-gray-600'"
            >
              {{ s.label }}
            </button>
          </div>

          <div v-if="loading" class="text-center text-gray-500 mt-20">
            {{ $t('dashboard.loading') }}
          </div>

          <div v-else-if="!jobs.length" class="text-center text-gray-500 mt-20">
            <p class="text-4xl mb-4">📅</p>
            <p>{{ $t('scheduler.noJobs') }}</p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="job in jobs"
              :key="job._id"
              class="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <!-- Content preview -->
                  <p class="text-sm text-gray-200 line-clamp-2 mb-2">{{ job.content || '(no content)' }}</p>
                  <!-- Media indicator -->
                  <p v-if="jobMediaUrl(job)" class="text-xs text-blue-400 mb-2 flex items-center gap-1 truncate">
                    <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
                    </svg>
                    <span class="truncate">{{ mediaName(jobMediaUrl(job)!) }}</span>
                  </p>
                  <!-- Platform chips -->
                  <div class="flex flex-wrap gap-1 mb-2">
                    <span
                      v-for="p in jobPlatformKeys(job)"
                      :key="p"
                      class="text-xs px-2 py-0.5 rounded-full"
                      :style="{ backgroundColor: platformColor(p) + '22', color: platformColor(p) }"
                    >
                      {{ $t(`platforms.${p}`) }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-500">{{ formatDate(job.scheduledAt) }}</p>
                  <!-- Per-platform results (shown after processing) -->
                  <div v-if="job.platformResults" class="mt-2 space-y-1">
                    <div
                      v-for="[key, result] in platformResultEntries(job)"
                      :key="key"
                      class="flex items-start gap-2 text-xs"
                    >
                      <span v-if="result.success" class="text-green-400 shrink-0 mt-px">✓</span>
                      <span v-else class="text-red-400 shrink-0 mt-px">✗</span>
                      <span class="text-gray-400 shrink-0">{{ result.pageName || key }}</span>
                      <span v-if="result.success && result.postId" class="text-gray-600 font-mono truncate">
                        {{ result.postId }}
                      </span>
                      <span v-if="!result.success && result.error" class="text-red-400 truncate">
                        {{ result.error }}
                      </span>
                    </div>
                  </div>
                  <!-- BullMQ failure reason -->
                  <p v-if="job.failReason" class="mt-1 text-xs text-red-400">{{ job.failReason }}</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-xs px-2 py-1 rounded-full font-medium" :class="statusClass(job.status)">
                    {{ $t(`scheduler.statuses.${job.status}`) }}
                  </span>
                  <button
                    v-if="job.status === 'pending'"
                    @click="cancelJob(job.bullJobId)"
                    class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors"
                  >
                    {{ $t('scheduler.cancel') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Calendar panel — full width, full remaining height ── -->
    <template v-else-if="mode === 'calendar'">
      <div class="flex-1 min-h-0 flex flex-col px-6 pb-6">

        <!-- Month navigation -->
        <div class="flex-shrink-0 flex items-center gap-3 mb-4">
          <button
            @click="prevMonth"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-300"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span class="text-lg font-semibold flex-1 text-center">{{ calMonthLabel }}</span>
          <button
            @click="goToToday"
            class="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 transition-colors"
          >
            {{ $t('scheduler.goToToday') }}
          </button>
          <button
            @click="nextMonth"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-300"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <!-- Week day headers -->
        <div class="flex-shrink-0 grid grid-cols-7 gap-1 mb-1">
          <div
            v-for="d in weekDays"
            :key="d"
            class="text-center text-xs font-medium text-gray-600 py-1.5"
          >
            {{ d }}
          </div>
        </div>

        <!-- Scrollable area: grid + optional day panel -->
        <div class="flex-1 min-h-0 overflow-y-auto">

          <!-- Loading skeleton -->
          <div v-if="calendarLoading" class="grid grid-cols-7 gap-1 h-full">
            <div v-for="i in 35" :key="i" class="rounded-xl bg-gray-900 animate-pulse" />
          </div>

          <template v-else>
            <!-- Calendar grid — fills full height when no day selected -->
            <div
              class="grid grid-cols-7 gap-1"
              :style="calendarGridStyle"
            >
              <div
                v-for="(day, i) in calendarDays"
                :key="i"
                @click="selectDay(day)"
                class="rounded-xl p-1.5 transition-colors border"
                :class="[
                  day.day ? 'cursor-pointer hover:bg-gray-800 hover:border-gray-700' : 'cursor-default',
                  day.isToday ? 'border-blue-600/50 bg-blue-950/20' : 'border-transparent bg-gray-900',
                  selectedDate === day.date ? 'ring-1 ring-gray-500 bg-gray-800 border-gray-700' : '',
                ]"
              >
                <template v-if="day.day">
                  <span
                    class="text-xs font-medium block mb-0.5"
                    :class="day.isToday ? 'text-blue-400' : 'text-gray-400'"
                  >
                    {{ day.day }}
                  </span>
                  <div>
                    <div
                      v-for="job in day.jobs.slice(0, 3)"
                      :key="job._id"
                      class="text-xs truncate rounded px-1 py-0.5 mt-0.5 leading-tight"
                      :style="{ backgroundColor: firstPlatformColor(job) + '2a', color: firstPlatformColor(job) }"
                    >
                      {{ formatTime(job.scheduledAt) }}
                    </div>
                    <div v-if="day.jobs.length > 3" class="text-xs text-gray-600 mt-0.5 px-1">
                      +{{ day.jobs.length - 3 }}
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Selected day detail panel -->
            <transition
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="opacity-0 translate-y-2"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div v-if="selectedDayData" class="mt-4 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <p class="text-sm font-semibold text-gray-200">{{ selectedDayLabel }}</p>
                  <button
                    @click="selectedDate = null"
                    class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-xs"
                  >
                    ✕
                  </button>
                </div>

                <div v-if="!selectedDayData.jobs.length" class="px-4 py-6 text-center text-sm text-gray-600">
                  {{ $t('scheduler.noJobsDay') }}
                </div>

                <div v-else class="divide-y divide-gray-800">
                  <div
                    v-for="job in selectedDayData.jobs"
                    :key="job._id"
                    class="px-4 py-3 flex items-start justify-between gap-4"
                  >
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-gray-500 mb-1 font-mono">{{ formatTime(job.scheduledAt) }}</p>
                      <p class="text-sm text-gray-200 line-clamp-2 mb-2">{{ job.content || '(no content)' }}</p>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="p in jobPlatformKeys(job)"
                          :key="p"
                          class="text-xs px-2 py-0.5 rounded-full"
                          :style="{ backgroundColor: platformColor(p) + '22', color: platformColor(p) }"
                        >
                          {{ $t(`platforms.${p}`) }}
                        </span>
                      </div>
                    </div>
                    <button
                      v-if="job.status === 'pending'"
                      @click="cancelCalendarJob(job.bullJobId)"
                      class="text-xs text-red-400 hover:text-red-300 flex-shrink-0 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                    >
                      {{ $t('scheduler.cancel') }}
                    </button>
                  </div>
                </div>
              </div>
            </transition>
          </template>
        </div>

      </div>
    </template>

    <!-- ── Drafts panel — scrollable, constrained width ── -->
    <template v-else>

      <!-- Drafts toolbar -->
      <div class="flex-shrink-0 max-w-3xl mx-auto w-full px-6 pb-4 flex justify-end">
        <button
          @click="openBulkModal"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 rounded-lg text-sm font-medium transition-colors"
        >
          <span class="text-base leading-none">✨</span>
          {{ $t('scheduler.bulkDraft.openButton') }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <div class="max-w-3xl mx-auto">
          <div v-if="draftsLoading" class="text-center text-gray-500 mt-20">
            {{ $t('dashboard.loading') }}
          </div>

          <div v-else-if="!drafts.length" class="text-center text-gray-500 mt-20">
            <p class="text-4xl mb-4">📝</p>
            <p>{{ $t('scheduler.noDrafts') }}</p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="draft in drafts"
              :key="draft._id"
              class="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <!-- AI batch badge -->
                  <span v-if="(draft as any).batchId" class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-800 mb-1.5">
                    ✨ AI
                  </span>
                  <p class="text-sm text-gray-200 line-clamp-2 mb-2">
                    {{ draft.content || '(no content)' }}
                  </p>
                  <p v-if="draft.mediaUrl" class="text-xs text-blue-400 mb-2 truncate">
                    <svg class="w-3 h-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
                    </svg>
                    {{ mediaName(draft.mediaUrl) }}
                  </p>
                  <div class="flex flex-wrap gap-1 mb-2">
                    <span
                      v-for="dest in selectedDests(draft)"
                      :key="dest.key"
                      class="text-xs px-2 py-0.5 rounded-full"
                      :style="{ backgroundColor: dest.color + '22', color: dest.color }"
                    >
                      {{ dest.label }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-600">{{ formatDate(draft.updatedAt) }}</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <router-link
                    :to="`/compose?draft=${draft._id}`"
                    class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors"
                  >
                    {{ $t('scheduler.editDraft') }}
                  </router-link>
                  <button
                    @click="deleteDraft(draft._id)"
                    class="text-xs px-2 py-1.5 bg-gray-700 hover:bg-red-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Bulk Draft Modal ── -->
      <Teleport to="body">
        <Transition
          enter-active-class="transition-opacity duration-200"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition-opacity duration-150"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div
            v-if="showBulkModal"
            class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            @click.self="closeBulkModal"
          >
            <div class="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">

              <!-- Header -->
              <div class="flex items-start justify-between p-5 border-b border-gray-800 flex-shrink-0">
                <div>
                  <p class="font-semibold">{{ $t('scheduler.bulkDraft.title') }}</p>
                  <p class="text-xs text-gray-500 mt-0.5">{{ $t('scheduler.bulkDraft.subtitle') }}</p>
                </div>
                <button @click="closeBulkModal" class="text-gray-500 hover:text-gray-200 text-2xl leading-none mt-0.5 ml-4">&times;</button>
              </div>

              <!-- Body -->
              <div class="flex-1 overflow-y-auto p-5 space-y-5">

                <!-- Topics -->
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('scheduler.bulkDraft.topicsLabel') }}</label>
                  <textarea
                    v-model="bulkTopics"
                    rows="6"
                    :placeholder="$t('scheduler.bulkDraft.topicsPlaceholder')"
                    :disabled="!!bulkBatchId"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none disabled:opacity-50"
                  />
                  <p class="text-xs text-gray-600 mt-1">{{ $t('scheduler.bulkDraft.topicsHint') }}</p>
                </div>

                <!-- Tone -->
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('scheduler.bulkDraft.toneLabel') }}</label>
                  <select
                    v-model="bulkTone"
                    :disabled="!!bulkBatchId"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  >
                    <option v-for="tone in BULK_TONES" :key="tone" :value="tone">
                      {{ $t(`scheduler.bulkDraft.tones.${tone}`) }}
                    </option>
                  </select>
                </div>

                <!-- Destinations -->
                <div>
                  <label class="block text-xs text-gray-500 mb-2">{{ $t('scheduler.bulkDraft.destinationsLabel') }}</label>
                  <div v-if="bulkDestinations.length" class="flex flex-wrap gap-2">
                    <button
                      v-for="dest in bulkDestinations"
                      :key="dest.key"
                      @click="!bulkBatchId && toggleBulkDest(dest.key)"
                      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                      :class="dest.selected
                        ? 'border-transparent text-white'
                        : 'border-gray-700 text-gray-400 bg-gray-800 hover:border-gray-600'"
                      :style="dest.selected ? { backgroundColor: dest.color, borderColor: dest.color } : {}"
                    >
                      <img v-if="dest.picture" :src="dest.picture" class="w-3.5 h-3.5 rounded-full object-cover" />
                      {{ dest.label }}
                    </button>
                  </div>
                  <p v-else class="text-xs text-gray-600">{{ $t('scheduler.bulkDraft.noDestinations') }}</p>
                </div>

                <!-- Progress -->
                <div v-if="bulkProgress" class="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-sm font-medium text-gray-200">{{ $t('scheduler.bulkDraft.progress') }}</p>
                    <span class="text-xs text-gray-400">{{ bulkProgress.processed }} / {{ bulkProgress.total }}</span>
                  </div>
                  <div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-3">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      :class="bulkProgress.status === 'done' ? 'bg-green-500' : bulkProgress.status === 'failed' ? 'bg-red-500' : 'bg-violet-500 animate-pulse'"
                      :style="{ width: `${bulkProgress.total ? Math.round((bulkProgress.processed / bulkProgress.total) * 100) : 0}%` }"
                    />
                  </div>
                  <p class="text-xs">
                    <span v-if="bulkProgress.status === 'done'" class="text-green-400">
                      {{ $t('scheduler.bulkDraft.statusDone', { completed: bulkProgress.completed, failed: bulkProgress.failed }) }}
                    </span>
                    <span v-else-if="bulkProgress.status === 'failed'" class="text-red-400">
                      {{ $t('scheduler.bulkDraft.statusFailed') }}
                    </span>
                    <span v-else class="text-gray-400">
                      {{ $t('scheduler.bulkDraft.statusGenerating', { count: bulkProgress.total - bulkProgress.processed }) }}
                    </span>
                  </p>
                </div>

              </div>

              <!-- Footer -->
              <div class="flex-shrink-0 p-5 border-t border-gray-800 flex items-center justify-end gap-3">
                <!-- While processing: allow dismissing to background -->
                <template v-if="bulkBatchId && bulkProgress?.status === 'processing'">
                  <button @click="closeBulkModal" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
                    {{ $t('scheduler.bulkDraft.runInBackground') }}
                  </button>
                </template>
                <!-- Done / failed / not started -->
                <template v-else>
                  <button
                    v-if="bulkProgress?.status === 'done'"
                    @click="resetBulkModal"
                    class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                  >
                    {{ $t('scheduler.bulkDraft.generateMore') }}
                  </button>
                  <button
                    v-if="bulkProgress?.status === 'done'"
                    @click="closeBulkModal"
                    class="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    {{ $t('scheduler.bulkDraft.viewDrafts') }}
                  </button>
                  <button
                    v-if="!bulkBatchId || bulkProgress?.status === 'failed'"
                    @click="submitBulkDraft"
                    :disabled="bulkLoading || !bulkTopics.trim()"
                    class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                  >
                    {{ bulkLoading ? $t('scheduler.bulkDraft.generating') : $t('scheduler.bulkDraft.generate') }}
                  </button>
                </template>
              </div>

            </div>
          </div>
        </Transition>
      </Teleport>

    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { PLATFORM_META, usePlatformsStore } from '../stores/platforms'
import { useComposeStore, type Destination } from '../stores/compose'

const { t, tm } = useI18n()
const platformsStore = usePlatformsStore()
const composeStore = useComposeStore()

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlatformResult {
  success: boolean
  postId?: string
  pageId?: string
  pageName?: string
  error?: string
}

interface ScheduledJob {
  _id: string
  postId: string
  content: string
  platforms: string[]
  destinations: { platform: string; accountId?: string; imageUrl?: string; videoUrl?: string }[]
  scheduledAt: string
  status: string
  bullJobId: string
  platformResults?: Record<string, PlatformResult>
  failReason?: string
}

interface DraftDestination {
  key: string
  platform: string
  accountId?: string
  label: string
  color: string
  selected: boolean
}

interface Draft {
  _id: string
  content: string
  mediaUrl: string
  scheduledAt: string
  destinations: DraftDestination[]
  updatedAt: string
}

interface CalendarDay {
  day: number | null
  date: string | null
  isToday: boolean
  jobs: ScheduledJob[]
}

// ── Mode ───────────────────────────────────────────────────────────────────────

const mode = ref<'scheduled' | 'calendar' | 'drafts'>('scheduled')

const modeTabs = computed(() => [
  { value: 'scheduled' as const, label: t('scheduler.scheduledTab'), badge: null },
  { value: 'calendar'  as const, label: t('scheduler.calendarTab'),  badge: null },
  { value: 'drafts'    as const, label: t('scheduler.draftsTab'),    badge: drafts.value.length || null },
])

// ── Scheduled jobs ─────────────────────────────────────────────────────────────

const jobs = ref<ScheduledJob[]>([])
const loading = ref(false)
const activeStatus = ref('pending')

const statusOptions = computed(() => [
  { value: 'pending',   label: t('scheduler.statuses.pending') },
  { value: 'published', label: t('scheduler.statuses.published') },
  { value: 'partial',   label: t('scheduler.statuses.partial') },
  { value: 'failed',    label: t('scheduler.statuses.failed') },
  { value: 'cancelled', label: t('scheduler.statuses.cancelled') },
])

async function fetchJobs() {
  loading.value = true
  try {
    const res = await axios.get(`/scheduler/jobs?status=${activeStatus.value}`)
    jobs.value = res.data.jobs || []
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function cancelJob(bullJobId: string) {
  try {
    await axios.delete(`/scheduler/jobs/${bullJobId}`)
    jobs.value = jobs.value.filter((j) => j.bullJobId !== bullJobId)
  } catch (err) {
    console.error(err)
  }
}

// ── Calendar ───────────────────────────────────────────────────────────────────

const calMonth = ref(dayjs().startOf('month'))
const selectedDate = ref<string | null>(null)
const calendarJobs = ref<ScheduledJob[]>([])
const calendarLoading = ref(false)

const weekDays = computed(() => tm('scheduler.weekDaysShort') as string[])
const calMonthNames = computed(() => tm('scheduler.months') as string[])

const calMonthLabel = computed(
  () => `${calMonthNames.value[calMonth.value.month()]} ${calMonth.value.year()}`
)

const calendarDays = computed((): CalendarDay[] => {
  const days: CalendarDay[] = []
  const daysInMonth = calMonth.value.daysInMonth()
  const firstDow = calMonth.value.day()
  const offset = (firstDow + 6) % 7   // Monday-first

  for (let i = 0; i < offset; i++) {
    days.push({ day: null, date: null, isToday: false, jobs: [] })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = calMonth.value.date(d)
    const dateStr = date.format('YYYY-MM-DD')
    days.push({
      day: d,
      date: dateStr,
      isToday: date.isSame(dayjs(), 'day'),
      jobs: calendarJobs.value.filter(
        (j) => dayjs(j.scheduledAt).format('YYYY-MM-DD') === dateStr
      ),
    })
  }
  while (days.length % 7 !== 0) {
    days.push({ day: null, date: null, isToday: false, jobs: [] })
  }
  return days
})

// Grid style: fill 100% height when no day is selected; auto otherwise (so day panel scrolls in)
const calendarGridStyle = computed(() => ({
  gridTemplateRows: `repeat(${calendarDays.value.length / 7}, 1fr)`,
  height: selectedDate.value ? 'auto' : '100%',
  minHeight: selectedDate.value ? undefined : '100%',
}))

const selectedDayData = computed(() => {
  if (!selectedDate.value) return null
  return calendarDays.value.find((d) => d.date === selectedDate.value) ?? null
})

const selectedDayLabel = computed(() => {
  if (!selectedDate.value) return ''
  const d = dayjs(selectedDate.value)
  return `${d.date()} ${calMonthNames.value[d.month()]} ${d.year()}`
})

function selectDay(day: CalendarDay) {
  if (!day.day || !day.date) return
  selectedDate.value = selectedDate.value === day.date ? null : day.date
}

function prevMonth() {
  calMonth.value = calMonth.value.subtract(1, 'month')
  selectedDate.value = null
}

function nextMonth() {
  calMonth.value = calMonth.value.add(1, 'month')
  selectedDate.value = null
}

function goToToday() {
  calMonth.value = dayjs().startOf('month')
  selectedDate.value = null
}

async function fetchCalendarJobs() {
  calendarLoading.value = true
  try {
    const res = await axios.get('/scheduler/jobs?status=pending')
    calendarJobs.value = res.data.jobs || []
  } catch (err) {
    console.error(err)
  } finally {
    calendarLoading.value = false
  }
}

async function cancelCalendarJob(bullJobId: string) {
  try {
    await axios.delete(`/scheduler/jobs/${bullJobId}`)
    calendarJobs.value = calendarJobs.value.filter((j) => j.bullJobId !== bullJobId)
  } catch (err) {
    console.error(err)
  }
}

// ── Drafts ─────────────────────────────────────────────────────────────────────

const drafts = ref<Draft[]>([])
const draftsLoading = ref(false)

async function fetchDrafts() {
  draftsLoading.value = true
  try {
    const res = await axios.get('/api/drafts')
    drafts.value = res.data.drafts || []
  } catch (err) {
    console.error(err)
  } finally {
    draftsLoading.value = false
  }
}

async function deleteDraft(id: string) {
  try {
    await axios.delete(`/api/drafts/${id}`)
    drafts.value = drafts.value.filter((d) => d._id !== id)
  } catch (err) {
    console.error(err)
  }
}

function selectedDests(draft: Draft) {
  return (draft.destinations || []).filter((d) => d.selected)
}

function mediaName(url: string) {
  try { return decodeURIComponent(url.split('/').pop() ?? url) } catch { return url }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return dayjs(d).format('D MMM YYYY, HH:mm')
}

function formatTime(d: string) {
  return dayjs(d).format('HH:mm')
}

function platformColor(p: string) {
  return PLATFORM_META[p]?.color ?? '#6b7280'
}

function firstPlatformColor(job: ScheduledJob) {
  return platformColor(job.platforms?.[0] ?? '')
}

function statusClass(status: string) {
  return ({
    pending:   'bg-yellow-900/40 text-yellow-400',
    running:   'bg-blue-900/40 text-blue-400',
    published: 'bg-green-900/40 text-green-400',
    partial:   'bg-orange-900/40 text-orange-400',
    completed: 'bg-green-900/40 text-green-400',
    failed:    'bg-red-900/40 text-red-400',
    cancelled: 'bg-gray-800 text-gray-500',
  } as Record<string, string>)[status] ?? 'bg-gray-800 text-gray-400'
}

function jobPlatformKeys(job: ScheduledJob): string[] {
  if (job.destinations?.length) return [...new Set(job.destinations.map((d) => d.platform))]
  return job.platforms || []
}

function jobMediaUrl(job: ScheduledJob): string | null {
  return job.destinations?.find((d) => d.imageUrl || d.videoUrl)?.imageUrl
    || job.destinations?.find((d) => d.videoUrl)?.videoUrl
    || null
}

function platformResultEntries(job: ScheduledJob): [string, PlatformResult][] {
  if (!job.platformResults) return []
  return Object.entries(job.platformResults)
}


// ── Bulk draft ─────────────────────────────────────────────────────────────────

interface BulkProgress {
  total: number; completed: number; failed: number; status: string; processed: number
}

const BULK_TONES = ['professional', 'casual', 'engaging', 'informative', 'humorous', 'inspirational']

const showBulkModal = ref(false)
const bulkTopics = ref('')
const bulkTone = ref('engaging')
const bulkLoading = ref(false)
const bulkBatchId = ref<string | null>(null)
const bulkProgress = ref<BulkProgress | null>(null)
const bulkDestinations = ref<Destination[]>([])

let bulkPollTimer: ReturnType<typeof setInterval> | null = null

async function openBulkModal() {
  showBulkModal.value = true
  bulkBatchId.value = null
  bulkProgress.value = null
  bulkTopics.value = ''
  bulkTone.value = 'engaging'
  await platformsStore.fetchMetaConnections()
  composeStore.initDestinations()
  composeStore.destinations.forEach((d) => { d.selected = false })
  bulkDestinations.value = composeStore.destinations
}

function toggleBulkDest(key: string) {
  const dest = bulkDestinations.value.find((d) => d.key === key)
  if (dest) dest.selected = !dest.selected
}

function closeBulkModal() {
  showBulkModal.value = false
  stopBulkPoll()
}

function resetBulkModal() {
  bulkBatchId.value = null
  bulkProgress.value = null
  bulkTopics.value = ''
  bulkDestinations.value.forEach((d) => { d.selected = false })
}

function stopBulkPoll() {
  if (bulkPollTimer !== null) {
    clearInterval(bulkPollTimer)
    bulkPollTimer = null
  }
}

async function pollBulkProgress() {
  if (!bulkBatchId.value) return
  try {
    const res = await axios.get(`/api/ai/bulk-draft/${bulkBatchId.value}`)
    bulkProgress.value = res.data
    if (res.data.status === 'done' || res.data.status === 'failed') {
      stopBulkPoll()
      await fetchDrafts()
    }
  } catch (err) {
    console.error(err)
  }
}

async function submitBulkDraft() {
  const topics = bulkTopics.value.split('\n').map((t) => t.trim()).filter(Boolean)
  if (!topics.length) return
  bulkLoading.value = true
  try {
    const res = await axios.post('/api/ai/bulk-draft', {
      topics,
      destinations: bulkDestinations.value,
      tone: bulkTone.value,
    })
    bulkBatchId.value = res.data.batchId
    bulkProgress.value = { total: topics.length, completed: 0, failed: 0, status: 'processing', processed: 0 }
    bulkPollTimer = setInterval(pollBulkProgress, 2000)
  } catch (err) {
    console.error(err)
  } finally {
    bulkLoading.value = false
  }
}

// ── Watchers & lifecycle ───────────────────────────────────────────────────────

watch(activeStatus, fetchJobs)
watch(mode, (m) => {
  if (m === 'drafts') fetchDrafts()
  if (m === 'calendar') fetchCalendarJobs()
})

onMounted(() => {
  fetchJobs()
  fetchDrafts()
  fetchCalendarJobs()
})

onUnmounted(() => {
  stopBulkPoll()
})
</script>
