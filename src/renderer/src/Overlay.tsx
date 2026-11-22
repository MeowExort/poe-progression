import { currentGroup } from '@core/route/groups'
import type { SessionState } from '@shared/api'
import type { PlanView } from '@shared/plan'
import { Feed } from './Feed'
import { formatDuration } from './format'
import { useNow, usePlan, useSession } from './hooks'
import { StepLine } from './StepLine'

function PlanSteps({ plan, session }: { plan: PlanView; session: SessionState }) {
  const { steps, position } = plan
  const group = currentGroup(steps, position)
  const expected = steps[position]
  const actual = session.area
  // The log says we are somewhere the plan does not expect: tell the player how to resync.
  // A trip to town is routine (selling, stash), so it is not worth a warning.
  const offRoute =
    expected && actual?.areaId && actual.areaId !== expected.areaId && !actual.areaId.endsWith('_town')

  return (
    <section className="overlay-plan">
      <div className="overlay-nav">
        <button onClick={() => void window.poe.plan.moveGroup(-1)} title="Назад">
          ‹
        </button>
        <span>
          {expected ? `Акт ${expected.act} · шаг ${position + 1} из ${steps.length}` : 'Кампания пройдена'}
        </span>
        <button onClick={() => void window.poe.plan.moveGroup(1)} title="Вперёд">
          ›
        </button>
      </div>
      {offRoute && (
        <p className="off-route">
          План ждёт тебя в {expected.areaName}. Стрелками ‹ › можно подвинуть шаг.
        </p>
      )}
      <ol className="steps">
        {group.map((step) => (
          <li key={step.index} className="step">
            <StepLine step={step} />
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Overlay() {
  const session = useSession()
  const plan = usePlan()
  const now = useNow()
  if (!session || !plan) return null

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

      {plan.steps.length > 0 ? (
        <PlanSteps plan={plan} session={session} />
      ) : (
        <>
          <p className="off-route">Плана пока нет: пройди опросник и выбери билд в главном окне.</p>
          <Feed
            entries={session.feed.filter((entry) => entry.type !== 'dialogue')}
            limit={5}
            empty="Событий пока нет."
          />
        </>
      )}

      <footer className="overlay-foot">{session.hotkey.accelerator} — скрыть</footer>
    </div>
  )
}
