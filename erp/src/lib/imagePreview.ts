/** 원본은 그대로 두고, 긴 변 640px · 최대 96KB의 미리보기를 별도로 만든다. */
export const PREVIEW_MAX_BYTES = 96 * 1024
export function previewSize(width: number, height: number, edge = 640) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) throw new Error('사진 크기를 확인할 수 없습니다.')
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const PREVIEW_SUFFIX = '.preview.webp'
/**
 * 현장 사진의 미리보기 자리: '<원본 경로>.preview.webp'
 * - 2026-11-12 뒤에 올린 사진(이름이 'preview-v1-' 로 시작)은 올릴 때 미리보기를 같이 넣어 두므로 반드시 있다.
 * - 그 전에 올린 사진은 목록에서 처음 보일 때 만들어 같은 자리에 넣는다 (createSitePreviewBackfill · 2026-11-17).
 * 저장소 경로가 아닌 것(체험 모드의 data: 주소 등)과 미리보기 자신은 null.
 */
export const sitePreviewPath = (path: string): string | null =>
  !path || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.endsWith(PREVIEW_SUFFIX) ? null : `${path}${PREVIEW_SUFFIX}`

const PREVIEW_TYPES = /^image\/(jpeg|png|webp|avif|gif)$/
const PREVIEW_TYPES_COMPATIBLE = /^image\/(jpeg|png|webp|avif|gif|heic|heif)$/
export type PreviewOptions = {
  /** 현장 사진용: WebP 로 저장하지 못하는 브라우저(아이폰 · 사파리)에서는 JPEG 로 만들고, HEIC 도 브라우저가 읽을 수 있으면 만든다 */
  compatible?: boolean
}

export async function makeImagePreview(file: Blob, options: PreviewOptions = {}): Promise<Blob | null> {
  if (!(options.compatible ? PREVIEW_TYPES_COMPATIBLE : PREVIEW_TYPES).test(file.type) || typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  let canvas: HTMLCanvasElement | null = null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      const timer = window.setTimeout(() => reject(new Error('사진 미리보기 시간 초과')), 15_000)
      image.onload = () => { window.clearTimeout(timer); resolve(image) }
      image.onerror = () => { window.clearTimeout(timer); reject(new Error('사진을 읽지 못했습니다.')) }
      image.src = url
    })
    const sheet = canvas = document.createElement('canvas')
    const encode = (type: string) => new Promise<Blob | null>(resolve => sheet.toBlob(resolve, type, 0.72))
    for (const edge of [640, 480, 320]) {
      Object.assign(sheet, previewSize(img.naturalWidth, img.naturalHeight, edge))
      const context = sheet.getContext('2d')
      if (!context) return null
      context.drawImage(img, 0, 0, sheet.width, sheet.height)
      let blob = await encode('image/webp')
      if (options.compatible && blob?.type !== 'image/webp') {
        // WebP 로 저장하지 못하는 브라우저는 PNG 를 돌려줘 사진이 너무 커진다 → JPEG 로 (투명한 곳은 흰색)
        context.globalCompositeOperation = 'destination-over'
        context.fillStyle = '#fff'
        context.fillRect(0, 0, sheet.width, sheet.height)
        context.globalCompositeOperation = 'source-over'
        blob = await encode('image/jpeg')
      }
      if (blob && blob.size <= PREVIEW_MAX_BYTES) return blob
    }
    return null
  } catch {
    return null // 미리보기 생성 실패 때문에 원본 업로드를 막지 않는다.
  } finally {
    URL.revokeObjectURL(url)
    if (canvas) { canvas.width = 0; canvas.height = 0 } // 큰 사진을 그린 캔버스 메모리를 바로 돌려준다.
  }
}

// ---------------------------------------------------------------- 예전 현장 사진의 미리보기 채우기 (2026-11-17)
//   대표 지시 '실측사진들이 인트라넷에서 미리보기가 안 떠있으니까 미리보기가 떠있게끔'
//   미리보기 기능(2026-11-12) 전에 올린 사진은 미리보기 파일이 없어 목록에 '사진 열기'만 보였다.
//   → 목록에서 그 사진이 화면에 보이면 원본을 한 번만 받아 작은 미리보기를 만들어 저장소에 넣는다.
//     그다음부터는 누구에게나 작은 미리보기만 내려간다 (서버 작업 · 비용 없음).

type KeyValueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type PreviewMissStore = { has(path: string): boolean; add(path: string): void; remove(path: string): void }
export const PREVIEW_MISS_KEY = 'wkly-site-preview-miss'
export const PREVIEW_MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000
export const PREVIEW_MISS_MAX = 300

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * 이 브라우저가 미리보기를 만들 수 없던 사진(읽지 못하는 형식 등)을 기억한다.
 * 방문할 때마다 원본을 다시 받지 않게 하고, 7일 뒤에 한 번 더 시도한다. (경로 → 실패한 시각 · 최대 300개)
 */
export function createPreviewMissStore(options: { storage?: KeyValueStore | null; now?: () => number } = {}): PreviewMissStore {
  const now = options.now ?? Date.now
  const store = () => (options.storage === undefined ? browserStore() : options.storage)
  // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 이 창을 닫을 때까지만 기억한다.
  const session = new Map<string, number>()
  const fresh = (at: unknown, time: number): at is number => typeof at === 'number' && at <= time && time - at < PREVIEW_MISS_RETRY_MS
  const read = () => {
    const time = now()
    const found = new Map<string, number>()
    try {
      const saved: unknown = JSON.parse(store()?.getItem(PREVIEW_MISS_KEY) || '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [path, at] of Object.entries(saved)) if (fresh(at, time)) found.set(path, at)
    } catch {
      /* 깨진 값은 없는 것으로 본다 */
    }
    for (const [path, at] of session) {
      if (fresh(at, time)) found.set(path, at)
      else session.delete(path)
    }
    return found
  }
  const write = (found: Map<string, number>) => {
    const kept = [...found].sort((a, b) => b[1] - a[1]).slice(0, PREVIEW_MISS_MAX)
    try {
      store()?.setItem(PREVIEW_MISS_KEY, JSON.stringify(Object.fromEntries(kept)))
    } catch {
      /* 기억하지 못해도 괜찮음 */
    }
  }
  return {
    has: path => read().has(path),
    add(path) {
      session.delete(path)
      session.set(path, now())
      if (session.size > PREVIEW_MISS_MAX) session.delete(session.keys().next().value as string)
      write(read())
    },
    remove(path) {
      session.delete(path)
      const found = read()
      if (found.delete(path)) write(found)
    },
  }
}

type SignedItem = { path?: string | null; signedUrl?: string | null; error?: string | null }
type StorageFailure = { message?: string; status?: number; statusCode?: string | number; error?: string }
/** Supabase 저장소(버킷) 기능 가운데 미리보기에 쓰는 것만 */
export type PreviewBucket = {
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>
  createSignedUrls(paths: string[], expiresIn: number): PromiseLike<{ data: SignedItem[] | null; error: unknown }>
  upload(path: string, body: Blob, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: StorageFailure | null }>
}
export type SitePreviewOptions = {
  bucket(): PreviewBucket
  /** 서명 주소 캐시: 같은 경로를 동시에 · 다시 열어도 한 번만 서명한다 (실패는 캐시에 남기지 않음) */
  signed(path: string, load: () => Promise<string>): Promise<string>
  /** 그 경로의 캐시된 주소를 버린다 (새로 넣은 뒤 · 만료된 주소로 사진이 안 열릴 때) */
  invalidate?(path: string): void
  /** 로그인한 사람: 진행 중인 작업을 계정별로 나눈다 */
  scope?(): string | null
  fetchBlob?(url: string): Promise<Blob>
  makePreview?(original: Blob): Promise<Blob | null>
  misses?: PreviewMissStore
  /** 한 번에 만드는 장 수 (원본을 통째로 풀어 줄이므로 기본 2장) */
  concurrency?: number
  /** 한 장에 쓰는 최대 시간 */
  timeoutMs?: number
  now?: () => number
}

/** 내려받기 · 올리기에 실패한 사진은 10분 동안 다시 받지 않고, 3장 연속 실패하면 10분 동안 만들기를 쉰다. */
const BUILD_RETRY_MS = 10 * 60 * 1000
const BUILD_FAILURES_BEFORE_PAUSE = 3
const DOWNLOAD_TIMEOUT_MS = 60_000

class PreviewNotStored extends Error {}

const alreadyStored = (error: StorageFailure) =>
  String(error.statusCode ?? '') === '409' || error.status === 409 || /already exists|duplicate/i.test(`${error.message ?? ''} ${error.error ?? ''}`)
/** 저장소가 "그런 파일이 없다"고 답한 것 (연결 오류 · 로그인 만료 · 서버 오류와 구분한다) */
const notStored = (error: unknown) => {
  const failure = (error && typeof error === 'object' ? error : {}) as StorageFailure
  return String(failure.statusCode ?? '') === '404' || failure.status === 404 || /not.?found|does not exist/i.test(`${failure.message ?? ''} ${failure.error ?? ''}`)
}

async function downloadBlob(url: string): Promise<Blob> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS) : undefined
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined)
    if (!response.ok) throw new Error('사진을 내려받지 못했습니다.')
    return await response.blob()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('사진 미리보기 시간 초과')), ms)
    work.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

export type SitePreviewBackfill = ReturnType<typeof createSitePreviewBackfill>

export function createSitePreviewBackfill(options: SitePreviewOptions) {
  const now = options.now ?? Date.now
  const misses = options.misses ?? createPreviewMissStore({ now })
  const makePreview = options.makePreview ?? ((original: Blob) => makeImagePreview(original, { compatible: true }))
  const fetchBlob = options.fetchBlob ?? downloadBlob
  const limit = Math.max(1, options.concurrency ?? 2)
  const timeoutMs = options.timeoutMs ?? 120_000
  /** 진행 중인 작업 (계정 · 경로마다 하나): 같은 사진의 썸네일이 둘이어도 원본은 한 번만 받는다 */
  const jobs = new Map<string, Promise<string | null>>()
  const failedAt = new Map<string, number>()
  const waiting: (() => void)[] = []
  let running = 0
  let failuresInRow = 0
  let pausedUntil = 0

  /** 동시에 limit 장까지만. 나머지는 차례를 기다린다. */
  const slot = <T,>(work: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        running++
        void Promise.resolve().then(work).then(resolve, reject).finally(() => { running--; waiting.shift()?.() })
      }
      if (running < limit) start()
      else waiting.push(start)
    })

  /** 미리보기 주소 · 아직 없으면 null · 확인하지 못하면 오류 (없는 것과 연결 오류를 구분하려고 여러 장용 서명을 쓴다) */
  const signPreview = async (previewPath: string): Promise<string | null> => {
    try {
      return await options.signed(previewPath, async () => {
        const result = await options.bucket().createSignedUrls([previewPath], 3600)
        if (result.error && notStored(result.error)) throw new PreviewNotStored()
        const items = result.error || !Array.isArray(result.data) ? null : result.data
        const item = items?.find(entry => entry?.path === previewPath) ?? (items?.length === 1 ? items[0] : undefined)
        if (!item) throw new Error('사진 미리보기를 열 수 없습니다.')
        if (!item.signedUrl) throw new PreviewNotStored()
        return item.signedUrl
      })
    } catch (error) {
      if (error instanceof PreviewNotStored) return null
      throw error
    }
  }

  const build = async (original: string, previewPath: string): Promise<string | null> => {
    const url = await options.signed(original, async () => {
      const result = await options.bucket().createSignedUrl(original, 3600)
      if (result.error || !result.data?.signedUrl) throw new Error('사진을 열 수 없습니다.')
      return result.data.signedUrl
    })
    const preview = await makePreview(await fetchBlob(url))
    if (!preview) {
      misses.add(original) // 이 브라우저가 읽지 못하는 사진: 7일 동안 원본을 다시 받지 않는다.
      return null
    }
    // 덮어쓰지 않는다. 다른 사람이 먼저 넣었으면(이미 있음) 그것을 쓴다.
    const saved = await options.bucket().upload(previewPath, preview, { contentType: preview.type || 'image/webp', upsert: false })
    if (saved.error && !alreadyStored(saved.error)) throw new Error('사진 미리보기를 저장하지 못했습니다.')
    options.invalidate?.(previewPath)
    const ready = await signPreview(previewPath)
    if (!ready) throw new Error('사진 미리보기를 열 수 없습니다.')
    misses.remove(original)
    return ready
  }

  const run = async (original: string, previewPath: string, key: string): Promise<string | null> => {
    let ready: string | null
    try {
      ready = await signPreview(previewPath) // 이미 있으면(다른 사람이 만들었으면) 원본을 받지 않는다.
    } catch {
      return null // 확인하지 못했으면 원본도 받지 않는다 (다음에 다시).
    }
    if (ready) return ready
    const failed = failedAt.get(key)
    if ((failed !== undefined && now() - failed < BUILD_RETRY_MS) || now() < pausedUntil || misses.has(original)) return null
    try {
      // 차례를 기다리는 동안 쉬기로 했으면 받지 않는다.
      const made = await slot(() => (now() < pausedUntil ? Promise.resolve(null) : withTimeout(build(original, previewPath), timeoutMs)))
      if (made) { failuresInRow = 0; failedAt.delete(key) }
      return made
    } catch {
      failedAt.set(key, now())
      if (++failuresInRow >= BUILD_FAILURES_BEFORE_PAUSE) { failuresInRow = 0; pausedUntil = now() + BUILD_RETRY_MS }
      return null
    }
  }

  return {
    /** 목록용 미리보기 주소. 아직 미리보기가 없는 사진은 null (화면이 ensure 로 만들기 시작) · 확인하지 못하면 오류 */
    async previewUrl(original: string, refresh = false): Promise<string | null> {
      const previewPath = sitePreviewPath(original)
      if (!previewPath) return null
      if (refresh) options.invalidate?.(previewPath)
      return signPreview(previewPath)
    },
    /** 미리보기가 없으면 원본을 한 번 받아 만들어 넣고 그 주소를 돌려준다. 만들 수 없으면 null — 오류를 던지지 않는다. */
    ensure(original: string): Promise<string | null> {
      const previewPath = sitePreviewPath(original)
      if (!previewPath) return Promise.resolve(null)
      const key = JSON.stringify([options.scope?.() ?? null, original])
      const current = jobs.get(key)
      if (current) return current
      const job = run(original, previewPath, key).catch(() => null)
      jobs.set(key, job)
      void job.finally(() => { if (jobs.get(key) === job) jobs.delete(key) })
      return job
    },
    /** 올릴 때 이미 이 브라우저가 미리보기를 만들지 못한 사진: 목록에서 원본을 다시 받지 않게 기억해 둔다. */
    remember(original: string) {
      misses.add(original)
    },
  }
}
