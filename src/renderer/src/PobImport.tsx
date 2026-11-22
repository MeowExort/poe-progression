import { useState } from 'react'

/** A box to paste a Path of Building export code into. */
export function PobImport({ onImported, onCancel }: { onImported?: () => void; onCancel?: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    const problem = await window.poe.plan.importPob(code)
    setBusy(false)
    setError(problem)
    if (!problem) {
      setCode('')
      onImported?.()
    }
  }

  return (
    <div className="pob-import">
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Вставь сюда код Path of Building"
        spellCheck={false}
        rows={4}
      />
      {error && <p className="note bad">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy || !code.trim()} onClick={() => void submit()}>
          Импортировать
        </button>
        {onCancel && <button onClick={onCancel}>Отмена</button>}
      </div>
      <small>
        Код берётся из гайда (кнопка экспорта PoB) или из самой программы Path of Building: Import/Export Build →
        Generate → Copy. Ссылки не подходят — нужен именно код.
      </small>
    </div>
  )
}
