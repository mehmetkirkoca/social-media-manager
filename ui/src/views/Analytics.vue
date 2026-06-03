<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="max-w-6xl mx-auto px-6 py-8">

      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-white">{{ $t('analytics.title') }}</h1>
          <p class="text-sm text-gray-500 mt-1">{{ $t('analytics.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="runAudit"
            :disabled="auditLoading"
            class="flex items-center gap-2 px-4 py-2 bg-violet-800 hover:bg-violet-700 border border-violet-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <i class="fa-solid fa-clipboard-check text-xs" :class="{ 'animate-pulse': auditLoading }"></i>
            {{ auditLoading ? $t('analytics.runningAudit') : $t('analytics.runAudit') }}
          </button>
          <button
            @click="runChannelAudit"
            :disabled="channelAuditLoading"
            class="flex items-center gap-2 px-4 py-2 bg-sky-800 hover:bg-sky-700 border border-sky-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <i class="fa-solid fa-chart-bar text-xs" :class="{ 'animate-pulse': channelAuditLoading }"></i>
            {{ channelAuditLoading ? $t('analytics.runningChannelAudit') : $t('analytics.runChannelAudit') }}
          </button>
          <button
            @click="exportCsv"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-medium transition-colors"
          >
            <i class="fa-solid fa-file-csv text-xs"></i>
            {{ $t('analytics.exportCsv') }}
          </button>
          <button
            @click="crawlMetrics"
            :disabled="crawling"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <span :class="{ 'animate-spin': crawling }">⟳</span>
            {{ crawling ? $t('analytics.crawling') : (crawlResult !== null ? $t('analytics.crawlDone', { count: crawlResult }) : $t('analytics.crawlMetrics')) }}
          </button>
          <button
            @click="load"
            :disabled="loading"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <span :class="{ 'animate-spin': loading }">↻</span>
            {{ $t('analytics.refresh') }}
          </button>
        </div>
      </div>

      <!-- Account filter chips -->
      <div v-if="filterAccounts.length > 1" class="flex items-center gap-2 flex-wrap mb-6">
        <span class="text-xs text-gray-500 shrink-0">{{ $t('analytics.filterBy') }}</span>
        <button
          @click="selectedAccount = null"
          class="px-3 py-1 rounded-full text-xs border transition-colors"
          :class="selectedAccount === null
            ? 'border-white/40 bg-white/10 text-white'
            : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'"
        >{{ $t('analytics.filterAll') }}</button>
        <button
          v-for="acc in filterAccounts"
          :key="acc.key"
          @click="selectedAccount = selectedAccount === acc.key ? null : acc.key"
          class="px-3 py-1 rounded-full text-xs border transition-colors flex items-center gap-1.5"
          :style="selectedAccount === acc.key
            ? { borderColor: platformColor(acc.platform), background: platformColor(acc.platform) + '33', color: '#fff' }
            : {}"
          :class="selectedAccount === acc.key ? '' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'"
        >
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: platformColor(acc.platform) }"></span>
          {{ acc.label }}
        </button>
      </div>

      <!-- Audit error -->
      <div v-if="auditError" class="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm flex items-center justify-between gap-3">
        {{ $t('analytics.auditError') }}
        <button @click="auditError = false" class="text-red-400 hover:text-red-200 shrink-0">✕</button>
      </div>

      <!-- Audit results card -->
      <div v-if="audit" class="mb-8 bg-gray-900 border border-violet-800/50 rounded-2xl overflow-hidden">
        <!-- Card header -->
        <div class="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-clipboard-check text-violet-400"></i>
              <span class="font-semibold text-white">{{ $t('analytics.auditTitle') }}</span>
            </div>
            <span class="text-xs text-gray-500">
              {{ $t('analytics.auditStats', { count: audit.stats.postsLast30, freq: audit.stats.postsPerWeek, rate: audit.stats.successRate }) }}
            </span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <!-- Score badge -->
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400">{{ $t('analytics.auditScore') }}</span>
              <span
                class="text-lg font-bold px-2 py-0.5 rounded-lg"
                :class="audit.score >= 70 ? 'text-green-300 bg-green-900/40' : audit.score >= 40 ? 'text-amber-300 bg-amber-900/40' : 'text-red-300 bg-red-900/40'"
              >{{ audit.score }}/100</span>
            </div>
            <button @click="audit = null" class="text-gray-500 hover:text-gray-300 text-sm">{{ $t('analytics.auditDismiss') }}</button>
          </div>
        </div>

        <!-- Summary -->
        <div class="px-6 py-4 border-b border-gray-800 text-sm text-gray-300">{{ audit.summary }}</div>

        <!-- Score breakdown -->
        <div class="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
          <div v-for="section in auditSections" :key="section.key" class="px-5 py-4">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-gray-400">{{ section.label }}</span>
              <span class="text-sm font-semibold" :class="scoreColor(section.score)">{{ section.score }}/10</span>
            </div>
            <div class="w-full h-1.5 bg-gray-800 rounded-full mb-2">
              <div class="h-1.5 rounded-full transition-all" :class="scoreBarColor(section.score)" :style="{ width: (section.score * 10) + '%' }"></div>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ section.assessment }}</p>
            <p v-if="section.benchmark" class="text-xs mt-0.5" :class="benchmarkColor(section.benchmark)">{{ section.benchmark }}</p>
          </div>
        </div>

        <!-- Recommendations -->
        <div class="px-6 py-4">
          <div class="text-xs font-medium text-gray-400 mb-2">{{ $t('analytics.auditRecommendations') }}</div>
          <ol class="space-y-1.5">
            <li v-for="(rec, i) in audit.recommendations" :key="i" class="flex gap-2 text-sm text-gray-200">
              <span class="text-violet-400 font-semibold shrink-0">{{ i + 1 }}.</span>{{ rec }}
            </li>
          </ol>
        </div>
      </div>

      <!-- Channel audit error -->
      <div v-if="channelAuditError" class="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm flex items-center justify-between gap-3">
        {{ $t('analytics.channelAuditError') }}
        <button @click="channelAuditError = false" class="text-red-400 hover:text-red-200 shrink-0">✕</button>
      </div>

      <!-- Channel audit results card -->
      <div v-if="channelAudit" class="mb-8 bg-gray-900 border border-sky-800/50 rounded-2xl overflow-hidden">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <i class="fa-solid fa-chart-bar text-sky-400"></i>
            <span class="font-semibold text-white">{{ $t('analytics.channelAuditTitle') }}</span>
            <span v-if="selectedAccount" class="text-xs text-gray-500">{{ selectedAccount }}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-400">{{ $t('analytics.channelAuditScore') }}</span>
              <span
                class="text-lg font-bold px-2 py-0.5 rounded-lg"
                :class="channelAudit.score >= 70 ? 'text-green-300 bg-green-900/40' : channelAudit.score >= 40 ? 'text-amber-300 bg-amber-900/40' : 'text-red-300 bg-red-900/40'"
              >{{ channelAudit.score }}/100</span>
            </div>
            <button @click="channelAudit = null" class="text-gray-500 hover:text-gray-300 text-sm">{{ $t('analytics.channelAuditDismiss') }}</button>
          </div>
        </div>

        <!-- Section grid -->
        <div class="grid grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-gray-800 border-b border-gray-800">
          <div v-for="section in channelAudit.sections" :key="section.name" class="px-5 py-4">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-gray-400 font-medium">{{ section.name }}</span>
              <span class="text-sm font-semibold" :class="scoreColor(section.score)">{{ section.score }}/10</span>
            </div>
            <div class="w-full h-1.5 bg-gray-800 rounded-full mb-2">
              <div class="h-1.5 rounded-full transition-all" :class="scoreBarColor(section.score)" :style="{ width: (section.score * 10) + '%' }"></div>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed mb-2">{{ section.assessment }}</p>
            <ul class="space-y-0.5">
              <li v-for="(rec, i) in section.recommendations" :key="i" class="flex gap-1.5 text-xs text-gray-500">
                <span class="text-sky-500 shrink-0">›</span>{{ rec }}
              </li>
            </ul>
          </div>
        </div>

        <!-- Top actions -->
        <div class="px-6 py-4">
          <div class="text-xs font-medium text-gray-400 mb-2">{{ $t('analytics.channelAuditTopActions') }}</div>
          <ol class="space-y-1.5">
            <li v-for="(action, i) in channelAudit.topActions" :key="i" class="flex gap-2 text-sm text-gray-200">
              <span class="text-sky-400 font-semibold shrink-0">{{ i + 1 }}.</span>{{ action }}
            </li>
          </ol>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading && !summary" class="flex items-center justify-center h-64 text-gray-500">
        {{ $t('analytics.loading') }}
      </div>

      <!-- Empty state -->
      <div v-else-if="summary && summary.total === 0" class="flex flex-col items-center justify-center h-64 gap-2 text-gray-500">
        <p class="text-lg">{{ $t('analytics.empty') }}</p>
        <p class="text-sm">{{ $t('analytics.emptyHint') }}</p>
      </div>

      <template v-else-if="summary">

        <!-- ── Summary cards ─────────────────────────────────── -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.totalPosts') }}</p>
            <p class="text-3xl font-bold text-white">{{ summary.total }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.last7Days') }}</p>
            <p class="text-3xl font-bold text-blue-400">{{ summary.recentCount }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.platformsReached') }}</p>
            <p class="text-3xl font-bold text-purple-400">{{ platformCount }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.successRate') }}</p>
            <p class="text-3xl font-bold" :class="summary.successRate >= 80 ? 'text-green-400' : summary.successRate >= 50 ? 'text-yellow-400' : 'text-red-400'">
              {{ summary.successRate }}%
            </p>
          </div>
        </div>

        <!-- ── Posts per Day chart ────────────────────────────── -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <div class="flex items-baseline justify-between mb-4">
            <h2 class="text-sm font-semibold text-white">{{ $t('analytics.postsPerDay') }}</h2>
            <span class="text-xs text-gray-500">{{ $t('analytics.postsPerDaySubtitle') }}</span>
          </div>

          <div v-if="chartDays.every(d => d.count === 0)" class="h-24 flex items-center justify-center text-sm text-gray-600">
            {{ $t('analytics.noActivity') }}
          </div>

          <template v-else>
            <!-- SVG bar chart -->
            <svg
              :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
              preserveAspectRatio="none"
              class="w-full h-28"
            >
              <g v-for="(day, i) in chartDays" :key="day.date">
                <rect
                  :x="i * barSlot + barPad"
                  :y="CHART_H - barH(day.count)"
                  :width="barSlot - barPad * 2"
                  :height="barH(day.count)"
                  class="fill-blue-500 opacity-80 hover:opacity-100 transition-opacity"
                  rx="2"
                >
                  <title>{{ day.date }}: {{ day.count }}</title>
                </rect>
              </g>
            </svg>
            <!-- X-axis labels: show first, middle, last -->
            <div class="flex justify-between mt-1 text-xs text-gray-600">
              <span>{{ chartDays[0]?.date?.slice(5) }}</span>
              <span>{{ chartDays[14]?.date?.slice(5) }}</span>
              <span>{{ chartDays[29]?.date?.slice(5) }}</span>
            </div>
          </template>
        </div>

        <!-- ── Two-column: Platform breakdown + Status breakdown ── -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          <!-- Platform Breakdown -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.platformBreakdown') }}</h2>
            <div v-if="platformEntries.length === 0" class="text-sm text-gray-600">—</div>
            <div v-else class="space-y-3">
              <div v-for="[platform, count] in platformEntries" :key="platform" class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-2">
                    <span
                      class="w-2 h-2 rounded-full"
                      :style="{ background: platformColor(platform) }"
                    ></span>
                    <span class="capitalize text-gray-300">{{ platformLabel(platform) }}</span>
                  </span>
                  <span class="text-gray-500">{{ count }} {{ $t('analytics.successfulPosts') }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :style="{ width: platformBarWidth(count) + '%', background: platformColor(platform) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Status Breakdown -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.statusBreakdown') }}</h2>
            <div class="space-y-3">
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-green-400">{{ $t('analytics.published') }}</span>
                  <span class="text-gray-500">{{ summary.published }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-green-500 rounded-full" :style="{ width: statusWidth(summary.published) + '%' }"></div>
                </div>
              </div>
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-yellow-400">{{ $t('analytics.partial') }}</span>
                  <span class="text-gray-500">{{ summary.partial }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-yellow-500 rounded-full" :style="{ width: statusWidth(summary.partial) + '%' }"></div>
                </div>
              </div>
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-red-400">{{ $t('analytics.failed') }}</span>
                  <span class="text-gray-500">{{ summary.failed }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-red-500 rounded-full" :style="{ width: statusWidth(summary.failed) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ── Recent Posts ───────────────────────────────────── -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.recentPosts') }}</h2>

          <div v-if="posts.length === 0" class="text-sm text-gray-600">
            {{ $t('analytics.noRecentPosts') }}
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="post in posts"
              :key="String(post._id)"
              class="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0"
            >
              <!-- Content preview -->
              <p class="flex-1 text-sm line-clamp-2 min-w-0" :class="post.content ? 'text-gray-300' : 'text-gray-600 italic'">
                {{ post.content || $t('analytics.noContent') }}
              </p>

              <!-- Platforms chips -->
              <div class="flex flex-wrap gap-1 shrink-0">
                <span
                  v-for="platform in postPlatforms(post)"
                  :key="platform"
                  class="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  :style="{ background: platformColor(platform) }"
                >
                  {{ platformLabel(platform) }}
                </span>
              </div>

              <!-- Date -->
              <span class="text-xs text-gray-600 shrink-0 w-20 text-right">
                {{ formatDate(post.publishedAt) }}
              </span>

              <!-- Status badge -->
              <span
                class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                :class="{
                  'bg-green-900/40 text-green-400': post.status === 'published',
                  'bg-yellow-900/40 text-yellow-400': post.status === 'partial',
                  'bg-red-900/40 text-red-400': post.status === 'failed',
                }"
              >
                {{ $t(`analytics.status${capitalize(post.status)}`) }}
              </span>
            </div>
          </div>

          <!-- Load more -->
          <button
            v-if="posts.length < postsTotal"
            @click="loadMorePosts"
            :disabled="loadingMore"
            class="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm transition-colors"
          >
            {{ $t('analytics.loadMore') }}
          </button>
        </div>

      </template>

      <!-- ── Advanced Insights ─────────────────────────────────── -->
      <div v-if="!loading || summary" class="mt-8 space-y-6">
        <div>
          <h2 class="text-lg font-semibold text-white">{{ $t('analytics.insightsTitle') }}</h2>
          <p class="text-sm text-gray-500 mt-0.5">{{ $t('analytics.insightsSubtitle') }}</p>
        </div>

        <div v-if="insightsLoading" class="flex items-center justify-center h-24 text-gray-500 text-sm">
          {{ $t('analytics.loading') }}
        </div>

        <div v-else-if="!insights || insights.empty" class="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p class="text-gray-400 font-medium">{{ $t('analytics.insightsEmpty') }}</p>
          <p class="text-sm text-gray-600 mt-1">{{ $t('analytics.insightsEmptyHint') }}</p>
        </div>

        <template v-else>

          <!-- Platform Comparison -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 overflow-x-auto">
            <h3 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.platformCompTitle') }}</h3>
            <table class="w-full text-sm min-w-[540px]">
              <thead>
                <tr class="text-xs text-gray-500 border-b border-gray-800">
                  <th class="text-left pb-2 font-normal">Platform</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgEngagement') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgLikes') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgComments') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgShares') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colTracked') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in insights.platformComparison" :key="row.platform" class="border-b border-gray-800/40 last:border-0">
                  <td class="py-2.5">
                    <span class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: platformColor(row.platform) }"></span>
                      <span class="capitalize text-gray-300">{{ platformLabel(row.platform) }}</span>
                    </span>
                  </td>
                  <td class="py-2.5 text-right font-semibold text-blue-400">{{ row.avgEngagement }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgLikes }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgComments }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgShares }}</td>
                  <td class="py-2.5 text-right text-gray-500">{{ row.totalPosts }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Best Time: By Hour + By Day -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- By Hour -->
            <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div class="flex items-baseline justify-between mb-4">
                <h3 class="text-sm font-semibold text-white">{{ $t('analytics.byHourTitle') }}</h3>
                <span class="text-xs text-gray-500">{{ $t('analytics.bestTimeSubtitle') }}</span>
              </div>
              <svg viewBox="0 0 480 60" preserveAspectRatio="none" class="w-full h-20">
                <g v-for="bar in insights.byHour" :key="bar.hour">
                  <rect
                    :x="bar.hour * 20 + 2"
                    :y="60 - byHourBarH(bar.avgEngagement)"
                    :width="16"
                    :height="byHourBarH(bar.avgEngagement) || 1"
                    :class="bar.avgEngagement === maxByHourAvg && bar.avgEngagement > 0 ? 'fill-green-400' : 'fill-blue-500 opacity-70'"
                    rx="1"
                  >
                    <title>{{ bar.hour }}:00 — avg {{ bar.avgEngagement }}</title>
                  </rect>
                </g>
              </svg>
              <div class="flex justify-between mt-1 text-xs text-gray-600 px-0.5">
                <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </div>

            <!-- By Day -->
            <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div class="flex items-baseline justify-between mb-4">
                <h3 class="text-sm font-semibold text-white">{{ $t('analytics.byDayTitle') }}</h3>
                <span class="text-xs text-gray-500">{{ $t('analytics.bestTimeSubtitle') }}</span>
              </div>
              <svg viewBox="0 0 280 60" preserveAspectRatio="none" class="w-full h-20">
                <g v-for="bar in insights.byDay" :key="bar.day">
                  <rect
                    :x="bar.day * 40 + 4"
                    :y="60 - byDayBarH(bar.avgEngagement)"
                    :width="32"
                    :height="byDayBarH(bar.avgEngagement) || 1"
                    :class="bar.avgEngagement === maxByDayAvg && bar.avgEngagement > 0 ? 'fill-green-400' : 'fill-blue-500 opacity-70'"
                    rx="2"
                  >
                    <title>{{ ($t('analytics.dayNamesShort') as string[])[bar.day] }} — avg {{ bar.avgEngagement }}</title>
                  </rect>
                </g>
              </svg>
              <div class="flex justify-between mt-1 text-xs text-gray-600 px-1">
                <span v-for="name in ($t('analytics.dayNamesShort') as string[])" :key="name">{{ name }}</span>
              </div>
            </div>

          </div>

          <!-- Engagement Heatmap -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div class="flex items-baseline justify-between mb-4">
              <h3 class="text-sm font-semibold text-white">{{ $t('analytics.heatmapTitle') }}</h3>
              <span class="text-xs text-gray-500">{{ $t('analytics.heatmapSubtitle') }}</span>
            </div>
            <div class="overflow-x-auto">
              <div class="inline-block min-w-full">
                <!-- Hour axis labels -->
                <div class="flex items-center mb-1" style="padding-left: 28px">
                  <div
                    v-for="h in 24"
                    :key="h"
                    class="shrink-0 text-center text-xs text-gray-600"
                    style="width: 18px"
                  >{{ (h - 1) % 6 === 0 ? String(h - 1) : '' }}</div>
                </div>
                <!-- Day rows -->
                <div v-for="(row, d) in heatmapGrid" :key="d" class="flex items-center gap-px mb-px">
                  <span class="text-xs text-gray-600 shrink-0 text-right pr-1" style="width: 28px">
                    {{ ($t('analytics.dayNamesShort') as string[])[d] }}
                  </span>
                  <div
                    v-for="cell in row"
                    :key="cell.hour"
                    class="shrink-0 rounded-sm"
                    :style="{ width: '18px', height: '14px', background: heatmapCellBg(cell.avg) }"
                    :title="`${($t('analytics.dayNamesShort') as string[])[d]} ${cell.hour}:00 — avg ${cell.avg}`"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Top Performing Posts -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h3 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.topPostsTitle') }}</h3>
            <div v-if="insights.topPosts.length === 0" class="text-sm text-gray-600">{{ $t('analytics.noTopPosts') }}</div>
            <div v-else class="space-y-0">
              <div
                v-for="post in insights.topPosts"
                :key="post.postId"
                class="flex items-start gap-3 py-3 border-b border-gray-800 last:border-0"
              >
                <span class="shrink-0 w-2 h-2 rounded-full mt-1.5" :style="{ background: platformColor(post.platform) }"></span>
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-gray-500 mb-0.5">{{ platformLabel(post.platform) }} · {{ formatDate(post.publishedAt) }}</p>
                  <p class="text-sm line-clamp-2" :class="post.content ? 'text-gray-300' : 'text-gray-600 italic'">
                    {{ post.content || $t('analytics.noContent') }}
                  </p>
                </div>
                <div class="shrink-0 text-right space-y-0.5">
                  <p class="text-sm font-semibold text-blue-400">{{ post.metrics.engagementTotal }}</p>
                  <p class="text-xs text-gray-600">
                    ❤ {{ post.metrics.likes }} · 💬 {{ post.metrics.comments }}<template v-if="post.metrics.shares"> · ↗ {{ post.metrics.shares }}</template>
                  </p>
                </div>
              </div>
            </div>
          </div>

        </template>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'

const { t } = useI18n()

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayStat { date: string; count: number }
interface Summary {
  total: number
  published: number
  partial: number
  failed: number
  successRate: number
  byPlatform: Record<string, number>
  byDay: DayStat[]
  recentCount: number
}
interface Post {
  _id: unknown
  content: string
  destinations: Array<{ platform: string; accountId?: string }>
  platformResults: Record<string, { success: boolean; error?: string }>
  status: string
  publishedAt: string
  type: string
}
interface HourStat  { hour: number; avgEngagement: number; count: number }
interface DayEngStat { day: number; avgEngagement: number; count: number }
interface HeatCell  { day: number; hour: number; avg: number; count: number }
interface TopPost {
  platform: string; accountName: string; postId: string
  content: string | null; publishedAt: string
  metrics: { likes: number; comments: number; shares: number; views: number; saves: number; engagementTotal: number }
}
interface PlatformComp {
  platform: string; avgEngagement: number; avgLikes: number; avgComments: number; avgShares: number; totalPosts: number
}
interface Insights {
  empty: boolean
  total?: number
  byHour?: HourStat[]
  byDay?: DayEngStat[]
  heatmap?: HeatCell[]
  topPosts?: TopPost[]
  platformComparison?: PlatformComp[]
}

// ── Chart constants ───────────────────────────────────────────────────────────

const CHART_W = 900
const CHART_H = 80
const DAY_COUNT = 30

// ── State ─────────────────────────────────────────────────────────────────────

const platformsStore = usePlatformsStore()

const loading     = ref(false)
const loadingMore = ref(false)
const summary     = ref<Summary | null>(null)
const posts       = ref<Post[]>([])
const postsTotal  = ref(0)

const selectedAccount = ref<string | null>(null)

const insightsLoading = ref(false)
const insights        = ref<Insights | null>(null)
const crawling        = ref(false)
const crawlResult     = ref<number | null>(null)

interface AuditSection { score: number; assessment: string; benchmark?: string }
interface Audit {
  score: number
  summary: string
  postingFrequency: AuditSection
  engagement: AuditSection & { benchmark: string }
  contentMix: AuditSection
  recommendations: string[]
  stats: { postsLast30: number; postsLast7: number; postsPerWeek: number; platforms: string[]; successRate: number; avgEngagement: number }
}
const audit        = ref<Audit | null>(null)
const auditLoading = ref(false)
const auditError   = ref(false)

interface ChannelAuditSection {
  name: string
  score: number
  assessment: string
  recommendations: string[]
}
interface ChannelAudit {
  score: number
  sections: ChannelAuditSection[]
  topActions: string[]
  generatedAt: string
}
const channelAudit        = ref<ChannelAudit | null>(null)
const channelAuditLoading = ref(false)
const channelAuditError   = ref(false)

// ── Data loading ──────────────────────────────────────────────────────────────

function accountParams(extra: Record<string, unknown> = {}) {
  return selectedAccount.value ? { account: selectedAccount.value, ...extra } : extra
}

async function load() {
  loading.value = true
  try {
    const [sRes, pRes] = await Promise.all([
      axios.get('/api/analytics/summary', { params: accountParams() }),
      axios.get('/api/analytics/posts', { params: accountParams({ limit: 20 }) }),
    ])
    summary.value = sRes.data
    posts.value = pRes.data.posts
    postsTotal.value = pRes.data.total
  } finally {
    loading.value = false
  }
}

async function loadMorePosts() {
  loadingMore.value = true
  try {
    const res = await axios.get('/api/analytics/posts', { params: accountParams({ limit: 20, skip: posts.value.length }) })
    posts.value.push(...res.data.posts)
  } finally {
    loadingMore.value = false
  }
}

async function loadInsights() {
  insightsLoading.value = true
  try {
    const res = await axios.get('/api/analytics/insights', { params: accountParams() })
    insights.value = res.data
  } finally {
    insightsLoading.value = false
  }
}

function exportCsv() {
  const params = new URLSearchParams()
  if (selectedAccount.value) params.set('account', selectedAccount.value)
  // Export current month by default
  params.set('month', new Date().toISOString().slice(0, 7))
  const url = `/api/analytics/export?${params.toString()}`
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.click()
}

async function runAudit() {
  auditLoading.value = true
  auditError.value = false
  try {
    const res = await axios.post('/api/analytics/audit', {}, { params: accountParams() })
    audit.value = res.data
  } catch {
    auditError.value = true
  } finally {
    auditLoading.value = false
  }
}

async function runChannelAudit() {
  channelAuditLoading.value = true
  channelAuditError.value = false
  try {
    const res = await axios.post('/api/ai/channel-audit', { accountKey: selectedAccount.value || undefined })
    channelAudit.value = res.data
  } catch {
    channelAuditError.value = true
  } finally {
    channelAuditLoading.value = false
  }
}

async function crawlMetrics() {
  crawling.value = true
  crawlResult.value = null
  try {
    const res = await axios.post('/api/analytics/crawl')
    crawlResult.value = res.data.total
    await loadInsights()
  } finally {
    crawling.value = false
  }
}

onMounted(() => {
  platformsStore.fetchMetaConnections()
  load()
  loadInsights()
})

// Re-fetch everything when the account filter changes
watch(selectedAccount, () => { load(); loadInsights() })

// ── Account filter ────────────────────────────────────────────────────────────

interface FilterAccount { key: string; platform: string; label: string }

const filterAccounts = computed<FilterAccount[]>(() => {
  const list: FilterAccount[] = []

  for (const page of platformsStore.connectedPages) {
    list.push({ key: `facebook:${page.id}`, platform: 'facebook', label: page.name })
  }
  for (const acc of platformsStore.connectedIgAccounts) {
    list.push({ key: `instagram:${acc.id}`, platform: 'instagram', label: `@${acc.username}` })
  }

  // Non-Meta platforms that appear in the summary data
  if (summary.value?.byPlatform) {
    const metaPlats = new Set(['facebook', 'instagram'])
    for (const platform of Object.keys(summary.value.byPlatform)) {
      if (!metaPlats.has(platform)) {
        list.push({ key: platform, platform, label: platformLabel(platform) })
      }
    }
  }

  return list
})

// ── Chart helpers ─────────────────────────────────────────────────────────────

const chartDays = computed<DayStat[]>(() => {
  const byDate = Object.fromEntries((summary.value?.byDay ?? []).map((d) => [d.date, d.count]))
  return Array.from({ length: DAY_COUNT }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (DAY_COUNT - 1 - i))
    const dateStr = d.toISOString().split('T')[0]
    return { date: dateStr, count: byDate[dateStr] ?? 0 }
  })
})

const maxCount = computed(() => Math.max(...chartDays.value.map((d) => d.count), 1))
const barSlot  = computed(() => CHART_W / DAY_COUNT)
const barPad   = 2

function barH(count: number): number {
  if (count === 0) return 0
  return Math.max(4, (count / maxCount.value) * CHART_H * 0.95)
}

// ── Platform helpers ──────────────────────────────────────────────────────────

const platformEntries = computed(() =>
  Object.entries(summary.value?.byPlatform ?? {}).sort((a, b) => b[1] - a[1])
)

const platformCount = computed(() => Object.keys(summary.value?.byPlatform ?? {}).length)

const maxPlatformCount = computed(() => Math.max(...Object.values(summary.value?.byPlatform ?? {}), 1))

function platformBarWidth(count: number): number {
  return (count / maxPlatformCount.value) * 100
}

function statusWidth(count: number): number {
  return summary.value?.total ? (count / summary.value.total) * 100 : 0
}

const auditSections = computed(() => {
  if (!audit.value) return []
  return [
    { key: 'frequency', label: t('analytics.auditFrequency'), score: audit.value.postingFrequency.score, assessment: audit.value.postingFrequency.assessment },
    { key: 'engagement', label: t('analytics.auditEngagement'), score: audit.value.engagement.score, assessment: audit.value.engagement.assessment, benchmark: audit.value.engagement.benchmark },
    { key: 'mix', label: t('analytics.auditMix'), score: audit.value.contentMix.score, assessment: audit.value.contentMix.assessment },
  ]
})

function scoreColor(score: number): string {
  if (score >= 7) return 'text-green-400'
  if (score >= 4) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBarColor(score: number): string {
  if (score >= 7) return 'bg-green-500'
  if (score >= 4) return 'bg-amber-500'
  return 'bg-red-500'
}

function benchmarkColor(benchmark: string): string {
  if (benchmark === 'Excellent') return 'text-green-400'
  if (benchmark === 'Good') return 'text-blue-400'
  if (benchmark === 'Average') return 'text-amber-400'
  return 'text-red-400'
}

function platformColor(platform: string): string {
  return (PLATFORM_META as Record<string, { color: string }>)[platform]?.color ?? '#6b7280'
}

function platformLabel(platform: string): string {
  return (PLATFORM_META as Record<string, { label: string }>)[platform]?.label ?? platform
}

// ── Insights helpers ──────────────────────────────────────────────────────────

const INSIGHT_CHART_H = 57 // SVG height for by-hour / by-day charts

const maxByHourAvg = computed(() =>
  Math.max(...(insights.value?.byHour ?? []).map((b) => b.avgEngagement), 1)
)
const maxByDayAvg = computed(() =>
  Math.max(...(insights.value?.byDay ?? []).map((b) => b.avgEngagement), 1)
)

function byHourBarH(avg: number): number {
  if (!avg) return 0
  return Math.max(3, (avg / maxByHourAvg.value) * INSIGHT_CHART_H * 0.95)
}
function byDayBarH(avg: number): number {
  if (!avg) return 0
  return Math.max(3, (avg / maxByDayAvg.value) * INSIGHT_CHART_H * 0.95)
}

const maxHeatmapAvg = computed(() =>
  Math.max(...(insights.value?.heatmap ?? []).map((c) => c.avg), 1)
)

function heatmapCellBg(avg: number): string {
  if (!avg) return 'rgba(59,130,246,0.05)'
  const intensity = avg / maxHeatmapAvg.value
  return `rgba(59,130,246,${(0.1 + intensity * 0.9).toFixed(2)})`
}

const heatmapGrid = computed<HeatCell[][]>(() => {
  const cells = insights.value?.heatmap ?? []
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => cells[d * 24 + h] ?? { day: d, hour: h, avg: 0, count: 0 })
  )
})

// ── Post helpers ──────────────────────────────────────────────────────────────

function postPlatforms(post: Post): string[] {
  if (post.platformResults) {
    return [...new Set(
      Object.keys(post.platformResults).map((k) => k.split(':')[0])
    )]
  }
  return [...new Set((post.destinations ?? []).map((d) => d.platform))]
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}
</script>
