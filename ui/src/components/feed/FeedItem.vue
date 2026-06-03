<template>
  <article
    class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800/80 hover:border-gray-700 transition-colors"
    :style="{ borderLeftColor: platformColor, borderLeftWidth: '3px' }"
  >
    <!-- Image-first layout for Instagram (and any post with media) -->
    <template v-if="isImageFirst && item.media[0]">
      <div class="relative">
        <img
          :src="item.media[0].thumbnail || item.media[0].url"
          :alt="item.media[0].alt || ''"
          class="w-full object-cover max-h-44"
        />
        <!-- Platform badge over image -->
        <span
          class="absolute top-2 right-2 text-xs font-semibold px-1.5 py-0.5 rounded"
          :style="{ backgroundColor: platformColor, color: '#fff' }"
        >
          {{ $t(`platforms.${item.platform}`) }}
        </span>
        <!-- Multiple images indicator -->
        <span
          v-if="item.media.length > 1"
          class="absolute top-2 left-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded"
        >
          +{{ item.media.length - 1 }}
        </span>
      </div>
    </template>

    <div class="p-3">
      <!-- Author row -->
      <div class="flex items-center gap-2 mb-2">
        <img
          v-if="item.author.avatar"
          :src="item.author.avatar"
          :alt="item.author.name"
          class="w-7 h-7 rounded-full object-cover flex-shrink-0"
        />
        <div
          v-else
          class="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-medium"
        >
          {{ item.author.name?.[0]?.toUpperCase() || '?' }}
        </div>

        <div class="flex-1 min-w-0">
          <span class="text-xs font-semibold text-white truncate block leading-tight">{{ item.author.name || item.author.username }}</span>
          <span class="text-xs text-gray-500 leading-tight">{{ timeAgo }}</span>
        </div>

        <!-- Platform badge (text-only posts) -->
        <span
          v-if="!isImageFirst"
          class="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
          :style="{ backgroundColor: platformColor + '25', color: platformColor }"
        >
          {{ $t(`platforms.${item.platform}`) }}
        </span>
      </div>

      <!-- Content -->
      <p
        v-if="item.content"
        class="text-xs text-gray-300 leading-relaxed mb-2"
        :class="expanded ? '' : 'line-clamp-3'"
      >{{ item.content }}</p>
      <button
        v-if="item.content && item.content.length > 180 && !expanded"
        @click="expanded = true"
        class="text-xs text-gray-500 hover:text-gray-300 mb-2 -mt-1"
      >more</button>

      <!-- Inline image (non-Instagram text posts with media) -->
      <div v-if="!isImageFirst && item.media?.[0]" class="mb-2">
        <img
          :src="item.media[0].thumbnail || item.media[0].url"
          :alt="item.media[0].alt || ''"
          class="rounded-lg w-full object-cover max-h-28"
        />
      </div>

      <!-- Tags -->
      <div v-if="item.platformTags?.length" class="flex flex-wrap gap-1 mb-2">
        <span
          v-for="tag in item.platformTags.slice(0, 4)"
          :key="tag"
          class="text-xs text-blue-400"
        >#{{ tag }}</span>
      </div>

      <!-- Metrics + link -->
      <div class="flex items-center gap-3 text-xs text-gray-600">
        <span v-if="item.metrics?.likes">❤ {{ formatNum(item.metrics.likes) }}</span>
        <span v-if="item.metrics?.comments">💬 {{ formatNum(item.metrics.comments) }}</span>
        <span v-if="item.metrics?.shares">↺ {{ formatNum(item.metrics.shares) }}</span>
        <a
          v-if="item.url"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto hover:text-gray-400 transition-colors"
        >{{ $t('feed.openOriginal') }}</a>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/tr'
import 'dayjs/locale/en'
import { PLATFORM_META } from '../../stores/platforms'
import type { FeedItem } from '../../stores/feed'

dayjs.extend(relativeTime)

const { locale } = useI18n()
const props = defineProps<{ item: FeedItem }>()

const expanded = ref(false)

const platformColor = computed(() => PLATFORM_META[props.item.platform]?.color ?? '#6b7280')
const timeAgo = computed(() => dayjs(props.item.createdAt).locale(locale.value).fromNow())

// Show image at the top for Instagram, or any post whose first media is a photo/video
const isImageFirst = computed(() =>
  props.item.platform === 'instagram' ||
  (props.item.media?.[0]?.type === 'image' && props.item.platform === 'facebook')
)

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>
