<template>
  <div class="flex h-screen overflow-hidden bg-gray-950 text-gray-100">

    <!-- ── Sidebar ── -->
    <aside class="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto">

      <div class="p-4">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
          {{ $t('dashboard.platforms') }}
        </p>

        <template v-for="(meta, key) in PLATFORM_META" :key="key">
          <button
            @click="feedStore.togglePlatform(key)"
            class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors mb-0.5"
            :class="feedStore.activePlatforms.has(key)
              ? 'bg-gray-800 text-white'
              : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'"
          >
            <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: meta.color }"></span>
            <span class="truncate flex-1 text-left text-xs">{{ $t(`platforms.${key}`) }}</span>
            <span
              v-if="itemsByPlatform[key]?.length"
              class="text-xs text-gray-500 flex-shrink-0"
            >{{ itemsByPlatform[key].length }}</span>
            <span v-if="platformsStore.isConnected(key)" class="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0"></span>
          </button>

          <!-- Facebook sub-pages -->
          <template v-if="key === 'facebook' && platformsStore.connectedPages.length">
            <button
              v-for="page in platformsStore.connectedPages"
              :key="page.id"
              @click="feedStore.togglePage(page.id)"
              class="flex items-center gap-2 w-full pl-6 pr-2 py-1 mb-0.5 rounded-lg text-left transition-colors"
              :class="feedStore.activePageIds.has(page.id)
                ? 'bg-blue-900/30 text-white'
                : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'"
            >
              <img v-if="page.picture" :src="page.picture" class="w-3.5 h-3.5 rounded-full flex-shrink-0" />
              <span
                v-else
                class="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-white"
                style="background:#1877F2; font-size:8px"
              >f</span>
              <span class="text-xs truncate flex-1">{{ page.name }}</span>
              <span v-if="feedStore.activePageIds.has(page.id)" class="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"></span>
            </button>
          </template>

          <!-- Instagram sub-accounts -->
          <template v-if="key === 'instagram' && platformsStore.connectedIgAccounts.length">
            <button
              v-for="account in platformsStore.connectedIgAccounts"
              :key="account.id"
              @click="feedStore.toggleIgAccount(account.id)"
              class="flex items-center gap-2 w-full pl-6 pr-2 py-1 mb-0.5 rounded-lg text-left transition-colors"
              :class="feedStore.activeIgAccountIds.has(account.id)
                ? 'bg-pink-900/30 text-white'
                : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'"
            >
              <img v-if="account.avatar" :src="account.avatar" class="w-3.5 h-3.5 rounded-full flex-shrink-0" />
              <span
                v-else
                class="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-white"
                style="background:#E1306C; font-size:8px"
              >I</span>
              <span class="text-xs truncate flex-1">@{{ account.username }}</span>
              <span v-if="feedStore.activeIgAccountIds.has(account.id)" class="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0"></span>
            </button>
          </template>
        </template>
      </div>

      <div class="px-4 pb-4 border-t border-gray-800 pt-3 mt-auto">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
          {{ $t('dashboard.tags') }}
        </p>
        <button
          @click="feedStore.activeTag = null"
          class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs mb-0.5 transition-colors"
          :class="!feedStore.activeTag ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-800/60'"
        >
          {{ $t('dashboard.allTags') }}
        </button>
      </div>
    </aside>

    <!-- ── Main ── -->
    <main class="flex-1 flex flex-col overflow-hidden min-w-0">

      <!-- Toolbar -->
      <header class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <input
          v-model="feedStore.searchQuery"
          type="text"
          :placeholder="$t('dashboard.searchPlaceholder')"
          class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 min-w-0"
        />
        <button
          @click="handleRefresh"
          :disabled="feedStore.loading"
          class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0"
        >
          {{ feedStore.loading ? $t('dashboard.refreshing') : $t('dashboard.refresh') }}
        </button>
        <router-link
          to="/compose"
          class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0"
        >
          {{ $t('dashboard.newPost') }}
        </router-link>
      </header>

      <!-- Empty state (no items at all) -->
      <div
        v-if="feedStore.loading && !feedStore.items.length"
        class="flex-1 flex items-center justify-center text-gray-500 text-sm"
      >
        {{ $t('dashboard.loading') }}
      </div>

      <div
        v-else-if="!activePlatformsWithItems.length"
        class="flex-1 flex flex-col items-center justify-center text-gray-500"
      >
        <p class="text-3xl mb-3">📭</p>
        <p class="text-sm">{{ $t('dashboard.empty') }}</p>
        <p class="text-xs mt-1 text-gray-600">{{ $t('dashboard.emptyHint') }}</p>
      </div>

      <!-- Platform columns — horizontal scroll, each column scrolls vertically -->
      <div v-else class="flex-1 overflow-x-auto overflow-y-hidden">
        <div class="flex h-full gap-2 p-3" :style="{ minWidth: `${activePlatformsWithItems.length * 296}px` }">

          <div
            v-for="platform in activePlatformsWithItems"
            :key="platform"
            class="flex flex-col flex-1 min-w-[260px] max-w-xs bg-gray-900/60 rounded-xl overflow-hidden border border-gray-800/60"
          >
            <!-- Column header -->
            <div
              class="flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0"
              :style="{ borderBottomColor: PLATFORM_META[platform]?.color + '44' }"
            >
              <span
                class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: PLATFORM_META[platform]?.color }"
              ></span>
              <span class="text-sm font-semibold flex-1">{{ $t(`platforms.${platform}`) }}</span>
              <span class="text-xs text-gray-600">{{ itemsByPlatform[platform]?.length }}</span>
            </div>

            <!-- Sub-label for Facebook pages -->
            <template v-if="platform === 'facebook' && platformsStore.connectedPages.length">
              <div class="px-3 py-1 bg-gray-800/40 flex flex-wrap gap-x-2 border-b border-gray-800/40">
                <span
                  v-for="page in platformsStore.connectedPages"
                  :key="page.id"
                  class="text-xs text-gray-500 truncate"
                >{{ page.name }}</span>
              </div>
            </template>

            <!-- Sub-label for Instagram accounts -->
            <template v-if="platform === 'instagram' && platformsStore.connectedIgAccounts.length">
              <div class="px-3 py-1 bg-gray-800/40 flex flex-wrap gap-x-2 border-b border-gray-800/40">
                <span
                  v-for="account in platformsStore.connectedIgAccounts"
                  :key="account.id"
                  class="text-xs text-gray-500 truncate"
                >@{{ account.username }}</span>
              </div>
            </template>

            <!-- Posts — this div scrolls independently -->
            <div class="flex-1 overflow-y-auto p-2 space-y-2">
              <FeedItem
                v-for="item in itemsByPlatform[platform]"
                :key="`${item.platform}-${item.originalId}`"
                :item="item"
              />
            </div>
          </div>

        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { io } from 'socket.io-client'
import { useFeedStore } from '../stores/feed'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'
import type { FeedItem as FeedItemType } from '../stores/feed'
import FeedItem from '../components/feed/FeedItem.vue'

const feedStore = useFeedStore()
const platformsStore = usePlatformsStore()

// Group filtered items by platform
const itemsByPlatform = computed<Record<string, FeedItemType[]>>(() => {
  const groups: Record<string, FeedItemType[]> = {}
  for (const item of feedStore.filteredItems) {
    if (!groups[item.platform]) groups[item.platform] = []
    groups[item.platform].push(item)
  }
  return groups
})

// Only show columns for platforms that are active AND have at least one item,
// preserving the order defined in PLATFORM_META
const activePlatformsWithItems = computed(() =>
  Object.keys(PLATFORM_META).filter(
    (p) => feedStore.activePlatforms.has(p) && itemsByPlatform.value[p]?.length
  )
)

async function handleRefresh() {
  await feedStore.refreshFeeds()
}

onMounted(async () => {
  await Promise.all([
    feedStore.fetchFeeds(),
    platformsStore.fetchStatuses(),
    platformsStore.fetchMetaConnections(),
  ])

  const socket = io()
  socket.on('feed.items', (data: { platform: string; items: unknown[] }) => {
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => feedStore.addItem(item as FeedItemType))
    }
  })
})
</script>
