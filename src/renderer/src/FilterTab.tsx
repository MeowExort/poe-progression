import { useEffect, useState } from 'react'
import type { FilterView } from '@shared/filter'
import { formatDateTime } from './format'

function Summary({ view }: { view: FilterView }) {
  const { summary } = view
  const rows: [string, string][] = [
    ['Оружие билда', summary.weaponClasses.join(', ') || 'не знаю — в билде нет редкого оружия; подсвечиваю любое'],
    ['Броня билда', summary.defences.join(', ') || 'не знаю — подсвечиваю любую'],
    ['Связки в цветах билда', summary.links.join(', ') || 'нет — в билде нет групп с саппортами'],
    ['Гемы билда', String(summary.gems)],
    ['Базы уников билда', String(summary.uniqueBases)],
    ['Подсветка по ценам', summary.priced ? `${summary.priced} предметов` : 'нет: цены выключены или ещё не загружены']
  ]
  return (
    <dl className="filter-summary">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The loot filter the app writes for the build: switch, where the file is, and what each stage shows. */
export function FilterTab({ view }: { view: FilterView }) {
  const [dir, setDir] = useState(view.dir)
  // The folder may change from outside this field: "default folder", or another window.
  useEffect(() => setDir(view.dir), [view.dir])
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void window.poe.copyText(view.command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="plan">
      <aside className="plan-side">
        <section className="field">
          <span>Лут-фильтр под билд</span>
          <label className="check">
            <input
              type="checkbox"
              checked={view.enabled}
              onChange={(e) => void window.poe.filter.setOptions({ enabled: e.target.checked })}
            />
            <span>Записывать файл фильтра и обновлять его, когда меняется билд</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={view.usePrices}
              onChange={(e) => void window.poe.filter.setOptions({ usePrices: e.target.checked })}
            />
            <span>Подсвечивать валюту, фрагменты и карты предсказаний по ценам poe.ninja</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={view.useBuildNames}
              onChange={(e) => void window.poe.filter.setOptions({ useBuildNames: e.target.checked })}
            />
            <span>Подсвечивать гемы билда и базы его уников по названиям</span>
          </label>
          <small>
            Игра отвергает фильтр целиком, если в нём есть название, которого она не знает. Если при загрузке она ругается
            на строку с <code>BaseType</code> — посмотри, под каким блоком эта строка, и выключи соответствующую галочку:
            цены или названия из билда.
          </small>
        </section>

        <label className="field">
          <span>Папка с фильтрами игры</span>
          <div className="field-row">
            <input value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            <button onClick={() => void window.poe.filter.setOptions({ dir })}>Сохранить</button>
          </div>
          <small className={view.dirFound ? 'ok' : 'bad'}>
            {view.dirFound ? 'Папка найдена.' : 'Такой папки нет: запусти игру хотя бы раз или укажи папку вручную.'}
          </small>
          <div className="actions">
            <button onClick={() => void window.poe.filter.openFolder()} disabled={!view.dirFound}>
              Открыть папку
            </button>
            <button
              onClick={() => void window.poe.filter.setOptions({ dir: null })}
            >
              Папка по умолчанию
            </button>
          </div>
        </label>

        <section className="field">
          <span>Как включить в игре</span>
          <small>
            Один раз: Options → Game → Item Filter → <b>{view.fileName.replace(/\.filter$/, '')}</b>. После того как
            приложение обновило файл, набери в чате команду — игра перечитает фильтр:
          </small>
          <div className="field-row">
            <input readOnly value={view.command} />
            <button onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</button>
          </div>
          <small className={view.error ? 'bad' : view.writtenAt ? 'ok' : ''}>
            {view.error ??
              (view.writtenAt
                ? `Файл ${view.fileName} последний раз менялся ${formatDateTime(view.writtenAt)}.`
                : view.enabled
                  ? 'Файл ещё не записан.'
                  : 'Файл не записывается, пока фильтр выключен.')}
          </small>
        </section>
      </aside>

      <div className="plan-main">
        <p className="hint">
          Стадии переключаются сами по уровню зоны, в которой падает вещь, — менять фильтр по ходу игры не нужно. Скрываются
          только белые, синие и жёлтые вещи и фласки; валюта, карты, фрагменты, карты предсказаний, уники, гемы и
          самоцветы видны всегда. Связки из пяти и шести, шесть гнёзд, вещи с влиянием и fractured-вещи показываются на
          любой стадии.
        </p>
        <p className="hint">
          Тиры модов фильтр не видит: редкие вещи падают неопознанными. Вместо этого он отсекает базы, на которых хорошие
          тиры не выпадают.
        </p>
        <h4>На чём построен</h4>
        <Summary view={view} />
        <h4>Стадии</h4>
        <ul className="filter-stages">
          {view.stages.map((stage) => (
            <li key={stage.id}>
              <h5>
                {stage.title}
                <span className="muted"> · уровень зоны {stage.from}{stage.to === null ? '+' : `–${stage.to}`}</span>
              </h5>
              <div className="filter-cols">
                <div>
                  <b className="ok">Видно</b>
                  <ul>
                    {stage.shows.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <b className="bad">Скрыто</b>
                  <ul>
                    {stage.hides.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
