import { useEffect, useState } from 'react'
import type { AppConfig, SessionState } from '@shared/api'

export function Settings({ session }: { session: SessionState }) {
  const [saved, setSaved] = useState<AppConfig | null>(null)
  const [logPath, setLogPath] = useState('')
  const [hotkey, setHotkey] = useState('')

  useEffect(() => {
    void window.poe.getConfig().then((config) => {
      setSaved(config)
      setLogPath(config.logPath)
      setHotkey(config.overlayHotkey)
    })
  }, [])

  if (!saved) return null

  const dirty = logPath.trim() !== saved.logPath || hotkey.trim() !== saved.overlayHotkey

  async function save(patch: Partial<AppConfig>): Promise<void> {
    const next = await window.poe.setConfig(patch)
    setSaved(next)
    setLogPath(next.logPath)
    setHotkey(next.overlayHotkey)
  }

  async function browse(): Promise<void> {
    const picked = await window.poe.pickLogFile()
    if (picked) await save({ logPath: picked })
  }

  async function detect(): Promise<void> {
    const next = await window.poe.detectLog()
    setSaved(next)
    setLogPath(next.logPath)
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault()
        void save({ logPath, overlayHotkey: hotkey })
      }}
    >
      <label className="field">
        <span>Путь к Client.txt</span>
        <div className="field-row">
          <input
            value={logPath}
            onChange={(e) => setLogPath(e.target.value)}
            placeholder="…\steamapps\common\Path of Exile\logs\Client.txt"
            spellCheck={false}
          />
          <button type="button" onClick={() => void browse()}>
            Обзор…
          </button>
          <button type="button" onClick={() => void detect()}>
            Найти автоматически
          </button>
        </div>
        <small className={session.log.found ? 'ok' : 'bad'}>
          {session.log.found ? 'Файл найден, читаю.' : 'Файл не найден по этому пути.'}
        </small>
        <small>
          {saved.logPathAuto
            ? 'Путь выбирается автоматически: берётся Client.txt, в который игра писала последней.'
            : 'Путь задан вручную.'}
        </small>
      </label>

      <label className="field">
        <span>Хоткей оверлея</span>
        <div className="field-row">
          <input value={hotkey} onChange={(e) => setHotkey(e.target.value)} placeholder="Shift+F" spellCheck={false} />
        </div>
        <small className={session.hotkey.registered ? 'ok' : 'bad'}>
          {session.hotkey.registered
            ? `Работает: ${session.hotkey.accelerator}.`
            : 'Не удалось назначить: сочетание занято другой программой или записано неверно.'}
        </small>
        <small>
          Формат — как <code>Shift+F</code>, <code>Ctrl+Alt+P</code>, <code>F6</code>. Пока приложение запущено,
          сочетание перехватывается во всех программах и до них не доходит.
        </small>
      </label>

      <p className="hint">
        Оверлей виден только если игра в режиме <b>Windowed Fullscreen</b> (Options → Graphics → Display Mode).
      </p>

      <div className="actions">
        <button type="submit" className="primary" disabled={!dirty}>
          Сохранить
        </button>
      </div>
    </form>
  )
}
