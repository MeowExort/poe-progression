import { useState } from 'react'
import { Feed } from './Feed'
import { formatDuration } from './format'
import { useNow, usePlan, useSession } from './hooks'
import { PlanTab } from './PlanTab'
import { Settings } from './Settings'

type Tab = 'plan' | 'feed' | 'unknown' | 'settings'

export function Dashboard() {
  const session = useSession()
  const now = useNow()
  const plan = usePlan()
  const [tab, setTab] = useState<Tab>('plan')
  if (!session || !plan) return null

  const { area, character, log } = session
  const tabs: { id: Tab; label: string }[] = [
    { id: 'plan', label: 'План' },
    { id: 'feed', label: 'Лента' },
    { id: 'unknown', label: `Нераспознанное${session.unknown.length ? ` · ${session.unknown.length}` : ''}` },
    { id: 'settings', label: 'Настройки' }
  ]

  return (
    <div className="app">
      <header className="topbar">
        <h1>PoE Progression</h1>
        <span className={`pill ${log.found ? 'ok' : 'bad'}`}>
          {log.found ? 'Лог подключён' : log.path ? 'Client.txt не найден' : 'Путь к логу не задан'}
        </span>
        <button onClick={() => void window.poe.toggleOverlay()}>
          {session.overlayVisible ? 'Скрыть оверлей' : 'Показать оверлей'}
          <kbd>{session.hotkey.accelerator}</kbd>
        </button>
      </header>

      <section className="cards">
        <article className="card">
          <h2>Персонаж</h2>
          {character ? (
            <>
              <p className="value">{character.name}</p>
              <p className="sub">
                {character.level} ур. · {character.class}
              </p>
            </>
          ) : (
            <>
              <p className="value muted">—</p>
              <p className="sub">Определится при первом левел-апе.</p>
            </>
          )}
        </article>

        <article className="card">
          <h2>Зона</h2>
          {area ? (
            <>
              <p className="value">{area.name}</p>
              <p className="sub">
                {area.level != null ? `ур. ${area.level} · ` : ''}
                {formatDuration(now - area.enteredAt)}
                {area.areaId ? ` · ${area.areaId}` : ''}
              </p>
            </>
          ) : (
            <>
              <p className="value muted">—</p>
              <p className="sub">Определится при входе в любую зону.</p>
            </>
          )}
        </article>

        <article className="card">
          <h2>Сессия</h2>
          <p className="value">{formatDuration(now - session.startedAt)}</p>
          <p className="sub">
            Зон: {session.areasEntered} · Смертей: {session.deaths}
            {session.afk ? ' · AFK' : ''}
          </p>
        </article>
      </section>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="panel">
        {tab === 'plan' && <PlanTab plan={plan} />}
        {tab === 'feed' && (
          <Feed entries={session.feed} empty="Событий пока нет. Зайди в игру и перейди в любую зону." />
        )}
        {tab === 'unknown' && (
          <>
            <p className="hint">
              Системные сообщения игры, которые парсер пока не понимает. Чат и шёпоты сюда не попадают.
            </p>
            <Feed entries={session.unknown} empty="Пусто." />
          </>
        )}
        {tab === 'settings' && <Settings session={session} />}
      </main>
    </div>
  )
}
