<template>
  <div class="h-full overflow-x-hidden overflow-y-auto p-3">
    <div class="mx-auto flex max-w-[1900px] flex-col gap-3">
      <section class="base-container flex flex-wrap items-center gap-3 px-4 py-3">
        <div class="bg-base-200/70 border-base-300/60 flex max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-xl border p-1">
          <button
            v-for="item in dimensions"
            :key="item.value"
            class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors"
            :class="dimension === item.value ? 'bg-primary text-primary-content shadow-sm' : 'text-base-content/65 hover:bg-base-300/60'"
            @click="dimension = item.value"
          >
            <component :is="item.icon" class="size-3.5" />
            {{ item.label }}
          </button>
        </div>
        <select v-model.number="range" class="select select-sm bg-base-200/70 border-base-300/60 ml-auto min-w-28">
          <option :value="3600000">{{ $t('lastHour') }}</option>
          <option :value="86400000">{{ $t('lastDay') }}</option>
          <option :value="604800000">{{ $t('lastWeek') }}</option>
          <option :value="2592000000">{{ $t('lastMonth') }}</option>
        </select>
        <select v-model.number="retention" class="select select-sm bg-base-200/70 border-base-300/60 min-w-28">
          <option :value="-1">{{ $t('forever') }}</option>
          <option :value="3600000">{{ $t('lastHour') }}</option>
          <option :value="86400000">{{ $t('lastDay') }}</option>
          <option :value="604800000">{{ $t('lastWeek') }}</option>
          <option :value="2592000000">{{ $t('lastMonth') }}</option>
        </select>
        <label class="flex cursor-pointer items-center gap-2 px-1 text-sm">
          <input v-model="dataUsageEnabled" type="checkbox" class="toggle toggle-primary toggle-sm" />
          {{ $t('tracking') }}
        </label>
        <button class="btn btn-sm btn-ghost" @click="refresh">{{ $t('refresh') }}</button>
        <button class="btn btn-sm btn-ghost text-error" @click="clear">{{ $t('clearUsage') }}</button>
      </section>

      <section class="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div v-for="card in summaryCards" :key="card.label" class="base-container flex h-[82px] items-center gap-3 px-4">
          <div class="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
            <component :is="card.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <div class="text-base-content/60 text-sm">{{ card.label }}</div>
            <div class="text-xl leading-tight font-semibold tabular-nums">{{ card.value }}</div>
          </div>
        </div>
      </section>

      <section class="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-4">
        <div class="base-container min-h-[320px] overflow-hidden p-3 xl:col-span-1">
          <div class="text-base-content/80 mb-4 flex items-center gap-2 text-base font-semibold">
            <ChartBarIcon class="text-primary size-4" />
            {{ $t('topUsage') }}{{ currentDimensionLabel }}
          </div>
          <div class="flex max-h-[285px] flex-col gap-1 overflow-y-auto pr-1">
            <button
              v-for="row in rows.slice(0, 12)"
              :key="row.label"
              class="group flex flex-col gap-1 rounded-xl px-3 py-2 text-left transition-colors"
              :class="selectedPrimary === row.label ? 'bg-primary/12 text-primary' : 'hover:bg-base-200'"
              @click="selectPrimary(row.label)"
            >
              <span class="flex items-center justify-between gap-2 text-base font-medium">
                <span class="min-w-0 truncate">{{ row.label }}</span>
                <span class="shrink-0 tabular-nums">{{ prettyBytesHelper(row.total) }}</span>
              </span>
              <span class="text-base-content/60 flex gap-2 text-sm tabular-nums">
                <span>↑ {{ prettyBytesHelper(row.upload) }}</span>
                <span>↓ {{ prettyBytesHelper(row.download) }}</span>
              </span>
            </button>
            <div v-if="!rows.length" class="text-base-content/50 px-3 py-5 text-sm">{{ $t('noData') }}</div>
          </div>
        </div>
        <div class="base-container h-[320px] min-h-0 overflow-hidden p-2 xl:col-span-3">
          <TimeSeriesChart
            class="h-full"
            :title="$t('traffic')"
            :data="chartSeries"
            :label-formatter="(value) => prettyBytesHelper(value)"
            :tooltip-formatter="tooltipFormatter"
            :window-seconds="chartWindowSeconds"
            header-text-class="text-base"
            legend-text-class="text-sm"
            :show-x-axis-labels="true"
            :show-pause-button="false"
          />
        </div>
      </section>

      <section class="base-container overflow-hidden">
        <div class="bg-base-200/55 border-base-300/60 flex items-center justify-between gap-3 border-b px-5 py-4">
          <div class="flex items-center gap-2 text-base font-semibold">
            <Bars3BottomLeftIcon class="text-primary size-5" />
            {{ $t('usageDetails') }}{{ detailTitle }}
          </div>
          <input v-model="search" class="input input-sm bg-base-100 border-base-300/70 w-64 text-sm" :placeholder="$t('search')" />
        </div>
        <div class="overflow-x-auto">
          <table class="usage-table table table-zebra">
            <thead class="bg-base-200/80">
              <tr class="text-base-content/75 text-sm">
                <th>{{ detailTitle }}</th>
                <th class="text-right">{{ $t('upload') }}</th>
                <th class="text-right">{{ $t('download') }}</th>
                <th class="text-right">{{ $t('total') }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredDetailRows" :key="row.label">
                <tr
                  class="cursor-pointer text-sm transition-colors hover:bg-base-200/90"
                  :class="expandedHost === row.label ? 'bg-primary/5' : undefined"
                  @click="toggleHost(row.label)"
                >
                  <td class="max-w-[34rem] truncate py-4 font-medium">
                    <span class="text-primary mr-2 inline-block w-3 text-base">{{ expandedHost === row.label ? '⌄' : '›' }}</span>
                    {{ row.label }}
                  </td>
                  <td class="text-right tabular-nums">{{ prettyBytesHelper(row.upload) }}</td>
                  <td class="text-right tabular-nums">{{ prettyBytesHelper(row.download) }}</td>
                  <td class="text-primary text-right font-semibold tabular-nums">{{ prettyBytesHelper(row.total) }}</td>
                </tr>
                <tr v-if="expandedHost === row.label">
                  <td colspan="4" class="bg-base-200/70 p-0">
                    <div class="flex flex-col gap-3 px-5 py-4">
                      <div class="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                        <div><span class="text-base-content/60">{{ $t('records') }}</span><div class="mt-1 font-medium">{{ row.count }}</div></div>
                        <div><span class="text-base-content/60">{{ $t('range') }}</span><div class="mt-1 font-medium">{{ rangeLabel }}</div></div>
                        <div><span class="text-base-content/60">{{ $t('backend') }}</span><div class="mt-1 truncate font-medium">{{ backendLabel }}</div></div>
                        <div><span class="text-base-content/60">{{ $t('collection') }}</span><div class="mt-1 font-medium">{{ $t('browserLocal') }}</div></div>
                      </div>
                      <div
                        v-for="child in childRows(row.label)"
                        :key="child.label"
                        class="bg-base-100 border-base-300/60 flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm"
                      >
                        <span class="min-w-0 truncate font-medium">{{ child.label }}</span>
                        <span class="text-base-content/65 shrink-0 tabular-nums">
                          ↑ {{ prettyBytesHelper(child.upload) }} · ↓ {{ prettyBytesHelper(child.download) }}
                        </span>
                        <span class="text-primary shrink-0 font-semibold tabular-nums">{{ prettyBytesHelper(child.total) }}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="text-base-content/60 border-base-300/60 border-t px-5 py-3 text-sm">{{ filteredDetailRows.length }} / {{ detailRows.length }}</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  aggregateDataUsage,
  clearDataUsage,
  dataUsageEnabled,
  dataUsageRetention,
  dataUsageRevision,
  queryDataUsage,
  type DataUsageDimension,
} from '@/assembly/data-usage'
import TimeSeriesChart from '@/components/charts/TimeSeriesChart.vue'
import type { ChartSeries, ChartTooltipParam } from '@/components/charts/chart-types'
import { useStorage } from '@/composables/use-storage'
import { prettyBytesHelper } from '@/helper/utils'
import { activeBackend } from '@/store/setup'
import {
  ArrowsRightLeftIcon,
  Bars3BottomLeftIcon,
  ChartBarIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CpuChipIcon,
  GlobeAltIcon,
  HashtagIcon,
  ServerIcon,
  Squares2X2Icon,
  UserIcon,
} from '@heroicons/vue/24/outline'
import dayjs from 'dayjs'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const dimension = useStorage<DataUsageDimension>('config/data-usage-dimension', 'host')
const range = useStorage<number>('config/data-usage-range', 3600000)
const retention = dataUsageRetention
const search = ref('')
const selectedPrimary = ref<string | null>(null)
const expandedHost = ref<string | null>(null)
const rows = ref<ReturnType<typeof aggregateDataUsage>>([])
const logs = ref<Awaited<ReturnType<typeof queryDataUsage>>>([])

const dimensions = computed(() => [
  { value: 'sourceIP' as const, label: t('devices'), icon: Squares2X2Icon },
  { value: 'inboundUser' as const, label: t('inboundUser'), icon: UserIcon },
  { value: 'host' as const, label: t('host'), icon: GlobeAltIcon },
  { value: 'outbound' as const, label: t('outbound'), icon: ArrowsRightLeftIcon },
  { value: 'process' as const, label: t('process'), icon: CpuChipIcon },
])
const currentDimensionLabel = computed(
  () => dimensions.value.find((item) => item.value === dimension.value)?.label || t('host'),
)
const endTime = ref(Date.now())
const startTime = computed(() => endTime.value - range.value)
const rangeLabel = computed(
  () => `${dayjs(startTime.value).format('YYYY-MM-DD HH:mm')} – ${dayjs(endTime.value).format('HH:mm')}`,
)
const backendLabel = computed(() => activeBackend.value?.label || activeBackend.value?.host || '-')
const selectedDetailDimension = computed<DataUsageDimension>(() => {
  if (!selectedPrimary.value) return dimension.value
  if (dimension.value === 'host') return 'sourceIP'
  return dimension.value === 'sourceIP' ? 'host' : 'host'
})
const selectedDetailDimensionLabel = computed(
  () => dimensions.value.find((item) => item.value === selectedDetailDimension.value)?.label || t('host'),
)
const detailTitle = computed(() => (selectedPrimary.value ? selectedDetailDimensionLabel.value : currentDimensionLabel.value))
const detailRows = computed(() => {
  if (!selectedPrimary.value) return rows.value
  const filtered = logs.value.filter((log) => {
    const value =
      dimension.value === 'sourceIP'
        ? log.sourceIP
        : dimension.value === 'inboundUser'
          ? log.inboundUser
          : dimension.value === 'host'
            ? log.host
            : dimension.value === 'outbound'
              ? log.outbound
              : log.process
    return value === selectedPrimary.value
  })
  return aggregateDataUsage(filtered, selectedDetailDimension.value)
})
const filteredDetailRows = computed(() => {
  const query = search.value.trim().toLowerCase()
  return query ? detailRows.value.filter((row) => row.label.toLowerCase().includes(query)) : detailRows.value
})
const totalUpload = computed(() => rows.value.reduce((sum, row) => sum + row.upload, 0))
const totalDownload = computed(() => rows.value.reduce((sum, row) => sum + row.download, 0))
const summaryCards = computed(() => [
  { label: currentDimensionLabel.value, value: rows.value.length, icon: HashtagIcon },
  { label: t('upload'), value: prettyBytesHelper(totalUpload.value), icon: CloudArrowUpIcon },
  { label: t('download'), value: prettyBytesHelper(totalDownload.value), icon: CloudArrowDownIcon },
  { label: t('total'), value: prettyBytesHelper(totalUpload.value + totalDownload.value), icon: ServerIcon },
])
const bucketSize = computed(() => {
  if (range.value <= 3600000) return 60000
  if (range.value <= 86400000) return 300000
  if (range.value <= 604800000) return 3600000
  return 86400000
})
const chartWindowSeconds = computed(() => Math.ceil(range.value / 1000))
const chartSeries = computed<ChartSeries[]>(() => {
  const buckets = new Map<number, { upload: number; download: number }>()
  for (let timestamp = startTime.value; timestamp <= endTime.value; timestamp += bucketSize.value) {
    buckets.set(Math.floor(timestamp / bucketSize.value) * bucketSize.value, { upload: 0, download: 0 })
  }
  logs.value.forEach((log) => {
    const bucket = buckets.get(Math.floor(log.timestamp / bucketSize.value) * bucketSize.value)
    if (bucket) {
      bucket.upload += log.upload
      bucket.download += log.download
    }
  })
  const series = (key: 'upload' | 'download', label: string): ChartSeries => ({
    name: label,
    data: Array.from(buckets.entries()).map(([timestamp, value]) => [timestamp, value[key]] as [number, number]),
  })
  return [series('upload', t('upload')), series('download', t('download'))]
})
const tooltipFormatter = (items: ChartTooltipParam[]) =>
  items
    .map((item) => {
      const value = Array.isArray(item.data) ? item.data[1] : item.data.value[1]
      return `${item.seriesName}: ${prettyBytesHelper(value)}`
    })
    .join('<br/>')
const childRows = (label: string) => {
  const childDimension: DataUsageDimension = selectedPrimary.value
    ? dimension.value === 'outbound'
      ? 'sourceIP'
      : 'outbound'
    : dimension.value === 'outbound'
      ? 'host'
      : dimension.value === 'host' || dimension.value === 'sourceIP'
        ? 'outbound'
        : 'outbound'
  const filtered = logs.value.filter((log) => {
    const rowValue =
      selectedDetailDimension.value === 'sourceIP'
        ? log.sourceIP
        : selectedDetailDimension.value === 'host'
          ? log.host
          : selectedDetailDimension.value === 'outbound'
            ? log.outbound
            : selectedDetailDimension.value === 'process'
              ? log.process
              : log.inboundUser
    if (rowValue !== label) {
      return false
    }
    if (!selectedPrimary.value) return true
    const value =
      dimension.value === 'sourceIP'
        ? log.sourceIP
        : dimension.value === 'inboundUser'
          ? log.inboundUser
          : dimension.value === 'host'
            ? log.host
            : dimension.value === 'outbound'
              ? log.outbound
              : log.process
    return value === selectedPrimary.value
  })
  return aggregateDataUsage(filtered, childDimension).slice(0, 12)
}
const refresh = async () => {
  endTime.value = Date.now()
  try {
    logs.value = await queryDataUsage(startTime.value, endTime.value)
    rows.value = aggregateDataUsage(logs.value, dimension.value)
    if (selectedPrimary.value && !rows.value.some((row) => row.label === selectedPrimary.value)) selectedPrimary.value = null
    if (expandedHost.value && !detailRows.value.some((row) => row.label === expandedHost.value)) expandedHost.value = null
  } catch {
    logs.value = []
    rows.value = []
  }
}
const selectPrimary = (label: string) => {
  selectedPrimary.value = selectedPrimary.value === label ? null : label
  expandedHost.value = null
}
const toggleHost = (label: string) => {
  expandedHost.value = expandedHost.value === label ? null : label
}
const clear = async () => {
  if (!window.confirm(t('confirmClearUsage'))) return
  await clearDataUsage()
  await refresh()
}

watch([dimension, range, dataUsageRevision], refresh, { immediate: true })
watch(retention, refresh)
</script>

<style scoped>
.usage-table th {
  height: 3rem;
  white-space: nowrap;
  font-weight: 600;
}

.usage-table td {
  height: 3.25rem;
  white-space: nowrap;
}

.usage-table tbody tr:nth-child(even) {
  background-color: color-mix(in oklab, var(--color-base-200) 48%, transparent);
}
</style>
