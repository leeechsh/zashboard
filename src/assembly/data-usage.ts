import { connectionAccessor } from '@/assembly/connections'
import { activeUuid } from '@/store/setup'
import { useStorage } from '@/composables/use-storage'
import type { Connection } from '@/types'
import { ref } from 'vue'

export type DataUsageDimension = 'sourceIP' | 'host' | 'process' | 'outbound' | 'inboundUser'

export interface DataUsageLog {
  id?: number
  backend: string
  timestamp: number
  sourceIP: string
  host: string
  outbound: string
  process: string
  inboundUser: string
  upload: number
  download: number
}

export interface DataUsageAggregate {
  label: string
  upload: number
  download: number
  total: number
  count: number
}

const DB_NAME = 'zashboard-data-usage'
const STORE_NAME = 'logs'
const DB_VERSION = 1

class UsageDatabase {
  private db: IDBDatabase | null = null

  private async open() {
    if (this.db) return this.db
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (db.objectStoreNames.contains(STORE_NAME)) return
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('backendTimestamp', ['backend', 'timestamp'], { unique: false })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.db
  }

  async add(logs: DataUsageLog[]) {
    if (!logs.length) return
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      logs.forEach((log) => store.add(log))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async query(backend: string, start: number, end: number) {
    const db = await this.open()
    return new Promise<DataUsageLog[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const index = tx.objectStore(STORE_NAME).index('backendTimestamp')
      const request = index.openCursor(
        IDBKeyRange.bound([backend, start], [backend, end]),
      )
      const rows: DataUsageLog[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve(rows)
        rows.push(cursor.value as DataUsageLog)
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clear(backend: string) {
    const rows = await this.query(backend, 0, Number.MAX_SAFE_INTEGER)
    if (!rows.length) return
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      rows.forEach((row) => row.id !== undefined && store.delete(row.id))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async cleanup(backend: string, before: number) {
    const rows = await this.query(backend, 0, before)
    if (!rows.length) return
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      rows.forEach((row) => row.id !== undefined && store.delete(row.id))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

const database = new UsageDatabase()
const retention = useStorage<number>('config/data-usage-retention', -1)
const enabled = useStorage<boolean>('config/data-usage-enabled', true)
export const dataUsageRevision = ref(0)

let previous = new Map<string, { upload: number; download: number }>()
let initialized = false
let lastUploadTotal = 0
let lastDownloadTotal = 0
let buffer = new Map<string, DataUsageLog>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
let sessionBackend = ''

const backendKey = () => sessionBackend || activeUuid.value || 'default'
const accessor = () => connectionAccessor()

const logKey = (log: DataUsageLog) =>
  `${log.timestamp}\x1f${log.sourceIP}\x1f${log.host}\x1f${log.outbound}\x1f${log.process}\x1f${log.inboundUser}`

const flush = async () => {
  if (!buffer.size) return
  const backend = backendKey()
  const logs = Array.from(buffer.values())
  buffer = new Map()
  await database.add(logs)
  if (retention.value > 0) await database.cleanup(backend, Date.now() - retention.value)
  dataUsageRevision.value++
}

const scheduleFlush = () => {
  if (flushTimer) return
  flushTimer = setTimeout(async () => {
    flushTimer = undefined
    try {
      await flush()
    } catch {
      // IndexedDB can be unavailable in private browsing; live connections still work.
    }
    if (buffer.size) scheduleFlush()
  }, 30000)
}

export const resetDataUsageTracking = () => {
  previous = new Map()
  initialized = false
  lastUploadTotal = 0
  lastDownloadTotal = 0
}

export const startDataUsage = () => {
  resetDataUsageTracking()
  buffer = new Map()
  sessionBackend = activeUuid.value || 'default'
}

export const stopDataUsage = () => {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = undefined
  flush().catch(() => {})
  resetDataUsageTracking()
  sessionBackend = ''
}

export const updateDataUsage = (
  connections: Connection[],
  uploadTotal?: number,
  downloadTotal?: number,
) => {
  if (!enabled.value) {
    resetDataUsageTracking()
    buffer = new Map()
    return
  }
  if (
    uploadTotal !== undefined &&
    downloadTotal !== undefined &&
    (uploadTotal < lastUploadTotal || downloadTotal < lastDownloadTotal)
  ) {
    resetDataUsageTracking()
    clearDataUsage().catch(() => {})
  }
  if (uploadTotal !== undefined) lastUploadTotal = uploadTotal
  if (downloadTotal !== undefined) lastDownloadTotal = downloadTotal

  if (!initialized) {
    initialized = true
    connections.forEach((connection) => {
      previous.set(connection.id, {
        upload: accessor().upload(connection),
        download: accessor().download(connection),
      })
    })
    return
  }

  const timestamp = Math.floor(Date.now() / 60000) * 60000
  const active = new Set<string>()
  connections.forEach((connection) => {
    active.add(connection.id)
    const upload = accessor().upload(connection)
    const download = accessor().download(connection)
    const old = previous.get(connection.id)
    const uploadDelta = Math.max(0, upload - (old?.upload ?? 0))
    const downloadDelta = Math.max(0, download - (old?.download ?? 0))
    previous.set(connection.id, { upload, download })
    if (!uploadDelta && !downloadDelta) return

    const log: DataUsageLog = {
      backend: backendKey(),
      timestamp,
      sourceIP: accessor().sourceIP(connection) || 'Inner',
      host: accessor().hostname(connection) || accessor().destination(connection) || 'Unknown',
      outbound: accessor().chains(connection)[0] || 'DIRECT',
      process: accessor().process(connection) || 'Unknown',
      inboundUser: accessor().inboundUser(connection) || 'Unknown',
      upload: uploadDelta,
      download: downloadDelta,
    }
    const existing = buffer.get(logKey(log))
    if (existing) {
      existing.upload += uploadDelta
      existing.download += downloadDelta
    } else {
      buffer.set(logKey(log), log)
    }
  })
  previous.forEach((_, id) => {
    if (!active.has(id)) previous.delete(id)
  })
  if (buffer.size) scheduleFlush()
}

export const queryDataUsage = async (start: number, end: number) =>
  database.query(backendKey(), start, end)

export const aggregateDataUsage = (
  logs: DataUsageLog[],
  dimension: DataUsageDimension,
): DataUsageAggregate[] => {
  const map = new Map<string, DataUsageAggregate>()
  for (const log of logs) {
    const label =
      dimension === 'sourceIP'
        ? log.sourceIP
        : dimension === 'host'
          ? log.host
          : dimension === 'process'
            ? log.process
            : dimension === 'outbound'
              ? log.outbound
              : log.inboundUser
    const row = map.get(label) ?? { label, upload: 0, download: 0, total: 0, count: 0 }
    row.upload += log.upload
    row.download += log.download
    row.total += log.upload + log.download
    row.count++
    map.set(label, row)
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

export const clearDataUsage = async () => {
  buffer = new Map()
  resetDataUsageTracking()
  await database.clear(backendKey())
  dataUsageRevision.value++
}

export const dataUsageEnabled = enabled
export const dataUsageRetention = retention
