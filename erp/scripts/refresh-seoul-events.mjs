import { fetchCoexProspectEvents } from '../src/lib/prospectPublicSources.ts'
import { fetchSeoulEvents, SEOUL_SHEET_URL } from '../src/lib/seoulEventsTransport.ts'

// Prefer the public sheet's broader coverage and allow the culture portal if the
// sheet is unavailable or lacks current events. Each provider is queried once.
async function fetchSnapshot() {
  try {
    const sheet = await fetchSeoulEvents((url, options) => {
      if (url !== SEOUL_SHEET_URL) throw new Error('Use the public sheet first for snapshots.')
      return fetch(url, options)
    })
    if (sheet.events.length > 0) return sheet
  } catch {
    // The next attempt uses the official culture portal only.
  }

  return fetchSeoulEvents((url, options) => {
    if (url === SEOUL_SHEET_URL) throw new Error('Official Seoul sources were unavailable.')
    return fetch(url, options)
  })
}

try {
  const source = process.argv[2] ?? 'seoul'
  if (!['seoul', 'coex'].includes(source)) throw new Error('Unsupported event source.')
  const snapshot = source === 'coex' ? await fetchCoexProspectEvents() : await fetchSnapshot()
  const events = 'rows' in snapshot ? snapshot.rows : snapshot.events
  const payload = JSON.stringify(snapshot)
  if (!events.length || snapshot.scanned < events.length || Buffer.byteLength(payload, 'utf8') > 100000) {
    throw new Error('The snapshot must contain current events and fit within 100 KB.')
  }
  process.stdout.write(payload)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seoul event snapshot refresh failed.')
  process.exitCode = 1
}
