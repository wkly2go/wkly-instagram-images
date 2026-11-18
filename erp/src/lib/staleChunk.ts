// 배포 뒤 예전 화면이 지워진 조각 파일을 부를 때 나는 오류인지 (브라우저마다 글이 다름 · components/ErrorBoundary.tsx)
export const isStaleChunkError = (e: unknown): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed/i.test(
    e instanceof Error ? `${e.name} ${e.message}` : String(e),
  )

