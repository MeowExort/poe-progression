import { Feed } from './Feed'
import { formatDuration } from './format'
import { useNow, useSession } from './hooks'

export function Overlay() {
  const session = useSession()
  const now = useNow()
  if (!session) return null

  const { area, character, log } = session
  return (
    <div className="overlay">
      <header className="overlay-head">
        <div className="overlay-area">
          <strong>{area?.name ?? 'Зона неизвестна'}</strong>
          {area?.level != null && <span className="badge">ур. {area.level}</span>}
        </div>
        <span className="overlay-timer">{area ? formatDuration(now - area.enteredAt) : '—'}</span>
      </header>

      <dl className="overlay-stats">
        <div>
          <dt>Персонаж</dt>
          <dd>{character ? `${character.level} ур. · ${character.class}` : '—'}</dd>
        </div>
        <div>
          <dt>Смертей</dt>
          <dd>{session.deaths}</dd>
        </div>
        <div>
          <dt>Сессия</dt>
          <dd>{formatDuration(now - session.startedAt)}</dd>
        </div>
      </dl>

      {!log.found && <p className="warning">Client.txt не найден — укажи путь в настройках.</p>}

      <Feed
        entries={session.feed.filter((entry) => entry.type !== 'dialogue')}
        limit={6}
        empty="Событий пока нет."
      />

      <footer className="overlay-foot">{session.hotkey.accelerator} — скрыть</footer>
    </div>
  )
}
