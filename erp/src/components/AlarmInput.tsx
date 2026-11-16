import { useState } from 'react'

const pad = (n: number) => String(n).padStart(2, '0')
/** Date → datetime-local 값 (이 기기 시간) */
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const at = (base: Date, addDays: number, h: number, m = 0) => {
  const d = new Date(base)
  d.setDate(d.getDate() + addDays)
  d.setHours(h, m, 0, 0)
  return d
}
/** 그 주의 요일(0 일 ~ 6 토)까지 남은 날 수. 오늘이 그 요일이고 시각이 지났으면 다음 주 */
const daysTo = (now: Date, dow: number, h: number) => {
  let n = (dow - now.getDay() + 7) % 7
  if (n === 0 && now.getHours() >= h) n = 7
  return n
}

/** 알람 빠른 선택 (대표 지시 2026-11-16 '날짜 · 시간 지정과 일주일 후 · 주말 같은 다양한 선택') */
export function alarmPresets(now = new Date()): { label: string; value: string }[] {
  const hourLater = new Date(now.getTime() + 3600_000)
  hourLater.setSeconds(0, 0)
  const list: [string, Date][] = [
    ['1시간 뒤', hourLater],
    ['오늘 오후 6시', at(now, 0, 18)],
    ['내일 오전 9시', at(now, 1, 9)],
    ['모레 오전 9시', at(now, 2, 9)],
    ['이번 금요일 오후 5시', at(now, daysTo(now, 5, 17), 17)],
    ['주말 (토 오전 10시)', at(now, daysTo(now, 6, 10), 10)],
    ['다음 주 월요일 오전 9시', at(now, daysTo(now, 1, 9) || 7, 9)],
    ['일주일 후', at(now, 7, 9)],
    ['2주 후', at(now, 14, 9)],
    ['한 달 후', (() => { const d = at(now, 0, 9); d.setMonth(d.getMonth() + 1); return d })()],
  ]
  return list.filter(([, d]) => d.getTime() > now.getTime() + 60_000).map(([label, d]) => ({ label, value: toLocal(d) }))
}

/**
 * 알람 시각 입력: 날짜 · 시간 직접 지정 + 빠른 선택 목록
 *  - value / onChange 는 datetime-local 문자열 ('' = 알람 없음)
 */
export function AlarmInput({ value, onChange, width, label = '알람 시각' }: { value: string; onChange: (v: string) => void; width?: number; label?: string }) {
  const [pick, setPick] = useState('')
  const presets = alarmPresets()
  return (
    <span className="alarm-input">
      <input className="input" style={width ? { width } : undefined} type="datetime-local" value={value} onChange={e => { setPick(''); onChange(e.target.value) }} aria-label={label} />
      <select
        className="select alarm-preset"
        value={pick}
        onChange={e => {
          const v = e.target.value
          setPick(v === 'clear' ? '' : v)
          if (v === 'clear') onChange('')
          else if (v) onChange(presets.find(p => p.label === v)?.value ?? '')
        }}
        aria-label="알람 빠른 선택"
      >
        <option value="">빠른 선택</option>
        {presets.map(p => (
          <option key={p.label} value={p.label}>
            {p.label} · {p.value.slice(5, 10).replace('-', '.')} {p.value.slice(11)}
          </option>
        ))}
        {value && <option value="clear">알람 지우기</option>}
      </select>
    </span>
  )
}
