import type { GearSlotCheck, GemState, PlanView } from '@shared/plan'
import { formatDateTime } from './format'

const STATE_MARK: Record<GemState['state'], string> = { linked: '✓', unlinked: '⛓', loose: '◌', missing: '✗', later: '…' }
const STATE_LABEL: Record<GemState['state'], string> = {
  linked: 'на месте',
  unlinked: 'не связан',
  loose: 'не вставлен',
  missing: 'нет',
  later: 'позже'
}

/** What is wrong with the character's gems, as a short list: for the overlay. */
export function GemLine({ plan, limit = 3 }: { plan: PlanView; limit?: number }) {
  const check = plan.gemCheck
  if (!check || !check.problems.length) return null
  return (
    <section className="overlay-tree overlay-gems">
      <h5>Гемы · {check.setTitle}</h5>
      <ul>
        {check.problems.slice(0, limit).map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
        {check.problems.length > limit && <li className="muted">…и ещё {check.problems.length - limit}</li>}
      </ul>
    </section>
  )
}

const SLOT_MARK: Record<GearSlotCheck['state'], string> = { match: '✓', partial: '≈', different: '✗', empty: '○' }
const SLOT_LABEL: Record<GearSlotCheck['state'], string> = {
  match: 'как в билде',
  partial: 'частично',
  different: 'другая вещь',
  empty: 'пусто'
}
const MOD_MARK: Record<GearSlotCheck['mods'][number]['state'], string> = { have: '✓', lower: '↓', absent: '✗' }

/** The build's items against what the character wears, slot by slot. */
export function GearCheckView({ plan }: { plan: PlanView }) {
  const check = plan.gearCheck
  const reading = plan.treeReading
  if (!plan.pob?.itemSets.length) return null
  return (
    <section className="gem-check">
      <h4>Что сейчас надето</h4>
      <div className="tree-head">
        {check && (
          <span>
            сверяю с набором <b>{check.setTitle}</b> · как в билде {check.slots.filter((slot) => slot.state === 'match').length} из{' '}
            {check.slots.length}
          </span>
        )}
        <button disabled={reading.busy} onClick={() => void window.poe.plan.refreshTree()}>
          {reading.busy ? 'Читаю персонажа…' : 'Обновить с сайта'}
        </button>
      </div>
      <p className={`hint${reading.error ? ' bad' : ''}`}>
        {reading.error
          ? `Не удалось прочитать персонажа: ${reading.error}${check ? ` Показано то, что прочитано ${formatDateTime(check.readAt)}.` : ''}`
          : check
            ? `Вещи персонажа ${check.character} прочитаны ${formatDateTime(check.readAt)}. Уник сверяется по названию, редкая вещь — по модам: есть ли такой же мод и не ниже ли он, чем в билде.`
            : 'Вещи персонажа ещё не прочитаны.'}
      </p>
      {check && (
        <div className="gem-check-groups gear">
          {check.slots.map((slot) => (
            <details key={slot.slot} className={`gem-check-group gear-slot g-${slot.state}`}>
              <summary>
                <i>{SLOT_MARK[slot.state]}</i> <b>{slot.slot}</b>
                <span className="muted"> · {SLOT_LABEL[slot.state]}</span>
              </summary>
              <p>
                <span className="muted">В билде: </span>
                <span className={slot.wanted.unique ? 'unique' : ''}>{slot.wanted.name}</span>
                {slot.wanted.base && <span className="muted"> · {slot.wanted.base}</span>}
              </p>
              <p>
                <span className="muted">Надето: </span>
                {slot.worn ? (
                  <>
                    <span className={slot.worn.unique ? 'unique' : ''}>{slot.worn.name}</span>
                    {slot.worn.base !== slot.worn.name && <span className="muted"> · {slot.worn.base}</span>}
                  </>
                ) : (
                  'ничего'
                )}
              </p>
              {slot.notes.map((note) => (
                <p key={note} className="bad">
                  {note}
                </p>
              ))}
              {slot.mods.length > 0 && (
                <ul>
                  {slot.mods.map((mod, i) => (
                    <li key={i} className={`gear-mod m-${mod.state}`}>
                      <i>{MOD_MARK[mod.state]}</i> {mod.text}
                      {mod.worn && mod.state === 'lower' && <small className="muted"> — у тебя: {mod.worn}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

/** The build's gems against what the character has socketed, group by group. */
export function GemCheckView({ plan }: { plan: PlanView }) {
  const check = plan.gemCheck
  const reading = plan.treeReading
  if (!plan.pob) return null
  return (
    <section className="gem-check">
      <h4>Что сейчас на персонаже</h4>
      <div className="tree-head">
        {check && (
          <span>
            сверяю с набором <b>{check.setTitle}</b>
          </span>
        )}
        <button disabled={reading.busy} onClick={() => void window.poe.plan.refreshTree()}>
          {reading.busy ? 'Читаю персонажа…' : 'Обновить с сайта'}
        </button>
      </div>
      <p className={`hint${reading.error ? ' bad' : ''}`}>
        {reading.error
          ? `Не удалось прочитать персонажа: ${reading.error}${check ? ` Показано то, что прочитано ${formatDateTime(check.readAt)}.` : ''}`
          : check
            ? `Гемы персонажа ${check.character} прочитаны ${formatDateTime(check.readAt)}. Сайт видит изменения только после смены зоны: вставил гем в городе — проверка обновится, когда выйдешь из него.`
            : 'Гемы персонажа ещё не прочитаны.'}
      </p>
      {check && (
        <>
          {check.problems.length === 0 ? (
            <p className="note ok">Все гемы, которые уже можно было взять, вставлены и связаны как в билде.</p>
          ) : (
            <ul className="source-notes">
              {check.problems.map((problem) => (
                <li key={problem} className="tone-bad">
                  {problem}
                </li>
              ))}
            </ul>
          )}
          {check.levelRemarks.length > 0 && (
            <p className="note bad">
              Уровень выше, чем в билде: {check.levelRemarks.join('; ')}. Если билд держит эти гемы низкими нарочно (например,
              под Cast when Damage Taken) — их придётся заменить; если автор просто не выставил уровень — не обращай
              внимания.
            </p>
          )}
          <div className="gem-check-groups">
            {check.groups.map((group, index) => (
              <div key={index} className="gem-check-group">
                <h5>{group.label}</h5>
                <ul>
                  {group.gems.map((gem, i) => (
                    <li key={i} className={`gem-state s-${gem.state}`} title={STATE_LABEL[gem.state]}>
                      <i>{STATE_MARK[gem.state]}</i> {gem.name}
                      {gem.level !== null && (
                        <small className={gem.overLevelled ? 'bad' : 'muted'}>
                          {' '}
                          · ур. {gem.level}, в билде {gem.wanted}
                          {gem.overLevelled && ' — выше, чем в билде'}
                        </small>
                      )}
                      {gem.hint && <small className="muted"> — {gem.hint}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="hint">
            Сверяется тот из отмеченных наборов, на который гемы персонажа похожи больше всего. Гем считается обязательным,
            когда маршрут уже прошёл шаг, где он берётся. Связи требуются для скилла и первых саппортов: до 25 уровня —
            трёх гемов, дальше — четырёх. Уровень гема отмечается, только когда он выше, чем в билде, а билд нигде
            не качает этот гем до 20.
          </p>
        </>
      )}
    </section>
  )
}
