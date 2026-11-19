import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

// 지금 배포본과 짝인 PC 프로그램 버전 (desktop/package.json): 이보다 낮은 PC 프로그램에는 업데이트 안내를 띄움
const DESKTOP_VERSION = (JSON.parse(readFileSync(new URL('./desktop/package.json', import.meta.url), 'utf8')) as { version: string }).version

// 배포마다 바뀌는 빌드 번호: 열려 있는 창이 새 버전을 알아채고 스스로 새로고침하는 데 씀
const BUILD_ID = `${Date.now().toString(36)}-${(process.env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7)}`

// 능력 지표에 쓰는 빌드 값 (2026-11-19): 첫 화면에 꼭 받는 양 · 업데이트 뒤 다시 받는 양 · 시험 수 · 메뉴별 설명서 수
// version.json 에 함께 적어 두면 관리 화면이 읽어 서버(admin_capability_build)로 넘긴다. 기준은 docs/CAPABILITY_SCORE.md
const here = (p: string) => new URL(p, import.meta.url)
const countIn = (file: URL, re: RegExp) => { try { return (readFileSync(file, 'utf8').match(re) ?? []).length } catch { return 0 } }
const countTests = (dir: URL): number => {
  let n = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countTests(new URL(`${e.name}/`, dir))
      else if (/\.test\.(ts|mts|mjs)$/.test(e.name)) n += countIn(new URL(e.name, dir), /^\s*(test|it)\(/gm)
    }
  } catch { /* 폴더 없음 */ }
  return n
}
const kb = (src: string | Uint8Array) => gzipSync(typeof src === 'string' ? Buffer.from(src) : src).length / 1024
const round1 = (n: number) => Math.round(n * 10) / 10

const versionFile = (): Plugin => ({
  name: 'wkly-version-file',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const entry = Object.values(bundle).find(c => c.type === 'chunk' && c.isEntry)
    let first = 0, app = 0, css = 0
    if (entry && entry.type === 'chunk') {
      const seen = new Set<string>()
      const cssFiles = new Set<string>()
      const walk = (name: string) => {
        if (seen.has(name)) return
        seen.add(name)
        const c = bundle[name]
        if (!c || c.type !== 'chunk') return
        first += kb(c.code)
        for (const f of (c as unknown as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? []) cssFiles.add(f)
        for (const i of c.imports) walk(i)
      }
      walk(entry.fileName)
      app = kb(entry.code)
      for (const f of cssFiles) { const a = bundle[f]; if (a && a.type === 'asset') css += kb(a.source) }
      first += css
    }
    const stats = {
      first_load_kb: round1(first), update_kb: round1(app + css), app_kb: round1(app),
      tests: countTests(here('./tests/')),
      menus: countIn(here('./src/components/Shell.tsx'), /^\s*\{ key: '[A-Za-z]+', label: '/gm),
      manual_pages: countIn(here('./src/lib/manual.ts'), /^ {2}[A-Za-z]+: \{$/gm),
      ci: existsSync(here('../.github/workflows/ci.yml')),
      runbook: existsSync(here('./docs/RUNBOOK.md')),
    }
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID, stats }) })
  },
})

// 첫 화면에서 서버(Supabase)와 미리 연결해 둠 — 로그인 · 첫 조회가 연결 맺는 시간만큼 빨라짐 (체험 모드는 주소가 없어 넣지 않음)
const preconnectApi = (): Plugin => ({
  name: 'wkly-preconnect-api',
  transformIndexHtml(html, ctx) {
    const url = loadEnv(ctx.server?.config.mode ?? process.env.WKLY_BUILD_MODE ?? 'production', process.cwd(), 'VITE_').VITE_SUPABASE_URL
    if (!url || !/^https:\/\/[a-z0-9.-]+$/i.test(url)) return html
    return { html, tags: [{ tag: 'link', attrs: { rel: 'preconnect', href: url, crossorigin: '' }, injectTo: 'head-prepend' }] }
  },
})

export default defineConfig(({ mode }) => {
  process.env.WKLY_BUILD_MODE = mode
  return {
    plugins: [react(), versionFile(), preconnectApi()],
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __DESKTOP_VERSION__: JSON.stringify(DESKTOP_VERSION) },
    build: {
      rollupOptions: {
        output: {
          // 잘 안 바뀌는 라이브러리는 따로 묶음 (2026-11-19 성능): 하루에도 여러 번 배포하는데, 예전엔 '업데이트'를 누를 때마다
          // 라이브러리까지 든 한 덩어리(1MB)를 다시 받았다. 따로 묶으면 그 파일 이름(내용 해시)이 그대로라 브라우저가 다시 받지 않는다.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/node_modules\/(@supabase|iceberg-js)\//.test(id)) return 'vendor-supabase'
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
            return undefined
          },
        },
      },
    },
  }
})
