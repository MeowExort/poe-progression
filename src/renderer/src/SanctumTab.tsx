import { useEffect, useState } from 'react'
import type { SessionState } from '@shared/api'
import type { LootValue, RunView, SanctumTotals, SanctumView, TrackedItem } from '@shared/sanctum'
import { formatClock, formatDateTime, formatDuration } from './format'
import { useNow } from './hooks'

const number = (value: number, digits = 0): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })

function Access({ view, session }: { view: SanctumView; session: SessionState }) {
  const [account, setAccount] = useState(view.account)
  const [character, setCharacter] = useState(view.character)
  const [auto, setAuto] = useState(view.autoCharacter)
  const [cookie, setCookie] = useState('')

  // The app may have picked another character itself: show the one in use.
  useEffect(() => {
    if (view.autoCharacter) setCharacter(view.character)
  }, [view.autoCharacter, view.character])

  // Without automatic choice, the log's last level-up is a good first guess for the name.
  useEffect(() => {
    if (!auto && !character && session.character) setCharacter(session.character.name)
  }, [auto, character, session.character])

  const dirty =
    account.trim() !== view.account ||
    auto !== view.autoCharacter ||
    (!auto && character.trim() !== view.character) ||
    cookie.trim() !== ''

  return (
    <form
      className="side-block access"
      onSubmit={(e) => {
        e.preventDefault()
        void window.poe.sanctum
          .saveAccess({ account, character, autoCharacter: auto, cookie: cookie || undefined })
          .then(() => setCookie(''))
      }}
    >
      <h4>Доступ к инвентарю</h4>
      <p className="hint">
        Сайт Path of Exile показывает инвентарь только владельцу аккаунта, поэтому нужна cookie сессии. Она хранится
        зашифрованной средствами Windows и отправляется только на pathofexile.com.
      </p>
      <label className="field">
        <span>Аккаунт</span>
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Имя#1234" spellCheck={false} />
      </label>
      <label className="field">
        <span>Персонаж</span>
        <input
          value={character}
          onChange={(e) => setCharacter(e.target.value)}
          disabled={auto}
          placeholder={auto ? 'определится сам' : ''}
          spellCheck={false}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Выбирать персонажа автоматически — того, кем заходил последним; проверяется в начале каждого забега</span>
      </label>
      <label className="field">
        <span>Cookie POESESSID</span>
        <input
          type="password"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder={view.cookieStored ? 'сохранена — вставь новую, чтобы заменить' : '32 символа из браузера'}
          autoComplete="off"
          spellCheck={false}
        />
        <small>
          В браузере на pathofexile.com: F12 → Application → Cookies → POESESSID. Никому её не передавай: это ключ от
          аккаунта.
        </small>
      </label>
      {!view.canStoreCookie && (
        <p className="note bad">Система не даёт зашифровать cookie, поэтому сохранить её не получится.</p>
      )}
      {view.status && <p className={view.status.ok ? 'note ok' : 'note bad'}>{view.status.message}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={view.busy || (!dirty && !view.cookieStored)}>
          {dirty ? 'Сохранить и проверить' : 'Проверить доступ'}
        </button>
        {view.cookieStored && (
          <button type="button" onClick={() => void window.poe.sanctum.clearCookie()}>
            Удалить cookie
          </button>
        )}
      </div>
    </form>
  )
}

/** Lets the player choose which currency the overlay and the statistics show, and in what order. */
function TrackedEditor({ view }: { view: SanctumView }) {
  const [catalog, setCatalog] = useState<TrackedItem[] | null>(null)
  const [query, setQuery] = useState('')
  const names = view.tracked.map((item) => item.name)
  const save = (next: string[], trackAll = view.trackAll): void => void window.poe.sanctum.setTracked(next, trackAll)

  const move = (index: number, by: number): void => {
    const next = [...names]
    const [name] = next.splice(index, 1)
    next.splice(index + by, 0, name)
    save(next)
  }
  const add = (name: string): void => {
    const clean = name.trim()
    if (clean && !names.includes(clean)) save([...names, clean])
    setQuery('')
  }

  const wanted = query.trim().toLowerCase()
  const matches = wanted
    ? (catalog ?? []).filter((item) => item.name.toLowerCase().includes(wanted) && !names.includes(item.name)).slice(0, 8)
    : []

  return (
    <details
      className="method tracked-editor"
      onToggle={(e) => {
        // The catalog is a few hundred entries from the price source: fetch it only when needed.
        if ((e.currentTarget as HTMLDetailsElement).open && !catalog) void window.poe.sanctum.getCatalog().then(setCatalog)
      }}
    >
      <summary>Отслеживаемая валюта · {names.length}</summary>
      <p className="hint">Эти предметы показываются на полоске и в статистике, в этом порядке.</p>
      <ul className="tracked-list">
        {view.tracked.map((item, index) => (
          <li key={item.name}>
            {item.icon ? <img src={item.icon} alt="" /> : <i className="noicon" />}
            <span>{item.name}</span>
            <button disabled={index === 0} onClick={() => move(index, -1)} title="Выше">
              ↑
            </button>
            <button disabled={index === names.length - 1} onClick={() => move(index, 1)} title="Ниже">
              ↓
            </button>
            <button onClick={() => save(names.filter((name) => name !== item.name))} title="Убрать">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault()
          // Enter takes the first suggestion; a name the price source does not know is accepted as typed.
          add(matches[0]?.name ?? query)
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={catalog ? 'Найти: Volatile Vaal Orb…' : 'Загружаю список…'}
          spellCheck={false}
        />
        <button type="submit" disabled={!query.trim()}>
          Добавить
        </button>
      </form>
      {matches.length > 0 && (
        <ul className="tracked-suggest">
          {matches.map((item) => (
            <li key={item.name}>
              <button type="button" onClick={() => add(item.name)}>
                {item.icon && <img src={item.icon} alt="" />}
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <input type="checkbox" checked={view.trackAll} onChange={(e) => save(names, e.target.checked)} />
        <span>Показывать и всю остальную валюту, которая выпала</span>
      </label>
    </details>
  )
}

export function LootTable({ loot }: { loot: LootValue }) {
  if (!loot.lines.length && !loot.gold) return <p className="empty">Ничего не прибавилось.</p>
  return (
    <>
      <p className="loot-total">
        <strong>{number(loot.chaos, 1)}</strong> хаосов
        {loot.divine != null && (
          <>
            {' '}
            · <strong>{number(loot.divine, 2)}</strong> дивайнов
          </>
        )}
        {loot.gold > 0 && <> · золото +{number(loot.gold)}</>}
      </p>
      <table className="items loot">
        <tbody>
          {loot.lines.map((line) => (
            <tr key={line.name}>
              <td>
                {line.icon && <img src={line.icon} alt="" />}
                {line.name}
              </td>
              <td className="num">×{number(line.count)}</td>
              <td className="num muted">{line.chaos != null ? `${number(line.chaos, 1)} c` : 'без цены'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loot.unpriced > 0 && (
        <p className="hint">
          Позиций без цены: {loot.unpriced}. В суммы они не входят: цены есть только у того, что продаётся на бирже
          валюты.
        </p>
      )}
    </>
  )
}

const HOUR = 3_600_000
const perHour = (total: number, ms: number): number | null => (ms > 0 ? total / (ms / HOUR) : null)
const perRun = (total: number, runs: number): number | null => (runs > 0 ? total / runs : null)
const show = (value: number | null, digits = 1): string => (value === null ? '—' : number(value, digits))
const time = (ms: number | null): string => (ms === null ? '—' : formatDuration(ms))

/** "12,5 c · 0,10 div" */
export function lootSummary(loot: LootValue): string {
  const divine = loot.divine != null ? ` · ${number(loot.divine, 2)} div` : ''
  return `${number(loot.chaos, 1)} c${divine}`
}

/** The tracked currency, then (when everything is tracked) whatever else dropped, most common first. */
function trackedTiles(view: SanctumView, totals: SanctumTotals): (TrackedItem & { count: number })[] {
  const tiles = view.tracked.map((item) => ({ ...item, count: totals.currency[item.name] ?? 0 }))
  if (view.trackAll) {
    const rest = Object.entries(totals.currency)
      .filter(([name]) => !view.tracked.some((item) => item.name === name))
      .sort(([, a], [, b]) => b - a)
    for (const [name, count] of rest) tiles.push({ name, icon: iconFromRuns(view, name), count })
  }
  return tiles
}

function iconFromRuns(view: SanctumView, name: string): string | null {
  for (const run of view.runs) {
    const line = run.loot.lines.find((entry) => entry.name === name)
    if (line?.icon) return line.icon
  }
  return null
}

function Tile({ label, value, note, icon }: { label: string; value: string; note?: string; icon?: string | null }) {
  return (
    <div className="stat-tile">
      <dt>
        {icon && <img src={icon} alt="" />}
        {label}
      </dt>
      <dd>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  )
}

function Stats({ view }: { view: SanctumView }) {
  const [scope, setScope] = useState<'session' | 'allTime'>('session')
  const now = useNow(5000)
  const totals: SanctumTotals = view.stats[scope]
  const sessionMs = now - view.sessionStartedAt
  const byFloor = totals.avgFloorMsByFloor.map((ms, i) => `${i + 1}: ${time(ms)}`).join(' · ')

  return (
    <section>
      <div className="list-head">
        <nav className="acts">
          <button className={scope === 'session' ? 'active' : ''} onClick={() => setScope('session')}>
            Сессия
          </button>
          <button className={scope === 'allTime' ? 'active' : ''} onClick={() => setScope('allTime')}>
            Всё время
          </button>
        </nav>
        <button onClick={() => void window.poe.sanctum.newSession()} title="Обнулить статистику сессии">
          Новая сессия
        </button>
      </div>
      <dl className="stat-grid">
        <Tile label="Забегов" value={String(totals.runs)} note={`пройдено ${totals.completed} · провалено ${totals.failed}`} />
        <Tile label="Среднее время забега" value={time(totals.avgRunMs)} note="по пройденным" />
        <Tile label="Среднее время этажа" value={time(totals.avgFloorMs)} note={byFloor} />
        <Tile
          label="Лут за забег"
          value={`${show(perRun(totals.chaos, totals.runs))} c`}
          note={totals.divine != null ? `${show(perRun(totals.divine, totals.runs), 2)} div` : undefined}
        />
        <Tile
          label="Лут в час в Sanctum"
          value={`${show(perHour(totals.chaos, totals.sanctumMs))} c`}
          note={totals.divine != null ? `${show(perHour(totals.divine, totals.sanctumMs), 2)} div` : undefined}
        />
        {scope === 'session' && (
          <Tile
            label="Лут в час сессии"
            value={`${show(perHour(totals.chaos, sessionMs))} c`}
            note={totals.divine != null ? `${show(perHour(totals.divine, sessionMs), 2)} div` : undefined}
          />
        )}
        {trackedTiles(view, totals).map((item) => (
          <Tile
            key={item.name}
            icon={item.icon}
            label={item.name}
            value={number(item.count)}
            note={`${show(perRun(item.count, totals.runs), 2)} за забег · ${show(perHour(item.count, totals.sanctumMs), 2)} в час`}
          />
        ))}
        <Tile label="Золото" value={number(totals.gold)} note={`в Sanctum: ${time(totals.sanctumMs)}`} />
      </dl>
    </section>
  )
}

function ActiveRun({ view }: { view: SanctumView }) {
  const now = useNow()
  const active = view.active
  if (!active) return null
  const live = active.inSanctum ? Math.max(0, now - active.since) : 0
  return (
    <section className="side-block active-run">
      <div className="list-head">
        <h4>
          Идёт забег · {active.floor ? `этаж ${active.floor}` : active.inSanctum ? 'между этажами' : 'пауза вне Sanctum'} ·{' '}
          {formatDuration(active.run.durationMs + live)}
        </h4>
        <button onClick={() => void window.poe.sanctum.failActive()} title="Resolve закончился — в логе этого не видно">
          Отметить провал
        </button>
      </div>
      <FloorTimes run={active.run} liveFloor={active.floor} live={live} />
      <p>Лут: {lootSummary(active.run.loot)}{active.run.loot.gold > 0 && ` · золото +${number(active.run.loot.gold)}`}</p>
      {active.run.lootNote && <p className="note bad">{active.run.lootNote}</p>}
    </section>
  )
}

function FloorTimes({ run, liveFloor, live }: { run: RunView; liveFloor?: number | null; live?: number }) {
  return (
    <ul className="floor-times">
      {run.floors.map((floor) => (
        <li key={floor.floor} className={floor.done ? 'done' : ''}>
          <span className="muted">Этаж {floor.floor}</span>
          <strong>{formatDuration(floor.ms + (liveFloor === floor.floor ? (live ?? 0) : 0))}</strong>
          <small className="muted">
            {floor.rooms}/8{floor.loot ? ` · ${number(floor.loot.chaos, 1)} c` : ''}
          </small>
        </li>
      ))}
    </ul>
  )
}

function Run({ run }: { run: RunView }) {
  const won = run.outcome === 'completed'
  return (
    <details className="method run">
      <summary>
        <span className="muted">{formatDateTime(run.startedAt)}</span>
        <span className={won ? 'ok' : 'bad'}>{won ? 'пройден' : 'провален'}</span>
        <span>{formatDuration(run.durationMs)}</span>
        <span className="muted">{run.floors.map((floor) => formatDuration(floor.ms)).join(' / ')}</span>
        <strong>{lootSummary(run.loot)}</strong>
      </summary>
      <FloorTimes run={run} />
      {run.lootNote && <p className="note bad">{run.lootNote}</p>}
      {run.floors
        .filter((floor) => floor.loot && (floor.loot.lines.length > 0 || floor.loot.gold > 0))
        .map((floor) => (
          <div key={floor.floor} className="floor-loot">
            <h5>Этаж {floor.floor}</h5>
            <LootTable loot={floor.loot!} />
          </div>
        ))}
      <div className="actions">
        <button onClick={() => void window.poe.sanctum.setOutcome(run.id, won ? 'failed' : 'completed')}>
          {won ? 'На самом деле провален' : 'На самом деле пройден'}
        </button>
      </div>
    </details>
  )
}

export function SanctumTab({ view, session }: { view: SanctumView; session: SessionState }) {
  return (
    <div className="plan">
      <aside className="plan-side">
        <Access view={view} session={session} />
        <TrackedEditor view={view} />
        <details className="method">
          <summary>Ручная проверка подсчёта</summary>
          <p className="hint">
            Сделай снимок, подбери что-нибудь, смени зону (сайт обновляет персонажа при смене зоны) и сделай второй.
          </p>
          <div className="actions">
            <button disabled={view.busy || !view.cookieStored} onClick={() => void window.poe.sanctum.snapshot()}>
              {view.busy ? 'Запрашиваю…' : 'Снимок инвентаря'}
            </button>
            <button
              disabled={view.busy || !view.cookieStored}
              onClick={() => void window.poe.sanctum.dumpSiteAnswer()}
              title="Сохранить в файл всё, что сайт сообщает о персонаже"
            >
              Ответ сайта в файл
            </button>
          </div>
          {view.snapshots.length > 0 && (
            <p className="muted">
              Снимков: {view.snapshots.length}, последний в {formatClock(view.snapshots[view.snapshots.length - 1].takenAt)}.
            </p>
          )}
          {view.lastLoot && <LootTable loot={view.lastLoot} />}
        </details>
        <p className="hint">
          {view.prices
            ? `Цены: poe.ninja, лига ${view.prices.league}, на ${formatClock(view.prices.fetchedAt)}` +
              (view.prices.divineChaos != null ? ` · Divine Orb = ${number(view.prices.divineChaos, 1)} c` : '')
            : 'Цены загрузятся с poe.ninja при первом подсчёте лута.'}
        </p>
        {view.pricesError && <p className="note bad">Цены не обновились: {view.pricesError}</p>}
      </aside>

      <div className="plan-main pob-view">
        <Stats view={view} />
        <ActiveRun view={view} />
        <section>
          <h4>Забеги</h4>
          {view.runs.length ? (
            view.runs.map((run) => <Run key={run.id} run={run} />)
          ) : (
            <p className="empty">
              Пока ни одного. Забег начнётся сам, когда ты войдёшь на первый этаж Sanctum при запущенном приложении.
            </p>
          )}
          <p className="hint">
            Пройденным считается забег, в котором убита Lycia. Потерю Resolve в логе не видно, поэтому провал
            засчитывается, когда начинается следующий забег, или по кнопке «Отметить провал».
          </p>
        </section>
      </div>
    </div>
  )
}
