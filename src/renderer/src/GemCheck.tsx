import type { GemState, PlanView } from '@shared/plan'
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
          ? `Персонаж не прочитан: ${reading.error}`
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
          <div className="gem-check-groups">
            {check.groups.map((group, index) => (
              <div key={index} className="gem-check-group">
                <h5>{group.label}</h5>
                <ul>
                  {group.gems.map((gem, i) => (
                    <li key={i} className={`gem-state s-${gem.state}`} title={STATE_LABEL[gem.state]}>
                      <i>{STATE_MARK[gem.state]}</i> {gem.name}
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
            трёх гемов, дальше — четырёх.
          </p>
        </>
      )}
    </section>
  )
}
