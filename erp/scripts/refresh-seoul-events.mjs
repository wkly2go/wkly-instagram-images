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
  const snapshot = await fetchSnapshot()
  const payload = JSON.stringify(snapshot)
  if (!snapshot.events.length || snapshot.scanned < snapshot.events.length || Buffer.byteLength(payload, 'utf8') > 100000) {
    throw new Error('Seoul event snapshot must contain current events and fit within 100 KB.')
  }
  process.stdout.write(payload)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seoul event snapshot refresh failed.')
  process.exitCode = 1
}
