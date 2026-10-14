import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
