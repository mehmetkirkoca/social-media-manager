<template>
  <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <router-link to="/dashboard" class="text-white font-bold text-lg tracking-tight shrink-0">
      📡 SocialManager
    </router-link>

    <div class="flex items-center gap-1 overflow-x-auto">
      <router-link
        v-for="link in navLinks"
        :key="link.to"
        :to="link.to"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
        :class="$route.path.startsWith(link.to) && link.to !== '/'
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800'"
      >
        {{ $t(link.label) }}
      </router-link>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <!-- Workspace switcher -->
      <div class="relative">
        <button
          @click="showWorkspaceMenu = !showWorkspaceMenu"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors max-w-[160px]"
          :title="$t('workspace.switchLabel')"
        >
          <span class="text-xs">🏢</span>
          <span class="truncate">{{ activeWorkspace?.name || $t('workspace.defaultName') }}</span>
          <span class="text-xs opacity-50 shrink-0">▾</span>
        </button>

        <div
          v-if="showWorkspaceMenu"
          class="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-50 min-w-[200px]"
        >
          <div class="px-3 py-2 border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
            {{ $t('workspace.label') }}
          </div>
          <button
            v-for="ws in workspaces"
            :key="ws._id"
            @click="switchWorkspace(ws._id)"
            class="flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-colors hover:bg-gray-700 text-left"
            :class="ws._id === activeWorkspaceId ? 'text-white font-medium' : 'text-gray-400'"
          >
            <span class="flex-1 truncate">{{ ws.name || $t('workspace.defaultName') }}</span>
            <span v-if="ws._id === activeWorkspaceId" class="text-violet-400 text-xs shrink-0">{{ $t('workspace.activeLabel') }}</span>
          </button>
          <div class="border-t border-gray-700">
            <router-link
              to="/settings#workspaces"
              @click="showWorkspaceMenu = false"
              class="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              <span class="text-xs">⚙️</span>
              <span>{{ $t('workspace.manage') }}</span>
            </router-link>
          </div>
        </div>
      </div>

      <!-- Language switcher -->
      <div class="relative">
        <button
          @click="showLangMenu = !showLangMenu"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <span>{{ currentLocale.flag }}</span>
          <span>{{ currentLocale.code.toUpperCase() }}</span>
          <span class="text-xs opacity-50">▾</span>
        </button>

        <div
          v-if="showLangMenu"
          class="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-50 min-w-[140px]"
        >
          <button
            v-for="loc in SUPPORTED_LOCALES"
            :key="loc.code"
            @click="setLocale(loc.code)"
            class="flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-colors hover:bg-gray-700"
            :class="locale === loc.code ? 'text-white font-medium' : 'text-gray-400'"
          >
            <span>{{ loc.flag }}</span>
            <span>{{ loc.label }}</span>
            <span v-if="locale === loc.code" class="ml-auto text-blue-400 text-xs">✓</span>
          </button>
        </div>
      </div>
    </div>
  </nav>

  <!-- Overlays to close menus -->
  <div v-if="showLangMenu || showWorkspaceMenu" class="fixed inset-0 z-40" @click="closeMenus" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { SUPPORTED_LOCALES } from '../locales'
import { useWorkspaceStore } from '../stores/workspace'

const { locale } = useI18n()
const router = useRouter()
const showLangMenu = ref(false)
const showWorkspaceMenu = ref(false)

const workspaceStore = useWorkspaceStore()
const { workspaces, activeWorkspaceId, activeWorkspace } = storeToRefs(workspaceStore)

const navLinks = [
  { to: '/dashboard',        label: 'nav.feed' },
  { to: '/compose',          label: 'nav.compose' },
  { to: '/media',            label: 'nav.media' },
  { to: '/scheduler',        label: 'nav.scheduler' },
  { to: '/analytics',        label: 'nav.analytics' },
  { to: '/calendar-plan',    label: 'nav.calendarPlan' },
  { to: '/competitors',      label: 'nav.competitors' },
  { to: '/settings',         label: 'nav.settings' },
  { to: '/global-settings',  label: 'nav.globalSettings' },
]

const currentLocale = computed(
  () => SUPPORTED_LOCALES.find((l) => l.code === locale.value) ?? SUPPORTED_LOCALES[0]
)

function closeMenus() {
  showLangMenu.value = false
  showWorkspaceMenu.value = false
}

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('locale', code)
  showLangMenu.value = false
}

async function switchWorkspace(id: string) {
  await workspaceStore.setActive(id)
  showWorkspaceMenu.value = false
  // Reload current route so stores re-fetch with the new workspace header
  router.go(0)
}
</script>
