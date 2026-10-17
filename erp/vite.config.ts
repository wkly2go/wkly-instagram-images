import { defineConfig, type Plugin } from 'vite'
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

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __DESKTOP_VERSION__: JSON.stringify(DESKTOP_VERSION) },
})
