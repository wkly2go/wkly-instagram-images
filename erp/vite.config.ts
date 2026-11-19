import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// 지금 배포본과 짝인 PC 프로그램 버전 (desktop/package.json): 이보다 낮은 PC 프로그램에는 업데이트 안내를 띄움
const DESKTOP_VERSION = (JSON.parse(readFileSync(new URL('./desktop/package.json', import.meta.url), 'utf8')) as { version: string }).version

// 배포마다 바뀌는 빌드 번호: 열려 있는 창이 새 버전을 알아채고 스스로 새로고침하는 데 씀
const BUILD_ID = `${Date.now().toString(36)}-${(process.env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7)}`

const versionFile = (): Plugin => ({
  name: 'wkly-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
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
