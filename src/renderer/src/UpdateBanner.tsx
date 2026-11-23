import { useState } from 'react'
import type { UpdateState } from '@shared/update'

function Notes({ lines }: { lines: string[] }) {
  if (!lines.length) return <p className="muted">Список изменений для этой версии не найден.</p>
  return (
    <ul className="update-notes">
      {lines.map((line, i) =>
        line.startsWith('•') ? <li key={i}>{line.slice(1).trim()}</li> : <li key={i} className="heading">{line}</li>
      )}
    </ul>
  )
}

/**
 * Shown at the top of the main window: a downloaded update waiting to be installed, or — on
 * the first launch after an update — what changed. Nothing is offered while a Sanctum run
 * is on: a restart then would interrupt it.
 */
export function UpdateBanner({ update, inRun }: { update: UpdateState; inRun: boolean }) {
  const [later, setLater] = useState<string | null>(null)

  if (update.whatsNew) {
    return (
      <section className="update-banner">
        <div className="update-head">
          <strong>Приложение обновлено до версии {update.whatsNew.version}</strong>
          <button onClick={() => void window.poe.update.dismissWhatsNew()}>Понятно</button>
        </div>
        <Notes lines={update.whatsNew.notes} />
      </section>
    )
  }

  if (update.status !== 'ready' || !update.version || inRun || later === update.version) return null
  return (
    <section className="update-banner">
      <div className="update-head">
        <strong>Готово обновление до версии {update.version}</strong>
        <span className="muted">сейчас {update.current}</span>
        <button className="primary" onClick={() => void window.poe.update.install()}>
          Обновить и перезапустить
        </button>
        <button onClick={() => setLater(update.version)} title="Обновление установится само при следующем закрытии приложения">
          Позже
        </button>
      </div>
      <Notes lines={update.notes} />
    </section>
  )
}

/** One line for the settings: the running version and what the updater is doing. */
export function UpdateStatus({ update }: { update: UpdateState }) {
  const text: Record<UpdateState['status'], string> = {
    disabled: 'Запущено из исходников — обновляется через git, автообновление работает только в установленной версии.',
    idle: 'Установлена последняя версия.',
    checking: 'Проверяю обновления…',
    downloading: `Скачиваю версию ${update.version ?? ''}${update.progress != null ? ` — ${update.progress}%` : ''}…`,
    ready: `Версия ${update.version ?? ''} скачана и установится при перезапуске.`,
    error: update.error ?? 'Не удалось проверить обновления.'
  }
  return (
    <section className="field">
      <span>Версия {update.current}</span>
      <small className={update.status === 'error' ? 'bad' : ''}>{text[update.status]}</small>
      {update.status !== 'disabled' && (
        <div className="actions">
          <button
            type="button"
            disabled={update.status === 'checking' || update.status === 'downloading'}
            onClick={() => void window.poe.update.check()}
          >
            Проверить обновления
          </button>
          {update.status === 'ready' && (
            <button type="button" className="primary" onClick={() => void window.poe.update.install()}>
              Обновить и перезапустить
            </button>
          )}
        </div>
      )}
    </section>
  )
}
