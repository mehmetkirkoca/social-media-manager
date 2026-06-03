<template>
  <div class="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-100">

    <!-- Header toolbar -->
    <header class="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
      <h1 class="text-base font-bold flex-1">{{ $t('media.title') }}</h1>

      <span class="text-xs text-gray-500">{{ $t('media.fileCount', { count: files.length }) }}</span>

      <!-- Upload button -->
      <button
        @click="fileInputRef?.click()"
        :disabled="uploading"
        class="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {{ uploading ? $t('media.uploading') : $t('media.upload') }}
      </button>

      <!-- Hidden multi-file input -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo"
        multiple
        class="hidden"
        @change="handleFiles"
      />
    </header>

    <!-- Upload progress bar -->
    <div v-if="uploading" class="flex-shrink-0 bg-blue-900/30 border-b border-blue-800/40 px-6 py-2 text-xs text-blue-300 flex items-center gap-3">
      <svg class="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      {{ uploadStatus }}
    </div>

    <!-- Upload error -->
    <div v-if="uploadError" class="flex-shrink-0 bg-red-900/30 border-b border-red-800/40 px-6 py-2 text-xs text-red-300 flex items-center justify-between">
      <span>{{ uploadError }}</span>
      <button @click="uploadError = ''" class="text-red-400 hover:text-red-200">✕</button>
    </div>

    <!-- Body: sidebar + main -->
    <div class="flex flex-1 overflow-hidden">

      <!-- Folder sidebar -->
      <aside class="w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto">

        <!-- All Files -->
        <button
          @click="setFolder(null)"
          :class="activeFolder === null ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'"
          class="flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors text-left"
        >
          <span>{{ $t('media.allFiles') }}</span>
          <span class="text-xs opacity-60">{{ totalCount }}</span>
        </button>

        <!-- Unorganized -->
        <button
          @click="setFolder('__none__')"
          :class="activeFolder === '__none__' ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'"
          class="flex items-center justify-between px-4 py-2 text-sm transition-colors text-left"
        >
          <span>{{ $t('media.unorganized') }}</span>
          <span class="text-xs opacity-60">{{ unorganizedCount }}</span>
        </button>

        <!-- Accounts section -->
        <div v-if="accountFolders.length" class="mt-3">
          <p class="px-4 py-1 text-xs text-gray-600 font-semibold uppercase tracking-wider">{{ $t('media.accounts') }}</p>
          <button
            v-for="af in accountFolders"
            :key="af.key"
            @click="setFolder(af.key)"
            :class="activeFolder === af.key ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'"
            class="flex items-center justify-between px-4 py-2 text-sm transition-colors text-left w-full"
          >
            <span class="truncate">{{ af.label }}</span>
            <span class="text-xs opacity-60 ml-1 flex-shrink-0">{{ folderCounts[af.key] || 0 }}</span>
          </button>
        </div>

        <!-- Custom Folders section -->
        <div class="mt-3 flex-1">
          <p class="px-4 py-1 text-xs text-gray-600 font-semibold uppercase tracking-wider">{{ $t('media.folders') }}</p>

          <button
            v-for="folder in customFolders"
            :key="folder.name"
            @click="setFolder(folder.name)"
            :class="activeFolder === folder.name ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'"
            class="group flex items-center justify-between px-4 py-2 text-sm transition-colors text-left w-full"
          >
            <span class="truncate flex-1">{{ folder.name }}</span>
            <span class="text-xs opacity-60 mr-1">{{ folder.count }}</span>
            <span
              @click.stop="deleteFolder(folder.name)"
              class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity ml-1"
              title="Delete folder"
            >✕</span>
          </button>

          <!-- New folder inline input -->
          <div class="px-3 py-2">
            <div v-if="!showNewFolderInput">
              <button
                @click="showNewFolderInput = true"
                class="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-md transition-colors"
              >
                <span class="text-base leading-none">+</span>
                {{ $t('media.newFolder') }}
              </button>
            </div>
            <div v-else class="flex gap-1">
              <input
                ref="newFolderInputRef"
                v-model="newFolderName"
                type="text"
                :placeholder="$t('media.folderNamePlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-600 min-w-0"
                @keydown.enter="createFolder"
                @keydown.escape="cancelNewFolder"
              />
              <button @click="createFolder" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-xs">✓</button>
              <button @click="cancelNewFolder" class="px-1.5 py-1 text-gray-500 hover:text-gray-300 rounded-md text-xs">✕</button>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main content area -->
      <div class="flex-1 flex flex-col overflow-hidden">

        <!-- Drag-and-drop zone (shown when no files or as overlay) -->
        <div
          v-if="!files.length && !loading"
          class="flex-1 flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-800 m-6 rounded-2xl cursor-pointer hover:border-blue-700 hover:bg-blue-950/10 transition-colors"
          @click="fileInputRef?.click()"
          @dragover.prevent
          @drop.prevent="handleDrop"
        >
          <svg class="w-12 h-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V8a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div class="text-center">
            <p class="text-gray-400 font-medium">{{ $t('media.dropZoneTitle') }}</p>
            <p class="text-gray-600 text-sm mt-1">{{ $t('media.dropZoneHint') }}</p>
          </div>
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="loading" class="flex-1 overflow-y-auto p-6">
          <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-9 gap-2">
            <div v-for="i in 12" :key="i" class="aspect-square rounded-xl bg-gray-800 animate-pulse" />
          </div>
        </div>

        <!-- Media grid -->
        <div
          v-else
          class="flex-1 overflow-y-auto p-6"
          @dragover.prevent
          @drop.prevent="handleDrop"
        >
          <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-9 gap-2">
            <div
              v-for="file in files"
              :key="file._id"
              class="group relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors"
            >
              <!-- Image thumbnail -->
              <img
                v-if="isImage(file.mimetype)"
                :src="file.url"
                :alt="file.originalName"
                class="w-full h-full object-cover"
                loading="lazy"
              />

              <!-- Video thumbnail -->
              <div v-else class="relative w-full h-full bg-gray-800">
                <video
                  :src="file.url"
                  class="w-full h-full object-cover"
                  preload="metadata"
                  muted
                  playsinline
                  @loadedmetadata="seekVideoToThumbnail"
                />
                <div class="absolute inset-0 flex items-end justify-start p-1.5 pointer-events-none">
                  <span class="bg-black/60 rounded px-1 py-0.5 text-xs text-gray-300 leading-none">▶</span>
                </div>
              </div>

              <!-- Hover overlay -->
              <div
                class="absolute inset-0 bg-black/80 transition-opacity flex flex-col justify-between p-2"
                :class="movingFileId === file._id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
              >
                <!-- Move-to-folder panel -->
                <template v-if="movingFileId === file._id">
                  <div class="flex flex-col h-full">
                    <p class="text-xs text-gray-300 font-medium mb-1.5">{{ $t('media.moveToFolder') }}</p>
                    <div class="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
                      <!-- Remove from folder -->
                      <button
                        v-if="file.folder"
                        @click="moveFileTo(file, null)"
                        class="w-full text-left px-2 py-1 rounded text-xs text-gray-400 hover:bg-gray-700 transition-colors"
                      >
                        {{ $t('media.removeFolderAssign') }}
                      </button>
                      <!-- Account folders -->
                      <button
                        v-for="af in accountFolders"
                        :key="af.key"
                        @click="moveFileTo(file, af.key)"
                        :class="file.folder === af.key ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-700'"
                        class="w-full text-left px-2 py-1 rounded text-xs transition-colors truncate"
                      >{{ af.label }}</button>
                      <!-- Custom folders -->
                      <button
                        v-for="cf in customFolders"
                        :key="cf.name"
                        @click="moveFileTo(file, cf.name)"
                        :class="file.folder === cf.name ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-700'"
                        class="w-full text-left px-2 py-1 rounded text-xs transition-colors truncate"
                      >{{ cf.name }}</button>
                    </div>
                    <button
                      @click="movingFileId = null"
                      class="mt-1.5 w-full py-1 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-300 transition-colors"
                    >{{ $t('media.cancel') }}</button>
                  </div>
                </template>

                <!-- Normal actions -->
                <template v-else>
                  <div class="truncate">
                    <p class="text-xs text-white font-medium truncate">{{ file.originalName }}</p>
                    <p class="text-xs text-gray-400">{{ formatSize(file.size) }}</p>
                    <p v-if="file.folder" class="text-xs text-blue-400 truncate mt-0.5">{{ folderLabel(file.folder) }}</p>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <button
                      @click="useInPost(file.url)"
                      class="w-full py-1 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-medium text-white transition-colors"
                    >{{ $t('media.useInPost') }}</button>
                    <div class="flex gap-1">
                      <button
                        @click="copyUrl(file.url)"
                        class="flex-1 py-1 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-200 transition-colors"
                        :class="copied === file.url ? 'bg-green-700 hover:bg-green-700' : ''"
                      >{{ copied === file.url ? '✓' : $t('media.copyUrl') }}</button>
                      <button
                        @click="movingFileId = file._id"
                        class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-300 transition-colors"
                        :title="$t('media.moveToFolder')"
                      >📁</button>
                      <button
                        @click="confirmDelete(file)"
                        class="px-2 py-1 bg-gray-700 hover:bg-red-700 rounded-md text-xs text-gray-300 hover:text-white transition-colors"
                        title="Delete"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="deleteTarget" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h2 class="font-semibold text-white mb-2">{{ $t('media.deleteConfirmTitle') }}</h2>
        <p class="text-sm text-gray-400 mb-1 truncate">{{ deleteTarget.originalName }}</p>
        <p class="text-xs text-gray-600 mb-5">{{ $t('media.deleteConfirmHint') }}</p>
        <div class="flex gap-3 justify-end">
          <button
            @click="deleteTarget = null"
            class="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >{{ $t('media.cancel') }}</button>
          <button
            @click="doDelete"
            :disabled="deleting"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >{{ deleting ? $t('media.deleting') : $t('media.delete') }}</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { usePlatformsStore } from '../stores/platforms'

interface MediaFile {
  _id: string
  filename: string
  originalName: string
  url: string
  mimetype: string
  size: number
  uploadedAt: string
  folder?: string | null
}

interface CustomFolder {
  name: string
  count: number
}

interface AccountFolder {
  key: string
  label: string
}

const router = useRouter()
const platformsStore = usePlatformsStore()

const files = ref<MediaFile[]>([])
const loading = ref(true)
const uploading = ref(false)
const uploadStatus = ref('')
const uploadError = ref('')
const deleting = ref(false)
const deleteTarget = ref<MediaFile | null>(null)
const copied = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const activeFolder = ref<string | null>(null)
const customFolders = ref<CustomFolder[]>([])
const totalCount = ref(0)
const unorganizedCount = ref(0)
const folderCounts = ref<Record<string, number>>({})

const showNewFolderInput = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

const movingFileId = ref<string | null>(null)

// Profile map: accountKey → businessName (used to group accounts under one folder)
const profileMap = ref<Record<string, string>>({})

async function fetchProfiles() {
  try {
    const res = await axios.get('/api/profiles')
    const map: Record<string, string> = {}
    for (const p of res.data as Array<{ _id: string; businessName?: string }>) {
      if (p.businessName?.trim()) map[p._id] = p.businessName.trim()
    }
    profileMap.value = map
  } catch { }
}

const accountFolders = computed<AccountFolder[]>(() => {
  const { connectedPages, connectedIgAccounts, connectedPinterestBoards } = platformsStore
  // Use a Map keyed by folder label to deduplicate accounts with the same business name
  const seen = new Map<string, AccountFolder>()

  function add(platformKey: string, fallbackLabel: string) {
    const label = profileMap.value[platformKey] || fallbackLabel
    if (!seen.has(label)) seen.set(label, { key: label, label })
  }

  for (const page of connectedPages) {
    add(`facebook:${page.id}`, page.name)
  }
  for (const acc of connectedIgAccounts) {
    add(`instagram:${acc.id}`, acc.username)
  }
  if (connectedPinterestBoards.length > 0) {
    // All boards belong to one Pinterest account — one folder entry
    add('pinterest', 'Pinterest')
  }

  const standardPlatforms = [
    { key: 'twitter', label: 'Twitter/X' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'mastodon', label: 'Mastodon' },
    { key: 'bluesky', label: 'Bluesky' },
    { key: 'reddit', label: 'Reddit' },
    { key: 'youtube', label: 'YouTube' },
  ]
  for (const p of standardPlatforms) {
    const status = platformsStore.statuses.find((s) => s.platform === p.key)
    if (status?.connected) add(p.key, p.label)
  }

  return Array.from(seen.values())
})

function folderLabel(key: string): string {
  return accountFolders.value.find((a) => a.key === key)?.label ?? key
}

onMounted(async () => {
  await platformsStore.fetchMetaConnections()
  await Promise.all([fetchProfiles(), fetchFolders(), fetchLibrary()])
})

async function fetchFolders() {
  try {
    const res = await axios.get('/api/media-folders')
    customFolders.value = res.data.folders
    totalCount.value = res.data.totalCount
    unorganizedCount.value = res.data.unorganizedCount
    folderCounts.value = res.data.folderCounts || {}
  } catch {
    // ignore
  }
}

async function fetchLibrary() {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (activeFolder.value !== null) params.folder = activeFolder.value
    const res = await axios.get('/api/media-library', { params })
    files.value = res.data.files
  } catch {
    // silently fail — empty grid shown
  } finally {
    loading.value = false
  }
}

function setFolder(key: string | null) {
  activeFolder.value = key
  movingFileId.value = null
  fetchLibrary()
}

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  try {
    await axios.post('/api/media-folders', { name })
    newFolderName.value = ''
    showNewFolderInput.value = false
    await fetchFolders()
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? 'Could not create folder'
  }
}

function cancelNewFolder() {
  newFolderName.value = ''
  showNewFolderInput.value = false
}

async function deleteFolder(name: string) {
  try {
    await axios.delete(`/api/media-folders/${encodeURIComponent(name)}`)
    if (activeFolder.value === name) activeFolder.value = null
    await Promise.all([fetchFolders(), fetchLibrary()])
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? 'Could not delete folder'
  }
}

async function moveFileTo(file: MediaFile, folder: string | null) {
  try {
    await axios.patch(`/api/media/${file.filename}`, { folder })
    file.folder = folder
    movingFileId.value = null
    await fetchFolders()
    if (activeFolder.value !== null) await fetchLibrary()
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? 'Move failed'
    movingFileId.value = null
  }
}

async function handleFiles(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files ?? [])
  if (selected.length) await uploadFiles(selected)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function handleDrop(event: DragEvent) {
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (dropped.length) uploadFiles(dropped)
}

async function uploadFiles(fileList: File[]) {
  uploading.value = true
  uploadError.value = ''
  const total = fileList.length

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    uploadStatus.value = total > 1
      ? `Uploading ${i + 1} of ${total}: ${file.name}`
      : `Uploading ${file.name}…`

    try {
      const form = new FormData()
      form.append('file', file)
      const params: Record<string, string> = {}
      if (activeFolder.value && activeFolder.value !== '__none__') {
        params.folder = activeFolder.value
      }
      await axios.post('/api/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params,
      })
    } catch (err: any) {
      uploadError.value = `${file.name}: ${err.response?.data?.error ?? 'Upload failed'}`
    }
  }

  uploading.value = false
  uploadStatus.value = ''
  await Promise.all([fetchFolders(), fetchLibrary()])
}

function confirmDelete(file: MediaFile) {
  deleteTarget.value = file
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await axios.delete(`/api/media/${deleteTarget.value.filename}`)
    files.value = files.value.filter((f) => f.filename !== deleteTarget.value!.filename)
    deleteTarget.value = null
    await fetchFolders()
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? 'Delete failed'
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${url}`)
    copied.value = url
    setTimeout(() => { copied.value = '' }, 2000)
  } catch {
    // fallback: select the text
  }
}

function useInPost(url: string) {
  router.push({ path: '/compose', query: { media: url } })
}

function isImage(mimetype: string) {
  return mimetype.startsWith('image/')
}

function seekVideoToThumbnail(event: Event) {
  const video = event.target as HTMLVideoElement
  if (video.duration > 0) {
    video.currentTime = Math.min(0.5, video.duration * 0.25)
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
