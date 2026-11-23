import { useEffect, useRef, useState } from 'react'
import type { FloorView, LootValue, RunView, SanctumView, TrackedItem } from '@shared/sanctum'
import { formatDuration } from './format'

const ROOMS_PER_FLOOR = 8
const FLOORS = [1, 2, 3, 4]
/** The height the bar is drawn for; the window's real height scales everything from this. */
const DESIGN_HEIGHT = 87

const number = (value: number, digits = 0): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** "≈ 198 c · 1,56 div" */
function valueText(loot: LootValue): string {
  const divine = loot.divine != null ? ` · ${number(loot.divine, 2)} div` : ''
  return `≈ ${number(loot.chaos, loot.chaos < 100 ? 1 : 0)} c${divine}`
}

interface BarRun {
  run: RunView
  /** Where the clock is running: floor number and room index, null when it is not in a room. */
  floor: number | null
  room: number | null
  /** Milliseconds since the last log event, to add to whatever is ticking. */
  live: number
}

/** A made-up run in progress, shown while the player is placing the bar outside a run. */
const DEMO: BarRun = (() => {
  const rooms = [
    [18, 15, 18, 22, 16, 18, 14, 13],
    [22, 23, 18, 16, 15, 23, 13, 17],
    [21, 16, 15, 9]
  ]
  const floors: FloorView[] = rooms.map((times, i) => ({
    floor: i + 1,
    rooms: times.length,
    roomMs: times.map((seconds) => seconds * 1000),
    ms: (times.reduce((sum, seconds) => sum + seconds, 0) + 6) * 1000,
    done: i < 2,
    loot: i < 2 ? { lines: [], gold: 0, chaos: [41, 96][i], divine: null, unpriced: 0 } : null
  }))
  const line = (name: string, count: number, chaos: number) => ({ name, count, chaos, icon: null, currency: true })
  return {
    run: {
      id: 0,
      sessionId: 0,
      startedAt: 0,
      endedAt: null,
      outcome: 'active',
      floors,
      transitMs: 9000,
      durationMs: floors.reduce((sum, floor) => sum + floor.ms, 0) + 9000,
      loot: {
        lines: [line('Divine Orb', 1, 196), line('Chaos Orb', 34, 34), line('Exalted Orb', 4, 3.4)],
        gold: 0,
        chaos: 233.4,
        divine: 1.19,
        unpriced: 0
      },
      lootNote: null
    },
    floor: 3,
    room: 3,
    live: 0
  }
})()

function Chips({ tracked, trackAll, loot }: { tracked: TrackedItem[]; trackAll: boolean; loot: LootValue }) {
  const chips = tracked.map((item) => {
    const line = loot.lines.find((entry) => entry.name === item.name)
    return { name: item.name, icon: item.icon ?? line?.icon ?? null, count: line?.count ?? 0 }
  })
  if (trackAll) {
    for (const line of loot.lines) {
      if (line.currency && !chips.some((chip) => chip.name === line.name)) {
        chips.push({ name: line.name, icon: line.icon, count: line.count })
      }
    }
  }
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.name} className={chip.count ? 'chip' : 'chip zero'} title={chip.name}>
          {chip.icon ? <img src={chip.icon} alt="" /> : <i className="noicon">{chip.name.slice(0, 2)}</i>}
          <b>{number(chip.count)}</b>
        </span>
      ))}
    </>
  )
}

function Floor({ number: floorNumber, data, shown }: { number: number; data: FloorView | undefined; shown: BarRun }) {
  const current = shown.floor === floorNumber
  const behind = !!data && (data.done || (!current && data.rooms >= ROOMS_PER_FLOOR))
  const state = behind ? 'done' : current ? 'now' : 'todo'
  return (
    <div className={`floor ${state}`}>
      <div className="rooms">
        {Array.from({ length: ROOMS_PER_FLOOR }, (_, i) => {
          const ms = data?.roomMs[i]
          const here = current && shown.room === i
          const roomState = ms === undefined ? 'todo' : here ? 'now' : 'done'
          return (
            <div key={i} className={`room ${roomState}${i === ROOMS_PER_FLOOR - 1 ? ' boss' : ''}`}>
              <span className="t">{ms === undefined ? '' : formatDuration(ms + (here ? shown.live : 0))}</span>
              <i />
            </div>
          )
        })}
      </div>
      <div className="foot">
        <b>Этаж {floorNumber}</b>
        {data && <span className="ft">{formatDuration(data.ms + (current ? shown.live : 0))}</span>}
        {data?.loot && data.loot.chaos > 0 && <span className="fl">+{number(data.loot.chaos)} c</span>}
      </div>
    </div>
  )
}

/** The horizontal Sanctum tracker: currency gained, the 32 rooms with their times, run and session clocks. */
export function SanctumBar({ view, now, demo }: { view: SanctumView; now: number; demo: boolean }) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const [zoom, setZoom] = useState(1)

  // Everything is drawn for one height; a taller or shorter window scales it as a whole.
  useEffect(() => {
    const element = wrap.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setZoom(Math.min(3, Math.max(0.5, element.clientHeight / DESIGN_HEIGHT)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const shown: BarRun | null = view.active
    ? {
        run: view.active.run,
        floor: view.active.floor,
        room: view.active.room,
        live: view.active.inSanctum ? Math.max(0, now - view.active.since) : 0
      }
    : view.finished
      ? { run: view.finished, floor: null, room: null, live: 0 }
      : demo
        ? DEMO
        : null

  return (
    <div className="sbar-wrap" ref={wrap}>
      {shown && (
        <div className="sbar" style={{ zoom }}>
          <div className="side left">
            <div className="big">{formatDuration(shown.run.durationMs + shown.live)}</div>
            <div className="cap">забег</div>
          </div>
          <div className="main">
            <div className="lootrow">
              <div className="chips">
                <Chips tracked={view.tracked} trackAll={view.trackAll} loot={shown.run.loot} />
              </div>
              <span className="value">{valueText(shown.run.loot)}</span>
            </div>
            <div className="floors">
              {FLOORS.map((floorNumber) => (
                <Floor
                  key={floorNumber}
                  number={floorNumber}
                  data={shown.run.floors.find((floor) => floor.floor === floorNumber)}
                  shown={shown}
                />
              ))}
            </div>
          </div>
          <div className="side right">
            <div className="big small">{formatDuration(Math.max(0, now - view.sessionStartedAt))}</div>
            <div className="cap">сессия</div>
            <div className="counts">
              заходов: {view.runCounts.session} за сессию · {view.runCounts.today} сегодня
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
