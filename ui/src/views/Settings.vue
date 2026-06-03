<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto space-y-8">

      <div>
        <h1 class="text-2xl font-bold mb-1">{{ $t('settings.title') }}</h1>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           FACEBOOK & INSTAGRAM — OAuth connection card
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="flex gap-1.5">
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#1877F2">f</span>
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E1306C">I</span>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.meta.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.meta.sectionSubtitle') }}</p>
          </div>
        </div>

        <!-- OAuth error banner -->
        <div v-if="oauthError" class="mx-5 mt-4 bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <span class="shrink-0">⚠</span>
          <span><strong>{{ $t('settings.meta.errorTitle') }}:</strong> {{ oauthError }}</span>
        </div>

        <!-- Step 1: App credentials (configure in Global Settings) -->
        <div class="p-5 border-b border-gray-800/60 flex items-center justify-between">
          <div v-if="metaAppConfigured" class="flex items-center gap-2 text-sm text-green-400">
            <span>✓</span>
            <span>{{ $t('settings.meta.appConfigured') }}</span>
            <span class="text-gray-600 font-mono text-xs">({{ platformsStore.metaCredentials.appId }})</span>
          </div>
          <div v-else class="text-sm text-gray-500">{{ $t('settings.meta.appNotConfigured') }}</div>
          <router-link
            to="/global-settings#meta-app"
            class="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
          >
            {{ $t('settings.configureInGlobal') }} →
          </router-link>
        </div>

        <!-- Step 2: OAuth connect -->
        <div class="p-5" :class="{ 'opacity-40 pointer-events-none': !metaAppConfigured }">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 2 — Connect Accounts</p>

          <!-- Already connected — show summary + manage -->
          <div v-if="fbConnected || igConnected" class="space-y-3">
            <div v-if="platformsStore.allFbPages.length" class="space-y-1.5">
              <p class="text-xs text-gray-500">{{ $t('settings.meta.selectPages') }}</p>
              <label
                v-for="page in platformsStore.allFbPages"
                :key="page.id"
                class="flex items-center gap-3 bg-gray-800/60 hover:bg-gray-800 rounded-lg px-3 py-2 cursor-pointer transition-colors"
              >
                <input type="checkbox" :value="page.id" v-model="workspaceFbPageIds" class="w-4 h-4 accent-blue-500" />
                <img v-if="page.picture" :src="page.picture" class="w-6 h-6 rounded-full shrink-0" />
                <span v-else class="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold shrink-0">f</span>
                <span class="text-sm flex-1">{{ page.name }}</span>
              </label>
              <div class="flex items-center justify-between pt-1">
                <span v-if="fbPagesSaved" class="text-xs text-green-400">{{ $t('settings.meta.selectionSaved') }}</span>
                <span v-else />
                <button
                  @click="saveFbPageSelection"
                  :disabled="platformsStore.metaLoading"
                  class="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg font-medium transition-colors"
                >
                  {{ $t('settings.meta.saveSelection') }}
                </button>
              </div>
            </div>
            <div v-if="platformsStore.allIgAccounts.length" class="space-y-1.5">
              <p class="text-xs text-gray-500">{{ $t('settings.meta.selectAccounts') }}</p>
              <label
                v-for="account in platformsStore.allIgAccounts"
                :key="account.id"
                class="flex items-center gap-3 bg-gray-800/60 hover:bg-gray-800 rounded-lg px-3 py-2 cursor-pointer transition-colors"
              >
                <input type="checkbox" :value="account.id" v-model="workspaceIgAccountIds" class="w-4 h-4 accent-pink-500" />
                <img v-if="account.avatar" :src="account.avatar" class="w-6 h-6 rounded-full shrink-0" />
                <span v-else class="w-6 h-6 rounded-full bg-pink-700 flex items-center justify-center text-xs font-bold shrink-0">I</span>
                <span class="text-sm flex-1">@{{ account.username }}</span>
              </label>
              <div class="flex items-center justify-between pt-1">
                <span v-if="igAccountsSaved" class="text-xs text-green-400">{{ $t('settings.meta.selectionSaved') }}</span>
                <span v-else />
                <button
                  @click="saveIgAccountSelection"
                  :disabled="platformsStore.metaLoading"
                  class="text-xs px-3 py-1.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 rounded-lg font-medium transition-colors"
                >
                  {{ $t('settings.meta.saveSelection') }}
                </button>
              </div>
            </div>
            <!-- Token expiry warning banner -->
            <div
              v-if="platformsStore.hasExpiryWarning"
              class="rounded-lg bg-yellow-900/30 border border-yellow-700/50 p-3 space-y-2"
            >
              <p class="text-xs font-semibold text-yellow-400">{{ $t('settings.meta.expiryWarningTitle') }}</p>
              <p
                v-for="account in platformsStore.expiringAccounts"
                :key="account.id"
                class="text-xs text-yellow-300"
              >
                {{ $tc('settings.meta.expiryWarningBody', account.daysLeft ?? 0, { username: '@' + account.username, days: account.daysLeft }) }}
              </p>
              <p class="text-xs text-gray-500">{{ $t('settings.meta.expiryAutoNote') }}</p>
              <div class="flex gap-2 pt-1">
                <button
                  @click="handleTokenRefresh"
                  :disabled="tokenRefreshing"
                  class="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 rounded-md text-xs font-medium transition-colors"
                >
                  {{ tokenRefreshing ? $t('settings.meta.expiryRefreshing') : tokenRefreshDone ? $t('settings.meta.expiryRefreshDone') : $t('settings.meta.expiryRefreshToken') }}
                </button>
                <button
                  @click="platformsStore.dismissTokenWarning()"
                  class="px-3 py-1.5 text-gray-400 hover:text-gray-300 text-xs font-medium transition-colors"
                >
                  {{ $t('settings.meta.expiryDismiss') }}
                </button>
              </div>
            </div>

            <div class="flex gap-2 pt-2">
              <button
                @click="platformsStore.startMetaOAuth()"
                :disabled="platformsStore.metaLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.meta.reconnect') }}
              </button>
              <button
                @click="confirmDisconnect"
                :disabled="platformsStore.metaLoading"
                class="px-4 py-2 text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.meta.disconnect') }}
              </button>
            </div>
          </div>

          <!-- Not yet connected -->
          <div v-else>
            <button
              @click="platformsStore.startMetaOAuth()"
              :disabled="!metaAppConfigured || platformsStore.metaLoading"
              class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span v-if="platformsStore.metaLoading">{{ $t('settings.meta.connecting') }}</span>
              <span v-else>{{ $t('settings.meta.connectButton') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           PINTEREST — OAuth connection card
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E60023">P</span>
          <div>
            <p class="font-semibold">{{ $t('settings.pinterest.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.pinterest.sectionSubtitle') }}</p>
          </div>
        </div>

        <!-- OAuth error banner -->
        <div v-if="pinterestOauthError" class="mx-5 mt-4 bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <span class="shrink-0">⚠</span>
          <span><strong>{{ $t('settings.pinterest.errorTitle') }}:</strong> {{ pinterestOauthError }}</span>
        </div>

        <!-- Step 1: App credentials (configure in Global Settings) -->
        <div class="p-5 border-b border-gray-800/60 flex items-center justify-between">
          <div v-if="pinterestAppConfigured" class="flex items-center gap-2 text-sm text-green-400">
            <span>✓</span>
            <span>{{ $t('settings.pinterest.appConfigured') }}</span>
            <span class="text-gray-600 font-mono text-xs">({{ platformsStore.pinterestCredentials.clientId }})</span>
          </div>
          <div v-else class="text-sm text-gray-500">{{ $t('settings.meta.appNotConfigured') }}</div>
          <router-link
            to="/global-settings#pinterest-app"
            class="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
          >
            {{ $t('settings.configureInGlobal') }} →
          </router-link>
        </div>

        <!-- Step 2: OAuth connect + boards -->
        <div class="p-5" :class="{ 'opacity-40 pointer-events-none': !pinterestAppConfigured }">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 2 — Connect Account</p>

          <!-- Connected — show boards -->
          <div v-if="pinterestConnected" class="space-y-4">
            <div class="space-y-1.5">
              <p class="text-xs text-gray-500">{{ $t('settings.pinterest.boardsTitle') }}</p>
              <div v-if="!platformsStore.allPinterestBoards.length" class="text-sm text-gray-600">{{ $t('settings.pinterest.noBoards') }}</div>
              <div v-else class="space-y-1.5">
                <label
                  v-for="board in platformsStore.allPinterestBoards"
                  :key="board.id"
                  class="flex items-center gap-3 bg-gray-800/60 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-800 transition-colors"
                >
                  <input type="checkbox" :value="board.id" v-model="selectedBoardIds" class="w-4 h-4 accent-red-500" />
                  <span class="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold shrink-0" style="background:#E60023">P</span>
                  <span class="text-sm flex-1">{{ board.name }}</span>
                  <span class="text-xs text-gray-600">{{ board.privacy }}</span>
                  <span v-if="board.selected" class="w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                </label>
              </div>
              <div class="flex items-center justify-between pt-2">
                <span v-if="pinterestBoardsSaved" class="text-xs text-green-400">{{ $t('settings.pinterest.boardsSaved') }}</span>
                <span v-else />
                <button
                  @click="savePinterestBoards"
                  :disabled="platformsStore.pinterestLoading"
                  class="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                >
                  {{ platformsStore.pinterestLoading ? $t('settings.pinterest.savingBoards') : $t('settings.pinterest.saveBoards') }}
                </button>
              </div>
            </div>

            <div class="flex gap-2">
              <button
                @click="platformsStore.startPinterestOAuth()"
                :disabled="platformsStore.pinterestLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.pinterest.reconnect') }}
              </button>
              <button
                @click="confirmPinterestDisconnect"
                :disabled="platformsStore.pinterestLoading"
                class="px-4 py-2 text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.pinterest.disconnect') }}
              </button>
            </div>
          </div>

          <!-- Not yet connected -->
          <div v-else>
            <button
              @click="platformsStore.startPinterestOAuth()"
              :disabled="!pinterestAppConfigured || platformsStore.pinterestLoading"
              class="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span v-if="platformsStore.pinterestLoading">{{ $t('settings.pinterest.connecting') }}</span>
              <span v-else>{{ $t('settings.pinterest.connectButton') }}</span>
            </button>
          </div>
        </div>

      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           TIKTOK — OAuth connection card
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#EE1D52">T</span>
          <div>
            <p class="font-semibold">{{ $t('settings.tiktok.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.tiktok.sectionSubtitle') }}</p>
          </div>
        </div>

        <!-- OAuth error banner -->
        <div v-if="tiktokOauthError" class="mx-5 mt-4 bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <span class="shrink-0">⚠</span>
          <span><strong>{{ $t('settings.tiktok.errorTitle') }}:</strong> {{ tiktokOauthError }}</span>
        </div>

        <!-- Step 1: App credentials (configure in Global Settings) -->
        <div class="p-5 border-b border-gray-800/60 flex items-center justify-between">
          <div v-if="tiktokAppConfigured" class="flex items-center gap-2 text-sm text-green-400">
            <span>✓</span>
            <span>{{ $t('settings.tiktok.appConfigured') }}</span>
            <span class="text-gray-600 font-mono text-xs">({{ platformsStore.tiktokCredentials.clientKey }})</span>
          </div>
          <div v-else class="text-sm text-gray-500">{{ $t('settings.meta.appNotConfigured') }}</div>
          <router-link
            to="/global-settings#tiktok-app"
            class="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
          >
            {{ $t('settings.configureInGlobal') }} →
          </router-link>
        </div>

        <!-- Step 2: OAuth connect -->
        <div class="p-5" :class="{ 'opacity-40 pointer-events-none': !tiktokAppConfigured }">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 2 — Connect Account</p>

          <!-- Connected -->
          <div v-if="platformsStore.tiktokConnected" class="space-y-4">
            <div class="flex items-center gap-3 bg-gray-800/60 rounded-lg px-4 py-3">
              <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style="background:#EE1D52">T</span>
              <div>
                <p class="text-sm font-medium text-white">{{ platformsStore.tiktokUsername || $t('settings.tiktok.connectedAs') }}</p>
                <p class="text-xs text-gray-500">{{ $t('settings.tiktok.connectedAs') }}</p>
              </div>
            </div>
            <p class="text-xs text-gray-600">{{ $t('settings.tiktok.videoOnly') }}</p>
            <div class="flex gap-2">
              <button
                @click="platformsStore.startTikTokOAuth()"
                :disabled="platformsStore.tiktokLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >{{ $t('settings.tiktok.reconnect') }}</button>
              <button
                @click="confirmTikTokDisconnect"
                :disabled="platformsStore.tiktokLoading"
                class="px-4 py-2 text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >{{ $t('settings.tiktok.disconnect') }}</button>
            </div>
          </div>

          <!-- Not yet connected -->
          <div v-else>
            <button
              @click="platformsStore.startTikTokOAuth()"
              :disabled="!tiktokAppConfigured || platformsStore.tiktokLoading"
              class="w-full py-2.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span v-if="platformsStore.tiktokLoading">{{ $t('settings.tiktok.connecting') }}</span>
              <span v-else>{{ $t('settings.tiktok.connectButton') }}</span>
            </button>
          </div>
        </div>

      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           PAGE/ACCOUNT PICKER — shown after OAuth callback
      ════════════════════════════════════════════════════════════════════ -->
      <div
        v-if="showDiscovery"
        class="bg-gray-900 border border-blue-700 rounded-2xl overflow-hidden"
      >
        <div class="p-5 border-b border-gray-800">
          <p class="font-semibold">{{ $t('settings.meta.discoveryTitle') }}</p>
          <p class="text-xs text-gray-500 mt-1">{{ $t('settings.meta.discoverySubtitle') }}</p>
        </div>

        <div class="p-5 space-y-5">

          <!-- Facebook Pages -->
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{{ $t('settings.meta.pagesHeading') }}</p>
            <div v-if="discovery.pages.length === 0" class="text-sm text-gray-600">{{ $t('settings.meta.noPages') }}</div>
            <div v-else class="space-y-2">
              <label
                v-for="page in discovery.pages"
                :key="page.id"
                class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-750 transition-colors"
              >
                <input type="checkbox" :value="page.id" v-model="selectedPageIds" class="w-4 h-4 accent-blue-500" />
                <img v-if="page.picture" :src="page.picture" class="w-8 h-8 rounded-full" />
                <span v-else class="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold shrink-0">f</span>
                <span class="text-sm font-medium">{{ page.name }}</span>
                <span class="ml-auto text-xs text-gray-600 font-mono">{{ page.id }}</span>
              </label>
            </div>
          </div>

          <!-- Instagram Business Accounts -->
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{{ $t('settings.meta.igHeading') }}</p>
            <div v-if="discovery.igAccounts.length === 0" class="text-sm text-gray-600">{{ $t('settings.meta.noIgAccounts') }}</div>
            <div v-else class="space-y-2">
              <label
                v-for="account in discovery.igAccounts"
                :key="account.id"
                class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-750 transition-colors"
              >
                <input type="checkbox" :value="account.id" v-model="selectedIgAccountIds" class="w-4 h-4 accent-pink-500" />
                <img v-if="account.avatar" :src="account.avatar" class="w-8 h-8 rounded-full" />
                <span v-else class="w-8 h-8 rounded-full bg-pink-700 flex items-center justify-center text-xs font-bold shrink-0">I</span>
                <div>
                  <p class="text-sm font-medium">@{{ account.username }}</p>
                  <p class="text-xs text-gray-600">{{ $t('settings.meta.igLinkedTo') }} {{ pageNameForId(account.pageId) }}</p>
                </div>
                <span class="ml-auto text-xs text-gray-600 font-mono">{{ account.id }}</span>
              </label>
            </div>
          </div>

          <!-- Confirm -->
          <div class="flex items-center justify-between pt-2">
            <p v-if="selectionError" class="text-xs text-red-400">{{ selectionError }}</p>
            <span v-else />
            <button
              @click="confirmSelection"
              :disabled="platformsStore.metaLoading"
              class="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
            >
              {{ platformsStore.metaLoading ? $t('settings.meta.confirmingSelection') : $t('settings.meta.confirmSelection') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           OTHER PLATFORMS — env-file based
      ════════════════════════════════════════════════════════════════════ -->
      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Other Platforms</p>
        <div class="space-y-3">
          <div
            v-for="(meta, key) in otherPlatforms"
            :key="key"
            class="bg-gray-900 border rounded-xl p-4 transition-colors"
            :class="isConnected(key) ? 'border-gray-700' : 'border-gray-800'"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span
                  class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                  :style="{ backgroundColor: meta.color }"
                >
                  {{ meta.label[0] }}
                </span>
                <div>
                  <p class="font-medium text-sm">{{ $t(`platforms.${key}`) }}</p>
                  <p v-if="getStatus(key)?.username" class="text-xs text-gray-400">
                    @{{ getStatus(key)?.username }}
                  </p>
                  <p v-else-if="getStatus(key)?.error" class="text-xs text-red-400">
                    {{ getStatus(key)?.error }}
                  </p>
                  <p v-else class="text-xs text-gray-600">{{ $t('settings.notConnected') }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="isConnected(key) ? 'bg-green-400' : 'bg-gray-600'"></span>
                <span class="text-xs" :class="isConnected(key) ? 'text-green-400' : 'text-gray-600'">
                  {{ isConnected(key) ? $t('settings.connected') : $t('settings.notConnected') }}
                </span>
              </div>
            </div>

            <div v-if="!isConnected(key)" class="mt-3 bg-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono">
              <span v-if="key === 'twitter'">TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET</span>
              <span v-else-if="key === 'mastodon'">MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN</span>
              <span v-else-if="key === 'bluesky'">BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD</span>
              <span v-else-if="key === 'linkedin'">LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET</span>
              <span v-else-if="key === 'reddit'">REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD</span>
              <span v-else>— {{ $t('settings.envHint') }} —</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           ACCOUNT PROFILES
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800">
          <p class="font-semibold">{{ $t('settings.profiles.sectionTitle') }}</p>
          <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.profiles.sectionSubtitle') }}</p>
        </div>

        <!-- Workspace profile form — one per workspace, always visible -->
        <div v-if="editingProfiles['workspace']" class="px-5 pb-5 pt-4 space-y-4">

              <!-- Row 1: Business Name + Website -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.businessName') }}</label>
                  <input
                    v-model="editingProfiles['workspace'].businessName"
                    type="text"
                    :placeholder="$t('settings.profiles.businessNameHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.websiteUrl') }}</label>
                  <input
                    v-model="editingProfiles['workspace'].websiteUrl"
                    type="url"
                    placeholder="https://"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <!-- Description -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.description') }}</label>
                <textarea
                  v-model="editingProfiles['workspace'].description"
                  :placeholder="$t('settings.profiles.descriptionHint')"
                  rows="2"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <!-- Row 2: Industry + Tone -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.industry') }}</label>
                  <input
                    v-model="editingProfiles['workspace'].industry"
                    type="text"
                    :placeholder="$t('settings.profiles.industryHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.toneOfVoice') }}</label>
                  <select
                    v-model="editingProfiles['workspace'].toneOfVoice"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">{{ $t('settings.profiles.toneSelect') }}</option>
                    <option v-for="tone in TONE_OPTIONS" :key="tone.value" :value="tone.value">{{ tone.label }}</option>
                  </select>
                </div>
              </div>

              <!-- Timezone -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.timezone') }}</label>
                <select
                  v-model="editingProfiles['workspace'].timezone"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="">{{ $t('settings.profiles.timezoneAuto') }}</option>
                  <option v-for="tz in COMMON_TIMEZONES" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
                </select>
                <p class="text-xs text-gray-600 mt-1">{{ $t('settings.profiles.timezoneHint') }}</p>
              </div>

              <!-- Target Audience -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.targetAudience') }}</label>
                <input
                  v-model="editingProfiles['workspace'].targetAudience"
                  type="text"
                  :placeholder="$t('settings.profiles.targetAudienceHint')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <!-- Row 3: Keywords + Hashtags -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.keywords') }}</label>
                  <input
                    v-model="editingProfiles['workspace'].keywords"
                    type="text"
                    :placeholder="$t('settings.profiles.keywordsHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.hashtags') }}</label>
                  <input
                    v-model="editingProfiles['workspace'].hashtags"
                    type="text"
                    :placeholder="$t('settings.profiles.hashtagsHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <!-- Posting Guidelines -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.postingGuidelines') }}</label>
                <textarea
                  v-model="editingProfiles['workspace'].postingGuidelines"
                  :placeholder="$t('settings.profiles.postingGuidelinesHint')"
                  rows="3"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <!-- Save button -->
              <div class="flex items-center justify-end gap-3">
                <span v-if="profileSavedKey === 'workspace'" class="text-xs text-green-400">
                  {{ $t('settings.profiles.saved') }}
                </span>
                <button
                  @click="runFiveForces('workspace')"
                  :disabled="fiveForcesRunning === 'workspace'"
                  class="px-3 py-2 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-star-of-david text-xs" :class="{ 'animate-pulse': fiveForcesRunning === 'workspace' }"></i>
                  {{ fiveForcesRunning === 'workspace' ? $t('settings.profiles.fiveForcesRunning') : $t('settings.profiles.fiveForces') }}
                </button>
                <button
                  @click="diagnoseIndustry('workspace')"
                  :disabled="industryDiagnosing === 'workspace'"
                  class="px-3 py-2 bg-sky-800 hover:bg-sky-700 disabled:opacity-40 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-flask text-xs" :class="{ 'animate-pulse': industryDiagnosing === 'workspace' }"></i>
                  {{ industryDiagnosing === 'workspace' ? $t('settings.profiles.diagnosing') : $t('settings.profiles.diagnoseIndustry') }}
                </button>
                <button
                  @click="auditProfile('workspace')"
                  :disabled="profileAuditing === 'workspace'"
                  class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-lg text-sm transition-colors flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-magnifying-glass-chart text-xs" :class="{ 'animate-pulse': profileAuditing === 'workspace' }"></i>
                  {{ profileAuditing === 'workspace' ? $t('settings.profiles.auditing') : $t('settings.profiles.auditProfile') }}
                </button>
                <button
                  @click="saveProfile('workspace')"
                  :disabled="profileSaving === 'workspace'"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                >
                  {{ profileSaving === 'workspace' ? $t('settings.profiles.saving') : $t('settings.profiles.save') }}
                </button>
              </div>

              <!-- Profile audit results -->
              <div v-if="profileAudits['workspace']" class="mt-4 border-t border-gray-700 pt-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-white">{{ $t('settings.profiles.auditTitle') }}</span>
                    <span
                      class="text-sm font-bold px-2 py-0.5 rounded-lg"
                      :class="profileAudits['workspace'].score >= 70 ? 'text-green-300 bg-green-900/40' : profileAudits['workspace'].score >= 40 ? 'text-amber-300 bg-amber-900/40' : 'text-red-300 bg-red-900/40'"
                    >{{ profileAudits['workspace'].score }}/100</span>
                  </div>
                  <button @click="profileAudits['workspace'] = null" class="text-xs text-gray-500 hover:text-gray-300">✕</button>
                </div>
                <p class="text-xs text-gray-400 mb-3">{{ profileAudits['workspace'].summary }}</p>
                <div v-if="profileAudits['workspace'].issues?.length" class="space-y-2 mb-3">
                  <div
                    v-for="issue in profileAudits['workspace'].issues"
                    :key="issue.field"
                    class="p-2.5 rounded-lg text-xs"
                    :class="issue.severity === 'high' ? 'bg-red-900/30 border border-red-800/50' : issue.severity === 'medium' ? 'bg-amber-900/30 border border-amber-800/50' : 'bg-gray-800 border border-gray-700'"
                  >
                    <div class="flex items-center gap-1.5 mb-1">
                      <span class="font-medium" :class="issue.severity === 'high' ? 'text-red-300' : issue.severity === 'medium' ? 'text-amber-300' : 'text-gray-300'">{{ issue.field }}</span>
                    </div>
                    <p class="text-gray-300 mb-1">{{ issue.issue }}</p>
                    <p class="text-gray-400 italic">→ {{ issue.fix }}</p>
                  </div>
                </div>
                <div v-if="profileAudits['workspace'].strengths?.length">
                  <div class="text-xs text-green-400 font-medium mb-1">{{ $t('settings.profiles.auditStrengths') }}</div>
                  <ul class="space-y-0.5">
                    <li v-for="s in profileAudits['workspace'].strengths" :key="s" class="flex gap-1.5 text-xs text-green-200">
                      <span class="text-green-400 shrink-0">✓</span>{{ s }}
                    </li>
                  </ul>
                </div>
              </div>

              <!-- Industry diagnosis results -->
              <div v-if="industryDiagnoses['workspace']" class="mt-4 border-t border-gray-700 pt-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-flask text-xs text-sky-400"></i>
                    <span class="text-sm font-medium text-white">{{ $t('settings.profiles.diagnosisTitle') }}</span>
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-900/50 border border-sky-700 text-sky-300">
                      {{ industryDiagnoses['workspace'].diagnosedType }}
                    </span>
                    <span class="text-xs text-gray-500">{{ industryDiagnoses['workspace'].confidence }}% confidence</span>
                  </div>
                  <button @click="industryDiagnoses['workspace'] = null" class="text-xs text-gray-500 hover:text-gray-300">✕</button>
                </div>
                <p class="text-xs text-gray-400 mb-3 leading-relaxed">{{ industryDiagnoses['workspace'].summary }}</p>

                <!-- Characteristics -->
                <div v-if="industryDiagnoses['workspace'].characteristics?.length" class="mb-3">
                  <div class="text-xs font-medium text-gray-400 mb-1.5">{{ $t('settings.profiles.diagnosisCharacteristics') }}</div>
                  <ul class="space-y-0.5">
                    <li v-for="c in industryDiagnoses['workspace'].characteristics" :key="c" class="flex gap-1.5 text-xs text-gray-300">
                      <span class="text-sky-400 shrink-0">›</span>{{ c }}
                    </li>
                  </ul>
                </div>

                <!-- Content mix -->
                <div v-if="industryDiagnoses['workspace'].contentMix" class="mb-3">
                  <div class="text-xs font-medium text-gray-400 mb-1.5">{{ $t('settings.profiles.diagnosisContentMix') }}</div>
                  <div class="flex gap-1 h-3 rounded-full overflow-hidden">
                    <div class="bg-blue-500" :style="{ width: industryDiagnoses['workspace'].contentMix.educational + '%' }" :title="'Educational: ' + industryDiagnoses['workspace'].contentMix.educational + '%'"></div>
                    <div class="bg-green-500" :style="{ width: industryDiagnoses['workspace'].contentMix.social_proof + '%' }" :title="'Social proof: ' + industryDiagnoses['workspace'].contentMix.social_proof + '%'"></div>
                    <div class="bg-amber-500" :style="{ width: industryDiagnoses['workspace'].contentMix.promotional + '%' }" :title="'Promotional: ' + industryDiagnoses['workspace'].contentMix.promotional + '%'"></div>
                    <div class="bg-purple-500" :style="{ width: industryDiagnoses['workspace'].contentMix.engagement + '%' }" :title="'Engagement: ' + industryDiagnoses['workspace'].contentMix.engagement + '%'"></div>
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 rounded-sm bg-blue-500 inline-block"></span>Educational {{ industryDiagnoses['workspace'].contentMix.educational }}%</span>
                    <span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 rounded-sm bg-green-500 inline-block"></span>Social proof {{ industryDiagnoses['workspace'].contentMix.social_proof }}%</span>
                    <span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 rounded-sm bg-amber-500 inline-block"></span>Promotional {{ industryDiagnoses['workspace'].contentMix.promotional }}%</span>
                    <span class="flex items-center gap-1 text-xs text-gray-500"><span class="w-2 h-2 rounded-sm bg-purple-500 inline-block"></span>Engagement {{ industryDiagnoses['workspace'].contentMix.engagement }}%</span>
                  </div>
                </div>

                <!-- Tactics -->
                <div v-if="industryDiagnoses['workspace'].tactics?.length">
                  <div class="text-xs font-medium text-gray-400 mb-1.5">{{ $t('settings.profiles.diagnosisTactics') }}</div>
                  <div class="space-y-2">
                    <div v-for="tactic in industryDiagnoses['workspace'].tactics" :key="tactic.title" class="p-2.5 bg-gray-800 border border-gray-700 rounded-lg text-xs">
                      <div class="font-medium text-sky-300 mb-0.5">{{ tactic.title }}</div>
                      <p class="text-gray-400 mb-1">{{ tactic.rationale }}</p>
                      <p class="text-gray-200 italic">→ {{ tactic.action }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Five Forces results -->
              <div v-if="fiveForcesResults['workspace']" class="mt-4 border-t border-gray-700 pt-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-star-of-david text-xs text-emerald-400"></i>
                    <span class="text-sm font-medium text-white">{{ $t('settings.profiles.fiveForcesTitle') }}</span>
                    <span class="px-2 py-0.5 rounded-full text-xs font-semibold"
                      :class="fiveForcesResults['workspace'].overallScore >= 60 ? 'bg-green-900/50 border border-green-700 text-green-300' : fiveForcesResults['workspace'].overallScore >= 40 ? 'bg-amber-900/50 border border-amber-700 text-amber-300' : 'bg-red-900/50 border border-red-700 text-red-300'"
                    >{{ fiveForcesResults['workspace'].overallScore }}/100</span>
                  </div>
                  <button @click="fiveForcesResults['workspace'] = null" class="text-xs text-gray-500 hover:text-gray-300">✕</button>
                </div>
                <p class="text-xs text-gray-400 mb-3 leading-relaxed italic">{{ fiveForcesResults['workspace'].attractiveness }}</p>
                <p v-if="fiveForcesResults['workspace'].governingForce" class="text-xs text-emerald-400 font-medium mb-3">
                  {{ $t('settings.profiles.fiveForcesGoverning') }}: {{ fiveForcesResults['workspace'].governingForce }}
                </p>

                <!-- Force rows -->
                <div class="space-y-2 mb-3">
                  <div v-for="force in fiveForcesResults['workspace'].forces" :key="force.name" class="p-2.5 bg-gray-800 border border-gray-700 rounded-lg text-xs">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-medium text-gray-200">{{ force.name }}</span>
                      <span class="font-semibold" :class="force.score <= 3 ? 'text-green-400' : force.score <= 6 ? 'text-amber-400' : 'text-red-400'">{{ force.score }}/10</span>
                    </div>
                    <div class="w-full h-1 bg-gray-700 rounded-full mb-1.5">
                      <div class="h-1 rounded-full" :class="force.score <= 3 ? 'bg-green-500' : force.score <= 6 ? 'bg-amber-500' : 'bg-red-500'" :style="{ width: (force.score * 10) + '%' }"></div>
                    </div>
                    <p class="text-gray-400 mb-1">{{ force.assessment }}</p>
                    <div class="flex flex-wrap gap-1">
                      <span v-for="d in force.drivers" :key="d" class="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">{{ d }}</span>
                    </div>
                  </div>
                </div>

                <!-- Positioning recommendations -->
                <div v-if="fiveForcesResults['workspace'].positioning?.length">
                  <div class="text-xs font-medium text-gray-400 mb-1.5">{{ $t('settings.profiles.fiveForcesPositioning') }}</div>
                  <ul class="space-y-0.5">
                    <li v-for="p in fiveForcesResults['workspace'].positioning" :key="p" class="flex gap-1.5 text-xs text-gray-300">
                      <span class="text-emerald-400 shrink-0">›</span>{{ p }}
                    </li>
                  </ul>
                </div>
              </div>

        </div>

      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           HASHTAG GROUPS
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center text-white font-bold text-base shrink-0">#</div>
            <div>
              <p class="font-semibold">{{ $t('settings.hashtags.sectionTitle') }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.hashtags.sectionSubtitle') }}</p>
            </div>
          </div>
          <button
            @click="showHashtagStats = !showHashtagStats; showHashtagStats && hashtagStore.stats.length === 0 && hashtagStore.fetchStats('count', statsAccount || undefined)"
            class="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors"
          >
            {{ showHashtagStats ? $t('settings.hashtags.hideStats') : $t('settings.hashtags.showStats') }}
          </button>
        </div>

        <div class="p-5 space-y-4">

          <!-- Group list -->
          <div v-if="hashtagStore.groups.length" class="space-y-3">
            <div
              v-for="group in hashtagStore.groups"
              :key="group._id"
              class="border border-gray-800 rounded-xl p-4"
            >
              <!-- View mode -->
              <template v-if="editingGroupId !== group._id">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-200">{{ group.name }}</p>
                    <div class="flex flex-wrap gap-1 mt-2">
                      <span
                        v-for="tag in group.hashtags"
                        :key="tag"
                        class="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700"
                      >{{ tag }}</span>
                    </div>
                  </div>
                  <div class="flex gap-1.5 shrink-0">
                    <button
                      @click="startEditGroup(group)"
                      class="text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors"
                    >{{ $t('settings.hashtags.edit') }}</button>
                    <button
                      @click="handleDeleteGroup(group._id)"
                      class="text-xs px-2.5 py-1 rounded-lg border border-red-900/60 text-red-400 hover:bg-red-900/20 transition-colors"
                    >{{ $t('settings.hashtags.delete') }}</button>
                  </div>
                </div>
              </template>
              <!-- Edit mode -->
              <template v-else>
                <div class="space-y-2">
                  <input
                    v-model="editGroupName"
                    :placeholder="$t('settings.hashtags.groupNamePlaceholder')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                  />
                  <textarea
                    v-model="editGroupHashtags"
                    :placeholder="$t('settings.hashtags.hashtagsPlaceholder')"
                    rows="3"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-emerald-500"
                  ></textarea>
                  <div class="flex gap-2">
                    <button
                      @click="saveEditGroup(group._id)"
                      class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium text-white transition-colors"
                    >{{ $t('settings.hashtags.save') }}</button>
                    <button
                      @click="editingGroupId = ''"
                      class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
                    >{{ $t('settings.hashtags.cancel') }}</button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <p v-else-if="!hashtagStore.groupsLoading" class="text-sm text-gray-600 text-center py-2">
            {{ $t('settings.hashtags.noGroups') }}
          </p>

          <!-- Add new group form -->
          <div v-if="addingHashtagGroup" class="border border-emerald-900/40 bg-emerald-950/20 rounded-xl p-4 space-y-2">
            <input
              v-model="newGroupName"
              :placeholder="$t('settings.hashtags.groupNamePlaceholder')"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
            />
            <textarea
              v-model="newGroupHashtags"
              :placeholder="$t('settings.hashtags.hashtagsPlaceholder')"
              rows="4"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-emerald-500"
            ></textarea>
            <div class="flex gap-2">
              <button
                @click="handleCreateGroup"
                :disabled="!newGroupName.trim()"
                class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors"
              >{{ $t('settings.hashtags.createGroup') }}</button>
              <button
                @click="addingHashtagGroup = false"
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
              >{{ $t('settings.hashtags.cancel') }}</button>
            </div>
          </div>

          <button
            v-if="!addingHashtagGroup"
            @click="addingHashtagGroup = true"
            class="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >+ {{ $t('settings.hashtags.addGroup') }}</button>

          <!-- Stats panel -->
          <div v-if="showHashtagStats" class="border-t border-gray-800 pt-4 space-y-4">

            <!-- Controls row -->
            <div class="flex items-center flex-wrap gap-2">
              <p class="text-sm font-semibold text-gray-300 mr-1">{{ $t('settings.hashtags.statsTitle') }}</p>

              <!-- Account filter — scopes view, scan, and AI suggest -->
              <select
                v-model="statsAccount"
                class="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-emerald-500"
              >
                <option value="">{{ $t('settings.hashtags.allAccounts') }}</option>
                <option v-for="acc in allConnectedAccounts" :key="acc.key" :value="acc.key">{{ acc.label }}</option>
              </select>

              <button
                @click="statsSort = 'count'; hashtagStore.fetchStats('count', statsAccount || undefined)"
                class="text-xs px-2.5 py-1 rounded-lg border transition-colors"
                :class="statsSort === 'count' ? 'border-emerald-600 text-emerald-300 bg-emerald-900/20' : 'border-gray-700 text-gray-400 hover:bg-gray-800'"
              >{{ $t('settings.hashtags.sortByUsage') }}</button>

              <button
                @click="statsSort = 'engagement'; hashtagStore.fetchStats('engagement', statsAccount || undefined)"
                class="text-xs px-2.5 py-1 rounded-lg border transition-colors"
                :class="statsSort === 'engagement' ? 'border-emerald-600 text-emerald-300 bg-emerald-900/20' : 'border-gray-700 text-gray-400 hover:bg-gray-800'"
              >{{ $t('settings.hashtags.sortByEngagement') }}</button>

              <button
                @click="scrapeHashtagsNow"
                :disabled="hashtagStore.scraping"
                class="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <svg v-if="hashtagStore.scraping" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                {{ hashtagStore.scraping ? $t('settings.hashtags.scanning') : $t('settings.hashtags.scanPosts') }}
              </button>
            </div>

            <!-- AI Suggest row -->
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-xs text-gray-500">
                {{ statsAccount ? $t('settings.hashtags.aiSuggestForAccount') : $t('settings.hashtags.aiSuggestAllAccounts') }}
              </p>
              <button
                @click="handleAiSuggest"
                :disabled="hashtagStore.aiSuggesting"
                class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-700/60 text-violet-300 hover:bg-violet-900/30 disabled:opacity-50 transition-colors shrink-0"
              >
                <svg v-if="hashtagStore.aiSuggesting" class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                <span v-if="!hashtagStore.aiSuggesting">✨</span>
                {{ hashtagStore.aiSuggesting ? $t('settings.hashtags.suggesting') : $t('settings.hashtags.aiSuggest') }}
              </button>
            </div>

            <!-- AI suggestions chips -->
            <div v-if="hashtagStore.aiSuggestions.length" class="space-y-3">
              <p class="text-xs text-gray-500">{{ $t('settings.hashtags.selectToGroup') }}</p>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="tag in hashtagStore.aiSuggestions"
                  :key="tag"
                  @click="toggleAiTag(tag)"
                  class="text-xs px-2.5 py-0.5 rounded-full border transition-colors"
                  :class="selectedAiTags.has(tag)
                    ? 'bg-emerald-800 border-emerald-600 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'"
                >{{ tag }}</button>
              </div>
              <div v-if="selectedAiTags.size" class="flex gap-2">
                <input
                  v-model="aiGroupName"
                  :placeholder="$t('settings.hashtags.groupNamePlaceholder')"
                  class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500 min-w-0"
                />
                <button
                  @click="createGroupFromAi"
                  :disabled="!aiGroupName.trim()"
                  class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors shrink-0"
                >{{ $t('settings.hashtags.createGroup') }}</button>
              </div>
            </div>

            <!-- Stats table -->
            <div v-if="hashtagStore.statsLoading" class="text-center py-4 text-sm text-gray-600">
              {{ $t('settings.hashtags.loadingStats') }}
            </div>
            <div v-else-if="hashtagStore.stats.length" class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-gray-500 border-b border-gray-800">
                    <th class="text-left py-2 pr-4 font-medium">{{ $t('settings.hashtags.colHashtag') }}</th>
                    <th class="text-right py-2 pr-4 font-medium">{{ $t('settings.hashtags.colUses') }}</th>
                    <th class="text-right py-2 pr-4 font-medium">{{ $t('settings.hashtags.colEngagement') }}</th>
                    <th class="text-center py-2 pr-4 font-medium">{{ $t('settings.hashtags.colGrade') }}</th>
                    <th class="text-left py-2 font-medium">{{ $t('settings.hashtags.colPlatforms') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-800/60">
                  <tr
                    v-for="stat in hashtagStore.stats.slice(0, 100)"
                    :key="stat._id"
                    class="hover:bg-gray-800/30 transition-colors"
                  >
                    <td class="py-1.5 pr-4 font-mono text-emerald-400">{{ stat.hashtag || stat._id }}</td>
                    <td class="py-1.5 pr-4 text-right text-gray-300">{{ stat.count }}</td>
                    <td class="py-1.5 pr-4 text-right text-gray-300">{{ stat.avgEngagement }}</td>
                    <td class="py-1.5 pr-4 text-center">
                      <span
                        class="px-1.5 py-0.5 rounded text-xs font-bold"
                        :class="{
                          'bg-orange-900/50 text-orange-300': stat.grade === 'A',
                          'bg-green-900/50 text-green-300':  stat.grade === 'B',
                          'bg-blue-900/50 text-blue-300':    stat.grade === 'C',
                          'bg-gray-800 text-gray-500':       stat.grade === 'D',
                        }"
                      >{{ gradeLabel(stat.grade) }}</span>
                    </td>
                    <td class="py-1.5 text-gray-500">{{ stat.platforms.join(', ') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="text-sm text-gray-600 text-center py-4">
              {{ $t('settings.hashtags.noStats') }}
            </p>
          </div>

        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           WORKSPACE MANAGEMENT
      ════════════════════════════════════════════════════════════════════ -->
      <div id="workspaces" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-sm font-bold">🏢</span>
          <div>
            <p class="font-semibold">{{ $t('workspace.settingsTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('workspace.settingsSubtitle') }}</p>
          </div>
        </div>

        <div class="p-5 space-y-3">
          <!-- Existing workspaces -->
          <div
            v-for="ws in workspaceStore.workspaces"
            :key="ws._id"
            class="flex items-center gap-3 p-3 rounded-xl border"
            :class="ws._id === workspaceStore.activeWorkspaceId
              ? 'border-violet-600 bg-violet-950/30'
              : 'border-gray-800 bg-gray-800/40'"
          >
            <div class="flex-1 min-w-0">
              <div v-if="renamingId !== ws._id" class="flex items-center gap-2">
                <span class="text-sm font-medium truncate">{{ ws.name || $t('workspace.defaultName') }}</span>
                <span v-if="ws._id === workspaceStore.activeWorkspaceId" class="text-xs px-1.5 py-0.5 rounded bg-violet-600 text-white">{{ $t('workspace.activeLabel') }}</span>
              </div>
              <div v-else class="flex items-center gap-2">
                <input
                  v-model="renameValue"
                  type="text"
                  class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-violet-500"
                  @keydown.enter="saveRename(ws._id)"
                  @keydown.escape="renamingId = null"
                />
                <button @click="saveRename(ws._id)" class="text-xs px-2 py-1 bg-violet-600 hover:bg-violet-500 rounded text-white transition-colors">{{ wsRenaming ? $t('workspace.renaming') : $t('workspace.rename') }}</button>
                <button @click="renamingId = null" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">✕</button>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="ws._id !== workspaceStore.activeWorkspaceId"
                @click="switchTo(ws._id)"
                class="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors"
              >
                Switch
              </button>
              <button
                @click="startRename(ws)"
                class="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors"
              >
                {{ $t('workspace.rename') }}
              </button>
              <button
                v-if="workspaceStore.workspaces.length > 1"
                @click="deleteWorkspace(ws._id)"
                class="text-xs px-2.5 py-1 bg-red-900/50 hover:bg-red-800 rounded-lg text-red-400 hover:text-red-200 transition-colors"
              >
                {{ wsDeleting === ws._id ? $t('workspace.deleting') : $t('workspace.delete') }}
              </button>
            </div>
          </div>

          <!-- Error -->
          <p v-if="wsError" class="text-xs text-red-400">{{ wsError }}</p>

          <!-- Create new workspace -->
          <div class="pt-2 border-t border-gray-800">
            <p class="text-xs text-gray-500 mb-2">{{ $t('workspace.addNew') }}</p>
            <div class="flex gap-2">
              <input
                v-model="newWsName"
                type="text"
                :placeholder="$t('workspace.namePlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500"
                @keydown.enter="createWorkspace"
              />
              <button
                @click="createWorkspace"
                :disabled="!newWsName.trim() || wsCreating"
                class="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
              >
                {{ wsCreating ? $t('workspace.creating') : $t('workspace.create') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Refresh button -->
      <button
        @click="platformsStore.fetchStatuses()"
        class="w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
      >
        {{ $t('settings.refreshStatus') }}
      </button>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'
import { useHashtagStore, type HashtagGroup } from '../stores/hashtags'
import { useWorkspaceStore, type Workspace } from '../stores/workspace'
import { COMMON_TIMEZONES } from '../utils/timezone'
import { useRouter } from 'vue-router'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const platformsStore = usePlatformsStore()
const hashtagStore = useHashtagStore()
const workspaceStore = useWorkspaceStore()

// ─── Workspace management ────────────────────────────────────────────────────

const newWsName = ref('')
const wsCreating = ref(false)
const wsDeleting = ref<string | null>(null)
const wsRenaming = ref(false)
const wsError = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')

async function createWorkspace() {
  if (!newWsName.value.trim() || wsCreating.value) return
  wsCreating.value = true
  wsError.value = ''
  try {
    const ws = await workspaceStore.create(newWsName.value.trim())
    newWsName.value = ''
    await workspaceStore.setActive(ws._id)
    router.go(0)
  } catch {
    wsError.value = t('workspace.createError')
  } finally {
    wsCreating.value = false
  }
}

async function deleteWorkspace(id: string) {
  if (workspaceStore.workspaces.length <= 1) {
    wsError.value = t('workspace.deleteBlocked')
    return
  }
  if (!confirm(t('workspace.confirmDelete'))) return
  wsDeleting.value = id
  wsError.value = ''
  try {
    const wasActive = id === workspaceStore.activeWorkspaceId
    await workspaceStore.remove(id)
    if (wasActive) router.go(0)
  } catch {
    wsError.value = t('workspace.deleteError')
  } finally {
    wsDeleting.value = null
  }
}

function startRename(ws: Workspace) {
  renamingId.value = ws._id
  renameValue.value = ws.name
}

async function saveRename(id: string) {
  if (!renameValue.value.trim() || wsRenaming.value) return
  wsRenaming.value = true
  wsError.value = ''
  try {
    await workspaceStore.rename(id, renameValue.value.trim())
    renamingId.value = null
  } catch {
    wsError.value = t('workspace.renameError')
  } finally {
    wsRenaming.value = false
  }
}

async function switchTo(id: string) {
  await workspaceStore.setActive(id)
  router.go(0)
}

// ─── App credential form state ──────────────────────────────────────────────

const metaAppConfigured = computed(() => platformsStore.metaCredentials.configured)

// ─── Connected platforms derived from statuses ───────────────────────────────

const fbStatus = computed(() => platformsStore.getStatus('facebook'))
const igStatus = computed(() => platformsStore.getStatus('instagram'))
const fbConnected = computed(() => fbStatus.value?.connected ?? false)
const igConnected = computed(() => igStatus.value?.connected ?? false)

// Pull connected pages/accounts from the shared store
const fbPages = computed(() => platformsStore.connectedPages)
const igAccounts = computed(() => platformsStore.connectedIgAccounts)

async function loadMetaConnections() {
  await platformsStore.fetchMetaConnections()
}

// ─── OAuth discovery ─────────────────────────────────────────────────────────

const discovery = computed(() => platformsStore.metaDiscovery || { pages: [], igAccounts: [] })
const showDiscovery = computed(() => !!(platformsStore.metaDiscovery && (discovery.value.pages.length > 0 || discovery.value.igAccounts.length > 0)))

const selectedPageIds = ref<string[]>([])
const selectedIgAccountIds = ref<string[]>([])
const selectionError = ref('')

function pageNameForId(pageId: string): string {
  return discovery.value.pages.find((p) => p.id === pageId)?.name || pageId
}

async function confirmSelection() {
  selectionError.value = ''
  if (!selectedPageIds.value.length && !selectedIgAccountIds.value.length) {
    selectionError.value = platformsStore.metaError || 'Select at least one Page or Instagram account.'
    return
  }
  await platformsStore.saveMetaSelection(selectedPageIds.value, selectedIgAccountIds.value)
  await loadMetaConnections()
  selectedPageIds.value = []
  selectedIgAccountIds.value = []
}

// ─── OAuth error from callback redirect ──────────────────────────────────────

const oauthError = ref<string | null>(null)

// ─── Pinterest ────────────────────────────────────────────────────────────────

const pinterestOauthError = ref<string | null>(null)
const pinterestBoardsSaved = ref(false)
const selectedBoardIds = ref<string[]>([])

const pinterestAppConfigured = computed(() => platformsStore.pinterestCredentials.configured)
const pinterestConnected = computed(() => platformsStore.allPinterestBoards.length > 0)

async function savePinterestBoards() {
  await platformsStore.savePinterestBoards(selectedBoardIds.value)
  if (!platformsStore.pinterestError) {
    pinterestBoardsSaved.value = true
    setTimeout(() => { pinterestBoardsSaved.value = false }, 2500)
  }
}

function confirmPinterestDisconnect() {
  if (window.confirm(t('settings.pinterest.disconnectConfirm'))) {
    platformsStore.disconnectPinterest().then(loadMetaConnections)
  }
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

const tiktokOauthError = ref<string | null>(null)

const tiktokAppConfigured = computed(() => platformsStore.tiktokCredentials.configured)

function confirmTikTokDisconnect() {
  if (window.confirm(t('settings.tiktok.disconnectConfirm'))) {
    platformsStore.disconnectTikTok().then(loadMetaConnections)
  }
}

// ─── Workspace page/account selection ────────────────────────────────────────

const workspaceFbPageIds = ref<string[]>([])
const workspaceIgAccountIds = ref<string[]>([])
const fbPagesSaved = ref(false)
const igAccountsSaved = ref(false)

async function saveFbPageSelection() {
  await platformsStore.saveFbPageSelection(workspaceFbPageIds.value)
  if (!platformsStore.metaError) {
    fbPagesSaved.value = true
    setTimeout(() => { fbPagesSaved.value = false }, 2500)
  }
}

async function saveIgAccountSelection() {
  await platformsStore.saveIgAccountSelection(workspaceIgAccountIds.value)
  if (!platformsStore.metaError) {
    igAccountsSaved.value = true
    setTimeout(() => { igAccountsSaved.value = false }, 2500)
  }
}

// ─── Hashtag Groups ──────────────────────────────────────────────────────────

const addingHashtagGroup = ref(false)
const newGroupName = ref('')
const newGroupHashtags = ref('')
const editingGroupId = ref('')
const editGroupName = ref('')
const editGroupHashtags = ref('')
const showHashtagStats = ref(false)
const statsSort = ref<'count' | 'engagement'>('count')
const statsAccount = ref('')

// Auto-reload stats when account filter changes
watch(statsAccount, (acct) => {
  if (showHashtagStats.value) hashtagStore.fetchStats(statsSort.value, acct || undefined)
})
const selectedAiTags = ref(new Set<string>())
const aiGroupName = ref('')

function parseHashtagInput(raw: string): string[] {
  return [...new Set(
    raw.replace(/,/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1)
  )]
}

function toggleAiTag(tag: string) {
  const s = new Set(selectedAiTags.value)
  if (s.has(tag)) s.delete(tag)
  else s.add(tag)
  selectedAiTags.value = s
}

async function handleCreateGroup() {
  if (!newGroupName.value.trim()) return
  const tags = parseHashtagInput(newGroupHashtags.value)
  await hashtagStore.createGroup(newGroupName.value.trim(), tags)
  newGroupName.value = ''
  newGroupHashtags.value = ''
  addingHashtagGroup.value = false
}

function startEditGroup(group: HashtagGroup) {
  editingGroupId.value = group._id
  editGroupName.value = group.name
  editGroupHashtags.value = group.hashtags.join(' ')
}

async function saveEditGroup(id: string) {
  const tags = parseHashtagInput(editGroupHashtags.value)
  await hashtagStore.updateGroup(id, editGroupName.value.trim(), tags)
  editingGroupId.value = ''
}

async function handleDeleteGroup(id: string) {
  if (window.confirm(t('settings.hashtags.deleteConfirm'))) {
    await hashtagStore.deleteGroup(id)
  }
}

async function scrapeHashtagsNow() {
  await hashtagStore.scrapeHashtags(statsAccount.value || undefined)
  statsSort.value = 'count'
}

async function handleAiSuggest() {
  await hashtagStore.aiSuggest(statsAccount.value || undefined)
}

async function createGroupFromAi() {
  if (!aiGroupName.value.trim() || !selectedAiTags.value.size) return
  await hashtagStore.createGroup(aiGroupName.value.trim(), [...selectedAiTags.value])
  aiGroupName.value = ''
  selectedAiTags.value = new Set()
  hashtagStore.aiSuggestions.splice(0)
}

function gradeLabel(grade: string): string {
  const map: Record<string, string> = { A: '🔥 A', B: '✅ B', C: '🔵 C', D: '⚪ D' }
  return map[grade] || grade
}

// ─── Other platforms (not Meta) ──────────────────────────────────────────────

const otherPlatforms = computed(() => {
  const skip = new Set(['instagram', 'facebook', 'pinterest', 'tiktok'])
  return Object.fromEntries(Object.entries(PLATFORM_META).filter(([k]) => !skip.has(k)))
})

function isConnected(platform: string) {
  return platformsStore.isConnected(platform)
}

function getStatus(platform: string) {
  return platformsStore.getStatus(platform)
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

function confirmDisconnect() {
  if (window.confirm(platformsStore.metaCredentials?.appId ? 'This will disconnect all Facebook Pages and Instagram accounts. Continue?' : '')) {
    platformsStore.disconnectMeta().then(loadMetaConnections)
  }
}

// ─── Token auto-refresh ───────────────────────────────────────────────────────

const tokenRefreshing = ref(false)
const tokenRefreshDone = ref(false)

async function handleTokenRefresh() {
  tokenRefreshing.value = true
  tokenRefreshDone.value = false
  try {
    await platformsStore.refreshMetaTokens()
    tokenRefreshDone.value = true
    setTimeout(() => { tokenRefreshDone.value = false }, 3000)
  } finally {
    tokenRefreshing.value = false
  }
}

// ─── Account Profiles ────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual',       label: 'Casual' },
  { value: 'friendly',     label: 'Friendly' },
  { value: 'formal',       label: 'Formal' },
  { value: 'humorous',     label: 'Humorous' },
  { value: 'inspiring',    label: 'Inspiring' },
  { value: 'educational',  label: 'Educational' },
]

interface AccountProfile {
  businessName: string
  description: string
  websiteUrl: string
  industry: string
  targetAudience: string
  toneOfVoice: string
  keywords: string
  hashtags: string
  postingGuidelines: string
  timezone: string
}

interface ProfileAccount {
  key: string
  label: string
  platform: string
  color: string
  avatar: string | null
}

function emptyProfile(): AccountProfile {
  return { businessName: '', description: '', websiteUrl: '', industry: '', targetAudience: '', toneOfVoice: '', keywords: '', hashtags: '', postingGuidelines: '', timezone: '' }
}

const editingProfiles = ref<Record<string, AccountProfile>>({})
const profileSaving   = ref<string | null>(null)
const profileSavedKey = ref<string | null>(null)
const profileAuditing    = ref<string | null>(null)
const profileAudits      = ref<Record<string, any>>({})
const industryDiagnosing = ref<string | null>(null)
const industryDiagnoses  = ref<Record<string, any>>({})
const fiveForcesRunning  = ref<string | null>(null)
const fiveForcesResults  = ref<Record<string, any>>({})

const allConnectedAccounts = computed((): ProfileAccount[] => {
  const accounts: ProfileAccount[] = []

  for (const [platform, meta] of Object.entries(PLATFORM_META)) {
    if (platform === 'facebook' || platform === 'instagram' || platform === 'pinterest' || platform === 'tiktok') continue
    if (platformsStore.isConnected(platform)) {
      const status = platformsStore.getStatus(platform)
      const username = status?.username || status?.displayName
      const label = username ? `${t(`platforms.${platform}`)} (@${username})` : t(`platforms.${platform}`)
      accounts.push({ key: platform, label, platform, color: meta.color, avatar: null })
    }
  }

  if (platformsStore.tiktokConnected) {
    accounts.push({
      key: 'tiktok',
      label: platformsStore.tiktokUsername ? `@${platformsStore.tiktokUsername}` : 'TikTok',
      platform: 'tiktok',
      color: PLATFORM_META.tiktok.color,
      avatar: null,
    })
  }

  for (const page of platformsStore.connectedPages) {
    accounts.push({ key: `facebook:${page.id}`, label: page.name, platform: 'facebook', color: PLATFORM_META.facebook.color, avatar: page.picture || null })
  }

  for (const account of platformsStore.connectedIgAccounts) {
    accounts.push({ key: `instagram:${account.id}`, label: `@${account.username}`, platform: 'instagram', color: PLATFORM_META.instagram.color, avatar: account.avatar || null })
  }

  for (const board of platformsStore.connectedPinterestBoards) {
    accounts.push({ key: `pinterest:${board.id}`, label: board.name, platform: 'pinterest', color: PLATFORM_META.pinterest.color, avatar: null })
  }

  return accounts
})

function profileFilled(key: string): boolean {
  const p = editingProfiles.value[key]
  return !!p && !!(p.businessName || p.description || p.industry)
}

async function runFiveForces(key: string) {
  fiveForcesRunning.value = key
  try {
    const res = await axios.post('/api/ai/five-forces', { accountKey: key })
    fiveForcesResults.value = { ...fiveForcesResults.value, [key]: res.data }
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Five Forces analysis failed'
    const detail = err.response?.data?.detail
    alert(detail ? `${msg}\n\n${detail}` : msg)
  } finally {
    fiveForcesRunning.value = null
  }
}

async function diagnoseIndustry(key: string) {
  industryDiagnosing.value = key
  try {
    const res = await axios.post('/api/ai/industry-diagnosis', { accountKey: key })
    industryDiagnoses.value = { ...industryDiagnoses.value, [key]: res.data }
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Industry diagnosis failed'
    const detail = err.response?.data?.detail
    alert(detail ? `${msg}\n\n${detail}` : msg)
  } finally {
    industryDiagnosing.value = null
  }
}

async function auditProfile(key: string) {
  profileAuditing.value = key
  try {
    const res = await axios.post(`/api/profiles/${encodeURIComponent(key)}/audit`)
    profileAudits.value = { ...profileAudits.value, [key]: res.data }
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Profile audit failed'
    const detail = err.response?.data?.detail
    alert(detail ? `${msg}\n\n${detail}` : msg)
  } finally {
    profileAuditing.value = null
  }
}

async function saveProfile(key: string) {
  profileSaving.value = key
  try {
    await axios.put(`/api/profiles/${encodeURIComponent(key)}`, editingProfiles.value[key])
    profileSavedKey.value = key
    setTimeout(() => { if (profileSavedKey.value === key) profileSavedKey.value = null }, 2500)
  } catch (err) {
    console.error('Save profile error:', err)
  } finally {
    profileSaving.value = null
  }
}

// ─── On mount ────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Check for OAuth callback query params
  if (route.query.meta_discovery) {
    await platformsStore.fetchMetaDiscovery()
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.meta_error) {
    oauthError.value = decodeURIComponent(String(route.query.meta_error))
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.pinterest_connected) {
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.pinterest_error) {
    pinterestOauthError.value = decodeURIComponent(String(route.query.pinterest_error))
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.tiktok_connected) {
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.tiktok_error) {
    tiktokOauthError.value = decodeURIComponent(String(route.query.tiktok_error))
    window.history.replaceState({}, '', '/settings')
  }

  await Promise.all([
    platformsStore.fetchStatuses(),
    platformsStore.fetchMetaCredentials(),
    platformsStore.fetchPinterestCredentials(),
    platformsStore.fetchTikTokCredentials(),
    loadMetaConnections(),
    platformsStore.fetchTokenExpiry(),
    hashtagStore.fetchGroups(),
  ])

  // Seed board checkboxes from current selection
  selectedBoardIds.value = platformsStore.allPinterestBoards.filter((b) => b.selected).map((b) => b.id)

  // Seed workspace page/account selection from current saved state
  workspaceFbPageIds.value = platformsStore.allFbPages.filter((p) => p.selected).map((p) => p.id)
  workspaceIgAccountIds.value = platformsStore.allIgAccounts.filter((a) => a.selected).map((a) => a.id)

  // Load workspace business profile
  try {
    const res = await axios.get(`/api/profiles/${encodeURIComponent('workspace')}`)
    const { _id, updatedAt, ...data } = res.data
    editingProfiles.value['workspace'] = { ...emptyProfile(), ...data }
  } catch {
    editingProfiles.value['workspace'] = emptyProfile()
  }
})
</script>
