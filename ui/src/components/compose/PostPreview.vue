<template>
  <div class="h-full flex flex-col">
    <!-- Preview tab strip -->
    <div v-if="selectedDestinations.length > 1" class="flex gap-1 mb-3 flex-wrap">
      <button
        v-for="dest in selectedDestinations"
        :key="dest.key"
        @click="$emit('update:activeKey', dest.key)"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeKey === dest.key ? 'text-white' : 'text-gray-500 hover:text-gray-300 bg-transparent'"
        :style="activeKey === dest.key ? { backgroundColor: dest.color } : {}"
      >
        <img v-if="dest.picture" :src="dest.picture" class="w-4 h-4 rounded-full object-cover" />
        <span v-else class="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold" style="font-size:9px" :style="{ backgroundColor: dest.color }">
          {{ dest.label[0] }}
        </span>
        {{ dest.label }}
      </button>
    </div>

    <!-- No destination selected -->
    <div v-if="!activeDest" class="flex-1 flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
      <span class="text-3xl">👁</span>
      <p>Select an account to see a preview</p>
    </div>

    <!-- Facebook preview -->
    <div v-else-if="activeDest.platform === 'facebook'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900">
      <div class="flex items-center gap-2 p-3">
        <img v-if="activeDest.picture" :src="activeDest.picture" class="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        <div v-else class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm" style="background:#1877F2">f</div>
        <div>
          <p class="font-semibold text-sm leading-tight">{{ activeDest.label }}</p>
          <p class="text-xs text-gray-400 leading-tight">Just now · <span class="text-gray-400">🌐</span></p>
        </div>
      </div>
      <p v-if="content" class="px-3 pb-3 text-sm whitespace-pre-wrap">{{ content }}</p>
      <p v-else class="px-3 pb-3 text-sm text-gray-300 italic">Start writing to see preview…</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover max-h-72" @error="imgError = true" />
      <div class="border-t border-gray-100 mx-3"></div>
      <div class="flex px-3 py-2 gap-1 text-gray-500 text-xs">
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">👍 Like</button>
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">💬 Comment</button>
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">↗ Share</button>
      </div>
    </div>

    <!-- Instagram preview -->
    <div v-else-if="activeDest.platform === 'instagram'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900">
      <div class="flex items-center gap-2 p-2.5">
        <img v-if="activeDest.picture" :src="activeDest.picture" class="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-2 ring-pink-400 ring-offset-1" />
        <div v-else class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold" style="background:#E1306C">I</div>
        <span class="font-semibold text-sm">{{ activeDest.label.replace('@','') }}</span>
        <span class="ml-auto text-gray-400 text-xl leading-none">···</span>
      </div>
      <div class="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        <img v-if="mediaUrl" :src="mediaUrl" class="w-full h-full object-cover" />
        <div v-else class="flex flex-col items-center gap-2 text-gray-400">
          <svg class="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <p class="text-xs">Add an image URL</p>
        </div>
      </div>
      <div class="flex items-center gap-3 px-3 py-2 text-gray-700">
        <span class="text-lg">❤️</span><span class="text-lg">💬</span><span class="text-lg">↗</span>
        <span class="ml-auto text-lg">🔖</span>
      </div>
      <div class="px-3 pb-3 text-sm">
        <span class="font-semibold">{{ activeDest.label.replace('@','') }}</span>
        <span class="ml-1 text-gray-700">{{ content || '' }}</span>
      </div>
    </div>

    <!-- Twitter/X preview -->
    <div v-else-if="activeDest.platform === 'twitter'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900 p-4">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white font-bold flex-shrink-0">X</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="font-bold text-sm">Twitter / X</span>
            <svg class="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="text-gray-400 text-sm">· Just now</span>
          </div>
          <p class="text-sm mt-1 whitespace-pre-wrap">{{ content || 'Start writing…' }}</p>
          <img v-if="mediaUrl" :src="mediaUrl" class="mt-2 rounded-2xl w-full object-cover max-h-52 border border-gray-100" />
          <div class="flex gap-6 text-gray-500 text-sm mt-3">
            <span>💬</span><span>↺</span><span>❤</span><span>↗</span>
          </div>
        </div>
      </div>
    </div>

    <!-- LinkedIn preview -->
    <div v-else-if="activeDest.platform === 'linkedin'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900 p-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">in</div>
        <div>
          <p class="font-semibold text-sm leading-tight">Your Name</p>
          <p class="text-xs text-gray-400">Just now · 🌐</p>
        </div>
      </div>
      <p class="text-sm whitespace-pre-wrap mb-3">{{ content || 'Start writing…' }}</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover rounded max-h-64 mb-3" />
      <div class="border-t border-gray-100 pt-2 flex gap-4 text-gray-500 text-xs">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span>
      </div>
    </div>

    <!-- Generic preview -->
    <div v-else class="bg-gray-900 rounded-xl shadow overflow-hidden border border-gray-800 p-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" :style="{ backgroundColor: activeDest.color }">
          {{ activeDest.label[0] }}
        </div>
        <div>
          <p class="font-semibold text-sm text-white leading-tight">{{ activeDest.label }}</p>
          <p class="text-xs text-gray-500">Just now</p>
        </div>
      </div>
      <p class="text-sm text-gray-300 whitespace-pre-wrap">{{ content || 'Start writing…' }}</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover rounded-lg mt-3 max-h-52" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Destination } from '../../stores/compose'

const props = defineProps<{
  selectedDestinations: Destination[]
  activeKey: string
  content: string
  mediaUrl: string
}>()

defineEmits<{ (e: 'update:activeKey', key: string): void }>()

const imgError = ref(false)

const activeDest = computed(() =>
  props.selectedDestinations.find((d) => d.key === props.activeKey) ?? props.selectedDestinations[0] ?? null
)
</script>
