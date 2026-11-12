import type { SlackLink, SlackMessage } from './types'

/** 확인 시각만 달라진 경우에는 긴 대화 본문을 다시 받지 않는다. */
export function slackContentVersion(links: SlackLink[]): string {
  return JSON.stringify(links.map(link => [link.id, link.channel_id, link.last_ts, link.imported_count, link.file_count]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

export function createSlackSnapshotLoader(api: {
  listSlackLinks: (projectId: string) => Promise<SlackLink[]>
  listSlackMessages: (projectId: string, limit?: number) => Promise<SlackMessage[]>
}, projectId: string, now: () => number = Date.now) {
  let version: string | undefined
  let messages: SlackMessage[] = []
  let lastReadAt = -Infinity
  let requestedRefresh = 0
  let completedRefresh = 0
  return {
    forceMessages() {
      requestedRefresh++
    },
    async load() {
      const links = await api.listSlackLinks(projectId)
      const nextVersion = slackContentVersion(links)
      const refresh = requestedRefresh
      // 수집 상태와 별개인 정정·삭제도 오래된 화면에 남지 않도록 5분마다 재확인한다.
      if (completedRefresh !== refresh || version !== nextVersion || now() - lastReadAt >= 300_000) {
        // 첫 조회는 연결 해제 후에도 보존되는 이전 대화를 포함한다.
        messages = await api.listSlackMessages(projectId, 500)
        version = nextVersion
        completedRefresh = refresh
        lastReadAt = now()
      }
      return { links, messages }
    },
  }
}
