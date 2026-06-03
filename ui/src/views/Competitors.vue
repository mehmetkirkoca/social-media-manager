<template>
  <div class="p-6" :class="competitorStore.competitors.length >= 2 ? '' : 'max-w-3xl mx-auto'">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('competitors.sectionTitle') }}</h1>
      <p class="text-gray-400 mt-1">{{ t('competitors.sectionSubtitle') }}</p>
    </div>

    <div v-if="competitorStore.error" class="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
      {{ competitorStore.error }}
    </div>

    <!-- Side-by-side label + matrix toggle -->
    <div v-if="competitorStore.competitors.length >= 2" class="mb-3 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-xs text-gray-500">
        <i class="fa-solid fa-table-columns"></i>
        {{ t('competitors.sideBySideMode') }}
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="analyzedCompetitors.length >= 1"
          @click="mapOpen = !mapOpen; matrixOpen = false"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
          :class="mapOpen ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'"
        >
          <i class="fa-solid fa-map text-[10px]"></i>
          {{ t('competitors.strategicMap') }}
        </button>
        <button
          v-if="analyzedCompetitors.length >= 2"
          @click="matrixOpen = !matrixOpen; mapOpen = false"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
          :class="matrixOpen ? 'bg-violet-900/50 border-violet-700 text-violet-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'"
        >
          <i class="fa-solid fa-table text-[10px]"></i>
          {{ t('competitors.compareMatrix') }}
        </button>
      </div>
    </div>

    <!-- Strategic Group Map -->
    <div v-if="mapOpen" class="mb-6 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <!-- Header + axis selectors -->
      <div class="px-5 py-3 border-b border-gray-800 flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2 mr-auto">
          <i class="fa-solid fa-map text-xs text-emerald-400"></i>
          <span class="text-sm font-semibold text-white">{{ t('competitors.mapTitle') }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <span class="text-gray-500">X:</span>
          <select v-model="mapXAxis" class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-emerald-500">
            <option v-for="d in STRATEGIC_DIMENSIONS" :key="d" :value="d" :disabled="d === mapYAxis">{{ d }}</option>
          </select>
          <span class="text-gray-500">Y:</span>
          <select v-model="mapYAxis" class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs focus:outline-none focus:border-emerald-500">
            <option v-for="d in STRATEGIC_DIMENSIONS" :key="d" :value="d" :disabled="d === mapXAxis">{{ d }}</option>
          </select>
        </div>
        <button
          @click="generateStrategicMap"
          :disabled="mapLoading"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 border border-emerald-700 rounded-lg transition-colors text-emerald-200"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-[10px]" :class="{ 'animate-pulse': mapLoading }"></i>
          {{ mapLoading ? t('competitors.mapGenerating') : t('competitors.mapGenerate') }}
        </button>
      </div>

      <!-- Map canvas -->
      <div v-if="mapResult" class="p-5">
        <!-- Insight banner -->
        <div class="mb-4 p-3 bg-emerald-950/40 border border-emerald-800/30 rounded-xl text-sm text-gray-300 leading-relaxed">
          <i class="fa-solid fa-lightbulb text-emerald-400 mr-2 text-xs"></i>{{ mapResult.insight }}
        </div>

        <!-- 2D scatter plot -->
        <div class="relative bg-gray-800/40 border border-gray-700 rounded-xl" style="height: 320px; margin-bottom: 1rem;">
          <!-- Axis labels -->
          <div class="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-gray-500">{{ mapResult.xAxis }} →</div>
          <div class="absolute top-1/2 left-1 -translate-y-1/2 text-xs text-gray-500" style="writing-mode: vertical-rl; text-orientation: mixed; transform: translateY(-50%) rotate(180deg);">↑ {{ mapResult.yAxis }}</div>
          <!-- Grid lines -->
          <div class="absolute inset-6 border border-gray-700/40 rounded">
            <div v-for="i in 4" :key="i" class="absolute border-t border-gray-700/20 w-full" :style="{ top: (i * 20) + '%' }"></div>
            <div v-for="i in 4" :key="i" class="absolute border-l border-gray-700/20 h-full" :style="{ left: (i * 20) + '%' }"></div>
          </div>
          <!-- Players -->
          <div
            v-for="player in mapResult.players"
            :key="player.name"
            class="absolute flex flex-col items-center gap-0.5 -translate-x-1/2 translate-y-1/2"
            :style="{ left: `calc(6% + ${(player.x - 1) / 9 * 88}%)`, bottom: `calc(6% + ${(player.y - 1) / 9 * 88}%)` }"
          >
            <div
              class="w-3 h-3 rounded-full border-2 shadow-lg"
              :class="player.isYou ? 'bg-emerald-400 border-emerald-300' : 'bg-violet-400 border-violet-300'"
            ></div>
            <span
              class="text-[10px] font-medium px-1 rounded whitespace-nowrap"
              :class="player.isYou ? 'text-emerald-300 bg-emerald-950/80' : 'text-gray-200 bg-gray-900/80'"
            >{{ player.name }}</span>
          </div>
        </div>

        <!-- Whitespace opportunities -->
        <div v-if="mapResult.whitespace?.length" class="mb-3">
          <div class="text-xs font-medium text-gray-400 mb-1.5">{{ t('competitors.mapWhitespace') }}</div>
          <div class="flex flex-wrap gap-2">
            <span v-for="w in mapResult.whitespace" :key="w" class="text-xs px-2 py-1 bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 rounded-full">
              <i class="fa-solid fa-circle-plus mr-1 text-[9px]"></i>{{ w }}
            </span>
          </div>
        </div>

        <!-- Clusters -->
        <div v-if="mapResult.clusters?.length">
          <div class="text-xs font-medium text-gray-400 mb-1.5">{{ t('competitors.mapClusters') }}</div>
          <ul class="space-y-0.5">
            <li v-for="c in mapResult.clusters" :key="c" class="flex gap-1.5 text-xs text-gray-400">
              <span class="text-violet-400 shrink-0">›</span>{{ c }}
            </li>
          </ul>
        </div>
      </div>

      <div v-else class="px-5 py-8 text-center text-sm text-gray-500">
        {{ t('competitors.mapEmpty') }}
      </div>
    </div>

    <!-- Competitor comparison matrix -->
    <div v-if="matrixOpen && analyzedCompetitors.length >= 2" class="mb-6 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <!-- Matrix header -->
      <div class="px-5 py-3 border-b border-gray-800 flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-table text-xs text-violet-400"></i>
          <span class="text-sm font-semibold text-white">{{ t('competitors.matrixTitle') }}</span>
        </div>
        <button
          @click="generateMatrixSynthesis"
          :disabled="matrixLoading"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-800 hover:bg-violet-700 disabled:opacity-40 border border-violet-700 rounded-lg transition-colors text-violet-200"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-[10px]" :class="{ 'animate-pulse': matrixLoading }"></i>
          {{ matrixLoading ? t('competitors.matrixSynthesizing') : t('competitors.matrixSynthesize') }}
        </button>
      </div>

      <!-- AI synthesis banner -->
      <div v-if="matrixSynthesis" class="px-5 py-3 bg-violet-950/40 border-b border-violet-800/30 text-sm text-gray-300 leading-relaxed">
        <i class="fa-solid fa-lightbulb text-violet-400 mr-2 text-xs"></i>{{ matrixSynthesis }}
      </div>

      <!-- Comparison table -->
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-gray-800">
              <th class="text-left px-4 py-2.5 text-gray-500 font-medium w-32 shrink-0">Dimension</th>
              <th
                v-for="c in analyzedCompetitors"
                :key="c._id"
                class="text-left px-4 py-2.5 text-violet-300 font-semibold"
              >{{ c.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in MATRIX_ROWS"
              :key="row.key"
              class="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors"
            >
              <td class="px-4 py-2.5 text-gray-500 font-medium align-top shrink-0">{{ row.label }}</td>
              <td
                v-for="c in analyzedCompetitors"
                :key="c._id"
                class="px-4 py-2.5 text-gray-300 align-top"
              >{{ row.get(c) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Competitor cards — stacked for 1, responsive grid for 2+ -->
    <div
      v-if="competitorStore.competitors.length"
      :class="gridClass"
    >
      <div
        v-for="competitor in competitorStore.competitors"
        :key="competitor._id"
        class="bg-gray-800 border border-gray-700 rounded-lg p-5"
      >
        <!-- Header row -->
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex-1 min-w-0">
            <template v-if="editingId === competitor._id">
              <input
                v-model="editForm.name"
                class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm mb-2 focus:outline-none focus:border-violet-500"
                :placeholder="t('competitors.namePlaceholder')"
              />
              <input
                v-model="editForm.websiteUrl"
                class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
                :placeholder="t('competitors.websitePlaceholder')"
              />
            </template>
            <template v-else>
              <div class="font-semibold text-white">{{ competitor.name }}</div>
              <a :href="competitor.websiteUrl" target="_blank" rel="noopener" class="text-violet-400 text-sm hover:underline truncate block">{{ competitor.websiteUrl }}</a>
            </template>
          </div>
          <div class="flex gap-2 shrink-0">
            <template v-if="editingId === competitor._id">
              <button @click="saveEdit(competitor._id)" class="text-xs px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded">{{ t('competitors.save') }}</button>
              <button @click="cancelEdit" class="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">{{ t('competitors.cancel') }}</button>
            </template>
            <template v-else>
              <button @click="startEdit(competitor)" class="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">{{ t('competitors.edit') }}</button>
              <button @click="confirmDelete(competitor._id)" class="text-xs px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded">{{ t('competitors.delete') }}</button>
            </template>
          </div>
        </div>

        <!-- Social URLs collapsible -->
        <details class="mb-3">
          <summary class="text-sm text-gray-400 cursor-pointer hover:text-gray-200 select-none">{{ t('competitors.socialUrls') }}</summary>
          <div class="mt-2 space-y-1.5">
            <div v-for="platform in socialPlatforms" :key="platform.key" class="flex items-center gap-2">
              <i :class="platform.icon" class="w-4 text-center text-gray-400 text-sm"></i>
              <input
                :value="getEditSocialUrl(competitor, platform.key)"
                @change="setSocialUrl(competitor, platform.key, ($event.target as HTMLInputElement).value)"
                @blur="saveSocialUrl(competitor)"
                class="flex-1 bg-gray-700 border border-gray-600 rounded px-2.5 py-1 text-white text-xs focus:outline-none focus:border-violet-500"
                :placeholder="platform.placeholder"
              />
            </div>
          </div>
        </details>

        <!-- Action buttons -->
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            @click="competitorStore.scrapeCompetitor(competitor._id)"
            :disabled="competitorStore.scraping[competitor._id]"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-rotate" :class="{ 'animate-spin': competitorStore.scraping[competitor._id] }"></i>
            {{ competitorStore.scraping[competitor._id] ? t('competitors.scraping') : t('competitors.scrapeNow') }}
          </button>
          <button
            @click="competitorStore.summarizeCompetitor(competitor._id)"
            :disabled="competitorStore.summarizing[competitor._id] || !competitor.scrapedContent.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-wand-magic-sparkles" :class="{ 'animate-pulse': competitorStore.summarizing[competitor._id] }"></i>
            {{ competitorStore.summarizing[competitor._id] ? t('competitors.summarizing') : t('competitors.summarizeAi') }}
          </button>
          <button
            @click="competitorStore.extractKeywords(competitor._id)"
            :disabled="competitorStore.extractingKeywords[competitor._id] || !competitor.scrapedContent.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-tags" :class="{ 'animate-pulse': competitorStore.extractingKeywords[competitor._id] }"></i>
            {{ competitorStore.extractingKeywords[competitor._id] ? t('competitors.extractingKeywords') : t('competitors.extractKeywords') }}
          </button>
          <button
            @click="competitorStore.detectSignals(competitor._id)"
            :disabled="competitorStore.detectingSignals[competitor._id] || !competitor.scrapedContent.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            :class="{ 'ring-1 ring-yellow-400': competitor.contentChanged && !competitorStore.detectingSignals[competitor._id] }"
          >
            <i class="fa-solid fa-tower-broadcast" :class="{ 'animate-pulse': competitorStore.detectingSignals[competitor._id] }"></i>
            {{ competitorStore.detectingSignals[competitor._id] ? t('competitors.detectingSignals') : t('competitors.detectSignals') }}
          </button>
          <button
            @click="competitorStore.analyzeGaps(competitor._id)"
            :disabled="competitorStore.analyzingGaps[competitor._id] || !competitor.keywords?.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-code-compare" :class="{ 'animate-pulse': competitorStore.analyzingGaps[competitor._id] }"></i>
            {{ competitorStore.analyzingGaps[competitor._id] ? t('competitors.analyzingGaps') : t('competitors.analyzeGaps') }}
          </button>
          <button
            @click="competitorStore.generateRoadmap(competitor._id)"
            :disabled="competitorStore.generatingRoadmap[competitor._id] || (!competitor.keywords?.length && !competitor.scrapedContent.length)"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-map" :class="{ 'animate-pulse': competitorStore.generatingRoadmap[competitor._id] }"></i>
            {{ competitorStore.generatingRoadmap[competitor._id] ? t('competitors.generatingRoadmap') : t('competitors.generateRoadmap') }}
          </button>
        </div>

        <!-- Scrape result message -->
        <div v-if="competitorStore.scrapeResults[competitor._id]" class="mb-3 text-xs px-3 py-1.5 rounded" :class="competitorStore.scrapeResults[competitor._id].ok ? 'bg-green-900/40 text-green-300' : 'bg-amber-900/40 text-amber-300'">
          {{ competitorStore.scrapeResults[competitor._id].ok
            ? (competitorStore.scrapeResults[competitor._id].sources > 0
                ? t('competitors.scrapeSuccess', { count: competitorStore.scrapeResults[competitor._id].sources })
                : t('competitors.scrapeNoContent'))
            : competitorStore.scrapeResults[competitor._id].message }}
        </div>

        <!-- Freshness row -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span :class="freshnessBadge(competitor.lastScraped).cls" class="text-xs px-2 py-0.5 rounded-full font-medium">
            {{ freshnessBadge(competitor.lastScraped).label }}
          </span>
          <span v-if="competitor.lastScraped" class="text-xs text-gray-500">
            {{ t('competitors.lastScraped') }}: {{ new Date(competitor.lastScraped).toLocaleString() }}
          </span>
          <span
            v-if="competitor.contentChanged"
            class="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-900/50 border border-blue-700/50 text-blue-300 rounded-full"
          >
            <i class="fa-solid fa-circle-dot text-[8px] animate-pulse"></i>
            {{ t('competitors.newActivity') }}
          </span>
        </div>

        <!-- Market Signals -->
        <div v-if="competitor.signals?.length" class="mb-3">
          <div class="text-xs text-yellow-400 font-medium mb-1.5">{{ t('competitors.signalsLabel') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="signal in competitor.signals"
              :key="signal.type + signal.detectedAt"
              :title="signal.description"
              :class="{
                'bg-red-900/40 border-red-700/60 text-red-300':    signal.severity === 'high',
                'bg-amber-900/40 border-amber-700/60 text-amber-300': signal.severity === 'medium',
                'bg-gray-700/60 border-gray-600/60 text-gray-300':  signal.severity === 'low',
              }"
              class="inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded-full cursor-default"
            >
              <i class="fa-solid fa-tower-broadcast text-[9px]"></i>
              {{ t(`competitors.signalType_${signal.type}`) || signal.type.replace(/_/g, ' ') }}
            </span>
          </div>
          <p v-if="competitor.signals.length === 1" class="text-xs text-gray-400 mt-1.5 italic">{{ competitor.signals[0].description }}</p>
        </div>

        <!-- Structured Profile Fact-sheet -->
        <div v-if="competitor.aiAnalysis?.profile?.pricing || competitor.aiAnalysis?.profile?.keyFeatures?.length" class="mb-3 p-3 bg-gray-900/50 border border-gray-700/60 rounded-lg text-xs space-y-1.5">
          <div v-if="competitor.aiAnalysis.profile.pricing" class="flex gap-1.5">
            <span class="text-gray-500 shrink-0">{{ t('competitors.profilePricing') }}:</span>
            <span class="text-gray-300">{{ competitor.aiAnalysis.profile.pricing }}</span>
          </div>
          <div v-if="competitor.aiAnalysis.profile.targetCustomer" class="flex gap-1.5">
            <span class="text-gray-500 shrink-0">{{ t('competitors.profileTarget') }}:</span>
            <span class="text-gray-300">{{ competitor.aiAnalysis.profile.targetCustomer }}</span>
          </div>
          <div v-if="competitor.aiAnalysis.profile.keyFeatures?.length" class="flex gap-1.5 flex-wrap">
            <span class="text-gray-500 shrink-0">{{ t('competitors.profileFeatures') }}:</span>
            <span v-for="f in competitor.aiAnalysis.profile.keyFeatures" :key="f" class="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">{{ f }}</span>
          </div>
          <div v-if="competitor.aiAnalysis.profile.marketingChannels?.length" class="flex gap-1.5 flex-wrap">
            <span class="text-gray-500 shrink-0">{{ t('competitors.profileChannels') }}:</span>
            <span v-for="c in competitor.aiAnalysis.profile.marketingChannels" :key="c" class="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">{{ c }}</span>
          </div>
        </div>

        <!-- Structured AI Analysis -->
        <div v-if="competitor.aiAnalysis" class="mt-3 space-y-3">
          <!-- Tone & Positioning -->
          <div class="p-3 bg-gray-700/50 rounded border border-gray-600 space-y-2">
            <div class="text-xs text-violet-400 font-medium">{{ t('competitors.aiAnalysisLabel') }}</div>
            <div v-if="competitor.aiAnalysis.tone" class="text-sm">
              <span class="text-xs text-gray-400">{{ t('competitors.analysisTone') }}: </span>
              <span class="text-gray-200 italic">{{ competitor.aiAnalysis.tone }}</span>
            </div>
            <div v-if="competitor.aiAnalysis.positioning" class="text-sm">
              <span class="text-xs text-gray-400">{{ t('competitors.analysisPositioning') }}: </span>
              <span class="text-gray-200">{{ competitor.aiAnalysis.positioning }}</span>
            </div>
          </div>

          <!-- Content Themes -->
          <div v-if="competitor.aiAnalysis.themes?.length">
            <div class="text-xs text-gray-400 mb-1.5">{{ t('competitors.analysisThemes') }}</div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="theme in competitor.aiAnalysis.themes"
                :key="theme"
                class="text-xs px-2 py-0.5 bg-gray-700 border border-gray-600 text-gray-300 rounded-full"
              >{{ theme }}</span>
            </div>
          </div>

          <!-- Gaps & Opportunities -->
          <div v-if="competitor.aiAnalysis.gaps?.length">
            <div class="text-xs text-amber-400 font-medium mb-1.5">{{ t('competitors.analysisGaps') }}</div>
            <ul class="space-y-1">
              <li
                v-for="gap in competitor.aiAnalysis.gaps"
                :key="gap"
                class="flex gap-1.5 items-start text-xs text-amber-200"
              >
                <span class="text-amber-400 mt-0.5 shrink-0">→</span>{{ gap }}
              </li>
            </ul>
          </div>

          <!-- Differentiation Moves -->
          <div v-if="competitor.aiAnalysis.moves?.length">
            <div class="text-xs text-green-400 font-medium mb-1.5">{{ t('competitors.analysisMoves') }}</div>
            <ul class="space-y-1">
              <li
                v-for="move in competitor.aiAnalysis.moves"
                :key="move"
                class="flex gap-1.5 items-start text-xs text-green-200"
              >
                <span class="text-green-400 mt-0.5 shrink-0">✓</span>{{ move }}
              </li>
            </ul>
          </div>

          <!-- Response Prediction -->
          <div v-if="competitor.aiAnalysis.prediction?.likelyNextMoves?.length" class="p-3 bg-gray-700/30 rounded border border-gray-700 space-y-2">
            <div class="flex items-center gap-2">
              <div class="text-xs text-sky-400 font-medium">{{ t('competitors.predictionLabel') }}</div>
              <span class="text-xs px-1.5 py-0.5 rounded" :class="competitor.aiAnalysis.prediction.satisfiedWithPosition ? 'bg-gray-700 text-gray-400' : 'bg-orange-900/40 text-orange-300'">
                {{ competitor.aiAnalysis.prediction.satisfiedWithPosition ? t('competitors.predictionSatisfied') : t('competitors.predictionPushing') }}
              </span>
            </div>
            <div v-if="competitor.aiAnalysis.prediction.likelyNextMoves?.length">
              <div class="text-xs text-gray-400 mb-1">{{ t('competitors.predictionNextMoves') }}</div>
              <ul class="space-y-0.5">
                <li v-for="move in competitor.aiAnalysis.prediction.likelyNextMoves" :key="move" class="text-xs text-sky-200 flex gap-1.5">
                  <span class="text-sky-400 shrink-0">→</span>{{ move }}
                </li>
              </ul>
            </div>
            <div v-if="competitor.aiAnalysis.prediction.vulnerabilities?.length">
              <div class="text-xs text-gray-400 mb-1">{{ t('competitors.predictionVulnerabilities') }}</div>
              <ul class="space-y-0.5">
                <li v-for="v in competitor.aiAnalysis.prediction.vulnerabilities" :key="v" class="text-xs text-amber-200 flex gap-1.5">
                  <span class="text-amber-400 shrink-0">⚡</span>{{ v }}
                </li>
              </ul>
            </div>
            <div v-if="competitor.aiAnalysis.prediction.retaliationTriggers?.length">
              <div class="text-xs text-gray-400 mb-1">{{ t('competitors.predictionRetaliationTriggers') }}</div>
              <ul class="space-y-0.5">
                <li v-for="rt in competitor.aiAnalysis.prediction.retaliationTriggers" :key="rt" class="text-xs text-red-300 flex gap-1.5">
                  <span class="text-red-400 shrink-0">⚠</span>{{ rt }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Legacy plain-text summary (for competitors analysed before this update) -->
        <div v-else-if="competitor.aiSummary" class="mb-3 p-3 bg-gray-700/50 rounded border border-gray-600 text-sm text-gray-200">
          <div class="text-xs text-violet-400 font-medium mb-1">{{ t('competitors.aiSummaryLabel') }}</div>
          {{ competitor.aiSummary }}
        </div>

        <!-- Keywords -->
        <div v-if="competitor.keywords && competitor.keywords.length" class="mt-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-blue-400 font-medium">{{ t('competitors.keywordsLabel') }}</div>
            <div class="flex items-center gap-2.5">
              <span v-for="intent in KEYWORD_INTENTS" :key="intent.key" class="flex items-center gap-1 text-xs text-gray-400">
                <span :class="intent.dot" class="w-1.5 h-1.5 rounded-full shrink-0"></span>{{ t(`competitors.intent_${intent.key}`) }}
              </span>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="kw in competitor.keywords"
              :key="typeof kw === 'string' ? kw : kw.term"
              :class="typeof kw === 'string' ? 'bg-blue-900/40 border-blue-700/50 text-blue-300' : intentChipClass(kw.intent)"
              :title="typeof kw === 'string' ? '' : t(`competitors.intent_${kw.intent}`)"
              class="inline-block text-xs px-2 py-0.5 border rounded-full cursor-default"
            >{{ typeof kw === 'string' ? kw : kw.term }}</span>
          </div>
        </div>

        <!-- Gap Analysis -->
        <div v-if="competitor.gapAnalysis" class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-orange-400 font-medium">{{ t('competitors.gapAnalysisLabel') }}</div>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span class="text-orange-300">{{ competitor.gapAnalysis.gaps.length }} {{ t('competitors.gapCount') }}</span>
              <span>·</span>
              <span class="text-green-400">{{ competitor.gapAnalysis.covered.length }} {{ t('competitors.coveredCount') }}</span>
              <span>·</span>
              <span>{{ new Date(competitor.gapAnalysis.lastAnalyzed).toLocaleDateString() }}</span>
            </div>
          </div>

          <!-- Warning when no hashtag data exists -->
          <div v-if="competitor.gapAnalysis.hashtagStatsEmpty" class="mb-2 p-2.5 bg-amber-900/30 border border-amber-700/50 rounded text-xs text-amber-300">
            {{ t('competitors.gapNoHashtagStats') }}
          </div>

          <!-- Gap keywords (missing from your content) -->
          <div v-if="competitor.gapAnalysis.gaps.length" class="mb-3">
            <div class="text-xs text-gray-400 mb-1.5">{{ t('competitors.gapMissing') }}</div>
            <!-- Double-danger note: keywords both competitors target -->
            <div
              v-if="sharedGapTerms.size > 0 && competitor.gapAnalysis.gaps.some(g => sharedGapTerms.has(g.term))"
              class="mb-2 flex items-center gap-1.5 text-xs text-rose-400"
            >
              <i class="fa-solid fa-triangle-exclamation"></i>
              {{ t('competitors.sharedGapsNote', { name: otherCompetitorNames(competitor._id) }) }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="gap in competitor.gapAnalysis.gaps"
                :key="gap.term"
                :class="sharedGapTerms.has(gap.term)
                  ? 'bg-rose-900/40 border-rose-600/70 text-rose-300'
                  : intentChipClass(gap.intent)"
                :title="sharedGapTerms.has(gap.term)
                  ? t('competitors.sharedGapTitle', { name: otherCompetitorNames(competitor._id) })
                  : t(`competitors.intent_${gap.intent}`)"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded-full"
              >
                <i v-if="sharedGapTerms.has(gap.term)" class="fa-solid fa-triangle-exclamation text-[9px]"></i>
                <span v-else class="opacity-60 text-[10px]">{{ gap.intent[0].toUpperCase() }}</span>
                {{ gap.term }}
              </span>
            </div>
          </div>
          <div v-else class="mb-3 text-xs text-green-400">{{ t('competitors.gapNoneFound') }}</div>

          <!-- Covered keywords (you already have these) -->
          <details v-if="competitor.gapAnalysis.covered.length" class="group">
            <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-200 select-none">
              {{ t('competitors.gapCoveredToggle', { count: competitor.gapAnalysis.covered.length }) }}
            </summary>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="item in competitor.gapAnalysis.covered"
                :key="item.term"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/40 text-green-300 rounded-full"
                :title="item.matchedHashtags.join(', ')"
              >
                <i class="fa-solid fa-check text-[9px]"></i>{{ item.term }}
              </span>
            </div>
          </details>
        </div>

        <!-- Content Roadmap -->
        <div v-if="competitor.contentRoadmap?.length" class="mt-4">
          <div class="text-xs text-emerald-400 font-medium mb-2">{{ t('competitors.roadmapLabel') }}</div>
          <div class="space-y-2">
            <div
              v-for="(post, idx) in competitor.contentRoadmap"
              :key="idx"
              class="p-3 bg-gray-700/50 rounded border border-gray-600"
            >
              <div class="flex items-start justify-between gap-3 mb-1.5">
                <div class="text-xs font-semibold text-emerald-300">{{ post.topic }}</div>
                <button
                  @click="draftPost(post.headline)"
                  class="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 bg-violet-700 hover:bg-violet-600 text-white rounded"
                >
                  <i class="fa-solid fa-pen-to-square"></i>
                  {{ t('competitors.roadmapDraft') }}
                </button>
              </div>
              <p class="text-sm text-gray-200 mb-2">{{ post.headline }}</p>
              <div v-if="post.rationale" class="text-xs text-gray-400 italic mb-2">{{ post.rationale }}</div>
              <div v-if="post.keywords?.length" class="flex flex-wrap gap-1">
                <span
                  v-for="kw in post.keywords"
                  :key="kw"
                  class="text-xs px-1.5 py-0.5 bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 rounded"
                >{{ kw }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Quantitative profile -->
        <div v-if="competitor.quantitativeProfile" class="mt-4 border-t border-gray-700/60 pt-3">
          <div class="text-xs text-cyan-400 font-medium mb-2">{{ t('competitors.quantitativeLabel') }}</div>

          <!-- Pricing tiers -->
          <div v-if="competitor.quantitativeProfile.pricingTiers?.length" class="mb-2">
            <div class="text-xs text-gray-500 mb-1">{{ t('competitors.quantitativePricing') }}</div>
            <div class="flex flex-wrap gap-1.5">
              <div v-for="tier in competitor.quantitativeProfile.pricingTiers" :key="tier.name"
                class="px-2 py-1 bg-cyan-900/30 border border-cyan-700/40 rounded text-xs text-cyan-200">
                <span class="font-medium">{{ tier.name }}</span>
                <span class="text-cyan-400 ml-1">{{ tier.price }}</span>
              </div>
            </div>
          </div>

          <!-- Key features -->
          <div v-if="competitor.quantitativeProfile.keyFeatures?.length" class="mb-2">
            <div class="text-xs text-gray-500 mb-1">{{ t('competitors.quantitativeFeatures') }}</div>
            <ul class="space-y-0.5">
              <li v-for="f in competitor.quantitativeProfile.keyFeatures.slice(0, 5)" :key="f" class="flex gap-1 text-xs text-gray-300">
                <span class="text-cyan-500 shrink-0">›</span>{{ f }}
              </li>
            </ul>
          </div>

          <!-- Stats row -->
          <div class="flex flex-wrap gap-3 text-xs text-gray-400">
            <span v-if="competitor.quantitativeProfile.targetCustomer" class="flex items-center gap-1">
              <i class="fa-solid fa-user-group text-[9px] text-cyan-500"></i>{{ competitor.quantitativeProfile.targetCustomer }}
            </span>
            <span v-if="competitor.quantitativeProfile.jobPostings" class="flex items-center gap-1">
              <i class="fa-solid fa-briefcase text-[9px] text-green-400"></i>{{ competitor.quantitativeProfile.jobPostings }} open roles
            </span>
          </div>

          <!-- Growth signals -->
          <div v-if="competitor.quantitativeProfile.growthSignals?.length" class="mt-1.5 flex flex-wrap gap-1">
            <span v-for="s in competitor.quantitativeProfile.growthSignals" :key="s" class="text-xs px-1.5 py-0.5 bg-green-900/30 border border-green-700/40 text-green-300 rounded-full">
              <i class="fa-solid fa-arrow-trend-up text-[9px] mr-0.5"></i>{{ s }}
            </span>
          </div>
        </div>

        <!-- Extract quantitative data button -->
        <div class="mt-3 pt-3 border-t border-gray-700/60">
          <button
            @click="extractQuantitative(competitor._id)"
            :disabled="extractingQuantitative[competitor._id]"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-cyan-900/50 hover:bg-cyan-800/60 disabled:opacity-40 border border-cyan-700/50 rounded-lg text-cyan-300 transition-colors w-full justify-center"
          >
            <i class="fa-solid fa-database text-[10px]" :class="{ 'animate-pulse': extractingQuantitative[competitor._id] }"></i>
            {{ extractingQuantitative[competitor._id] ? t('competitors.extractingQuantitative') : t('competitors.extractQuantitative') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!competitorStore.loading" class="mb-6 p-8 text-center bg-gray-800 border border-gray-700 rounded-lg max-w-xl">
      <p class="text-gray-400 mb-4">{{ t('competitors.emptyState') }}</p>
      <button
        @click="competitorStore.discoverCompetitors()"
        :disabled="competitorStore.discoveringCompetitors"
        class="inline-flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 text-white text-sm rounded disabled:opacity-50"
      >
        <i class="fa-solid fa-magnifying-glass" :class="{ 'animate-pulse': competitorStore.discoveringCompetitors }"></i>
        {{ competitorStore.discoveringCompetitors ? t('competitors.discovering') : t('competitors.discoverButton') }}
      </button>
    </div>

    <!-- Discovery suggestions -->
    <div v-if="competitorStore.discoverySuggestions.length" class="mb-6 max-w-xl">
      <div class="text-xs text-gray-400 mb-2">{{ t('competitors.discoverySuggestionsLabel') }}</div>
      <div class="space-y-2">
        <div
          v-for="s in competitorStore.discoverySuggestions"
          :key="s.websiteUrl"
          class="flex items-start gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-white">{{ s.name }}</div>
            <a :href="s.websiteUrl" target="_blank" rel="noopener" class="text-xs text-violet-400 hover:underline truncate block">{{ s.websiteUrl }}</a>
            <p v-if="s.reason" class="text-xs text-gray-400 mt-0.5">{{ s.reason }}</p>
          </div>
          <button
            @click="acceptSuggestion(s)"
            :disabled="competitorStore.competitors.length >= 5"
            class="shrink-0 text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded disabled:opacity-40"
          >{{ t('competitors.discoverAccept') }}</button>
        </div>
      </div>
    </div>

    <!-- Add competitor form -->
    <div v-if="competitorStore.competitors.length < 5" class="bg-gray-800 border border-gray-700 rounded-lg p-5 max-w-xl">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold text-white">{{ t('competitors.addCompetitor') }}</h2>
        <div class="flex gap-1.5" v-if="!competitorStore.discoverySuggestions.length">
          <button
            @click="competitorStore.discoverCompetitors()"
            :disabled="competitorStore.discoveringCompetitors"
            class="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded disabled:opacity-50"
          >
            <i class="fa-solid fa-magnifying-glass text-[10px]" :class="{ 'animate-pulse': competitorStore.discoveringCompetitors }"></i>
            {{ competitorStore.discoveringCompetitors ? t('competitors.discovering') : t('competitors.discoverButton') }}
          </button>
          <button
            v-if="placesConfigured"
            @click="showLocalForm = !showLocalForm"
            class="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-green-800 hover:bg-green-700 text-green-200 rounded"
          >
            <i class="fa-solid fa-location-dot text-[10px]"></i>
            {{ t('competitors.discoverLocalButton') }}
          </button>
        </div>
      </div>
      <!-- Local discovery form -->
      <div v-if="showLocalForm && placesConfigured" class="mb-3 p-3 bg-green-900/20 border border-green-800/50 rounded-lg space-y-2">
        <div class="text-xs text-green-400 font-medium mb-1">{{ t('competitors.localDiscoveryLabel') }}</div>
        <input
          v-model="localLocation"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
          :placeholder="t('competitors.localLocationPlaceholder')"
        />
        <input
          v-model="localBusinessType"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-green-500"
          :placeholder="t('competitors.localBusinessTypePlaceholder')"
        />
        <button
          @click="discoverLocal"
          :disabled="discoveringLocal || !localLocation.trim()"
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-50"
        >
          <i class="fa-solid fa-location-dot" :class="{ 'animate-pulse': discoveringLocal }"></i>
          {{ discoveringLocal ? t('competitors.discovering') : t('competitors.discoverLocalSearch') }}
        </button>
      </div>

      <div class="space-y-2">
        <input
          v-model="newForm.name"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          :placeholder="t('competitors.namePlaceholder')"
        />
        <input
          v-model="newForm.websiteUrl"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          :placeholder="t('competitors.websitePlaceholder')"
        />
      </div>
      <button
        @click="createCompetitor"
        :disabled="!newForm.name.trim() || !newForm.websiteUrl.trim()"
        class="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ t('competitors.addButton') }}
      </button>
    </div>
    <p v-else class="text-xs text-gray-500 text-center">{{ t('competitors.maxReached') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { useCompetitorStore, type Competitor, type KeywordIntent, type CompetitorSuggestion } from '../stores/competitors'
import { useComposeStore } from '../stores/compose'

const { t } = useI18n()
const router = useRouter()
const competitorStore = useCompetitorStore()
const composeStore = useComposeStore()

function draftPost(headline: string) {
  composeStore.content = headline
  router.push('/compose')
}

// ── Strategic group map ───────────────────────────────────────────────────────
const STRATEGIC_DIMENSIONS = [
  'Price level',
  'Product / service breadth',
  'Brand strength',
  'Technology leadership',
  'Market coverage',
  'Service quality',
  'Marketing intensity',
  'Geographic reach',
]

const mapOpen    = ref(false)
const mapLoading = ref(false)
const mapXAxis   = ref(STRATEGIC_DIMENSIONS[0])
const mapYAxis   = ref(STRATEGIC_DIMENSIONS[2])
const mapResult  = ref<{ xAxis: string; yAxis: string; players: any[]; clusters: string[]; whitespace: string[]; insight: string } | null>(null)

async function generateStrategicMap() {
  mapLoading.value = true
  try {
    const res = await axios.post('/api/competitors/strategic-map', {
      xAxis: mapXAxis.value,
      yAxis: mapYAxis.value,
    })
    mapResult.value = res.data
  } catch (err: any) {
    alert(err.response?.data?.error || 'Strategic map failed')
  } finally {
    mapLoading.value = false
  }
}

// ── Competitor matrix ─────────────────────────────────────────────────────────
const matrixOpen     = ref(false)
const matrixLoading  = ref(false)
const matrixSynthesis = ref<string | null>(null)

const analyzedCompetitors = computed(() =>
  competitorStore.competitors.filter((c) => c.aiAnalysis),
)

const MATRIX_ROWS = [
  { key: 'positioning',  label: 'Positioning',          get: (c: Competitor) => c.aiAnalysis?.positioning || '—' },
  { key: 'tone',         label: 'Brand Tone',           get: (c: Competitor) => c.aiAnalysis?.tone || '—' },
  { key: 'themes',       label: 'Content Themes',       get: (c: Competitor) => (c.aiAnalysis?.themes || []).join(', ') || '—' },
  { key: 'gaps',         label: 'Weaknesses / Gaps',    get: (c: Competitor) => (c.aiAnalysis?.gaps || []).join(', ') || '—' },
  { key: 'moves',        label: 'Differentiation Moves',get: (c: Competitor) => (c.aiAnalysis?.moves || []).join(', ') || '—' },
  { key: 'keywords',     label: 'Top Keywords',         get: (c: Competitor) => ((c.keywords || []).slice(0, 5).map((k: any) => k.term).join(', ') || '—') },
] as const

// ── Quantitative extraction ───────────────────────────────────────────────────
const extractingQuantitative = reactive<Record<string, boolean>>({})

async function extractQuantitative(id: string) {
  extractingQuantitative[id] = true
  try {
    await competitorStore.fetchCompetitors()
    const res = await axios.post(`/api/competitors/${id}/extract-quantitative`)
    const idx = competitorStore.competitors.findIndex((c) => c._id === id)
    if (idx !== -1) {
      competitorStore.competitors[idx] = { ...competitorStore.competitors[idx], quantitativeProfile: res.data.quantitativeProfile }
    }
  } catch (err: any) {
    alert(err.response?.data?.error || 'Quantitative extraction failed')
  } finally {
    extractingQuantitative[id] = false
  }
}

async function generateMatrixSynthesis() {
  matrixLoading.value = true
  try {
    const res = await axios.post('/api/competitors/social-matrix')
    matrixSynthesis.value = res.data.synthesis
  } catch (err: any) {
    alert(err.response?.data?.error || 'Matrix synthesis failed')
  } finally {
    matrixLoading.value = false
  }
}

// Grid layout: full-width multi-column for 2+ competitors
const gridClass = computed(() => {
  const n = competitorStore.competitors.length
  if (n <= 1) return 'space-y-4 mb-6'
  if (n === 2) return 'grid grid-cols-2 gap-4 mb-6 items-start'
  if (n === 3) return 'grid grid-cols-3 gap-4 mb-6 items-start'
  if (n === 4) return 'grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6 items-start'
  return 'grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6 items-start'
})

// Gap terms targeted by 2+ competitors simultaneously — "double danger"
const sharedGapTerms = computed<Set<string>>(() => {
  const cs = competitorStore.competitors
  if (cs.length < 2) return new Set()
  const counts = new Map<string, number>()
  for (const c of cs) {
    for (const g of c.gapAnalysis?.gaps ?? []) {
      counts.set(g.term, (counts.get(g.term) ?? 0) + 1)
    }
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([term]) => term))
})

function otherCompetitorNames(currentId: string): string {
  const others = competitorStore.competitors.filter((c) => c._id !== currentId).map((c) => c.name)
  if (others.length === 0) return ''
  if (others.length === 1) return others[0]
  return others.slice(0, -1).join(', ') + ' & ' + others.at(-1)
}

function freshnessBadge(lastScraped: string | null) {
  if (!lastScraped) return { label: t('competitors.freshnessNever'), cls: 'bg-gray-700/80 text-gray-400' }
  const days = (Date.now() - new Date(lastScraped).getTime()) / 86400000
  if (days <= 7)  return { label: t('competitors.freshnessFresh'),    cls: 'bg-green-900/60 border border-green-700/50 text-green-300' }
  if (days <= 30) return { label: t('competitors.freshnessStale'),    cls: 'bg-amber-900/60 border border-amber-700/50 text-amber-300' }
  return           { label: t('competitors.freshnessOutdated'), cls: 'bg-red-900/60 border border-red-700/50 text-red-300' }
}

const KEYWORD_INTENTS = [
  { key: 'informational', dot: 'bg-blue-400' },
  { key: 'commercial',    dot: 'bg-violet-400' },
  { key: 'transactional', dot: 'bg-green-400' },
  { key: 'navigational',  dot: 'bg-gray-400' },
]

const INTENT_CHIP_CLASSES: Record<KeywordIntent, string> = {
  informational: 'bg-blue-900/40 border-blue-700/50 text-blue-300',
  commercial:    'bg-violet-900/40 border-violet-700/50 text-violet-300',
  transactional: 'bg-green-900/40 border-green-700/50 text-green-300',
  navigational:  'bg-gray-700 border-gray-600 text-gray-300',
}

function intentChipClass(intent: string): string {
  return INTENT_CHIP_CLASSES[intent as KeywordIntent] ?? INTENT_CHIP_CLASSES.informational
}

const socialPlatforms = [
  { key: 'twitter',   icon: 'fa-brands fa-x-twitter',  placeholder: 'https://twitter.com/username' },
  { key: 'facebook',  icon: 'fa-brands fa-facebook',   placeholder: 'https://facebook.com/page' },
  { key: 'instagram', icon: 'fa-brands fa-instagram',  placeholder: 'https://instagram.com/username' },
  { key: 'linkedin',  icon: 'fa-brands fa-linkedin',   placeholder: 'https://linkedin.com/company/name' },
  { key: 'bluesky',   icon: 'fa-brands fa-bluesky',    placeholder: 'https://bsky.app/profile/handle.bsky.social' },
  { key: 'mastodon',  icon: 'fa-brands fa-mastodon',   placeholder: 'https://mastodon.social/@username' },
  { key: 'tiktok',    icon: 'fa-brands fa-tiktok',     placeholder: 'https://tiktok.com/@username' },
  { key: 'youtube',   icon: 'fa-brands fa-youtube',    placeholder: 'https://youtube.com/@channel' },
  { key: 'pinterest', icon: 'fa-brands fa-pinterest',  placeholder: 'https://pinterest.com/username' },
]

const newForm = reactive({ name: '', websiteUrl: '' })
const editingId = ref<string | null>(null)
const editForm = reactive({ name: '', websiteUrl: '' })
const pendingSocialUrls = reactive<Record<string, Record<string, string>>>({})

function getEditSocialUrl(competitor: Competitor, platform: string): string {
  return pendingSocialUrls[competitor._id]?.[platform] ?? competitor.socialUrls?.[platform] ?? ''
}

function setSocialUrl(competitor: Competitor, platform: string, value: string) {
  if (!pendingSocialUrls[competitor._id]) pendingSocialUrls[competitor._id] = {}
  pendingSocialUrls[competitor._id][platform] = value
}

async function saveSocialUrl(competitor: Competitor) {
  if (!pendingSocialUrls[competitor._id]) return
  const merged = { ...competitor.socialUrls }
  for (const [k, v] of Object.entries(pendingSocialUrls[competitor._id])) {
    if (v) merged[k] = v
    else delete merged[k]
  }
  await competitorStore.updateCompetitor(competitor._id, { socialUrls: merged })
}

async function createCompetitor() {
  if (!newForm.name.trim() || !newForm.websiteUrl.trim()) return
  const ok = await competitorStore.addCompetitor({ name: newForm.name.trim(), websiteUrl: newForm.websiteUrl.trim() })
  if (ok) {
    newForm.name = ''
    newForm.websiteUrl = ''
  }
}

// ─── Local competitor discovery via Google Places ─────────────────────────────

const placesConfigured  = ref(false)
const showLocalForm     = ref(false)
const localLocation     = ref('')
const localBusinessType = ref('')
const discoveringLocal  = ref(false)

async function checkPlacesConfig() {
  try {
    const res = await axios.get('/api/credentials/google-places')
    placesConfigured.value = res.data.configured
  } catch { /* not configured */ }
}

async function discoverLocal() {
  if (!localLocation.value.trim()) return
  discoveringLocal.value = true
  competitorStore.error = null
  try {
    const res = await axios.post('/api/competitors/discover-local', {
      location: localLocation.value.trim(),
      businessType: localBusinessType.value.trim() || undefined,
    })
    const withWebsite = (res.data.suggestions || []).filter((s: any) => s.websiteUrl)
    competitorStore.discoverySuggestions.splice(0, Infinity, ...withWebsite)
    if (!withWebsite.length) competitorStore.error = 'No businesses with websites found — try a broader location or business type.'
    showLocalForm.value = false
  } catch (err: any) {
    competitorStore.error = err.response?.data?.error || 'Local discovery failed'
  } finally {
    discoveringLocal.value = false
  }
}

async function acceptSuggestion(s: { name: string; websiteUrl: string }) {
  const ok = await competitorStore.addCompetitor({ name: s.name, websiteUrl: s.websiteUrl })
  if (ok) {
    competitorStore.discoverySuggestions.splice(
      competitorStore.discoverySuggestions.findIndex((x) => x.websiteUrl === s.websiteUrl), 1,
    )
  }
}

function startEdit(competitor: Competitor) {
  editingId.value = competitor._id
  editForm.name = competitor.name
  editForm.websiteUrl = competitor.websiteUrl
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  await competitorStore.updateCompetitor(id, { name: editForm.name.trim(), websiteUrl: editForm.websiteUrl.trim() })
  editingId.value = null
}

async function confirmDelete(id: string) {
  if (confirm(t('competitors.confirmDelete'))) {
    await competitorStore.deleteCompetitor(id)
  }
}

onMounted(() => {
  competitorStore.fetchCompetitors()
  checkPlacesConfig()
})
</script>
