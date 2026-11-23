import { currentGroup } from '@core/route/groups'
import type { SessionState } from '@shared/api'
import type { PlanView } from '@shared/plan'
import type { SanctumView } from '@shared/sanctum'
import { Feed } from './Feed'
import { formatDuration } from './format'
import { useNow, usePlan, useSanctum, useSession } from './hooks'
import { lootSummary } from './SanctumTab'
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

function SanctumRun({ active, now }: { active: NonNullable<SanctumView['active']>; now: number }) {
  const live = active.inSanctum ? Math.max(0, now - active.since) : 0
  const floor = active.run.floors.find((entry) => entry.floor === active.floor)
  return (
    <section className="overlay-sanctum">
      <div className="overlay-nav">
        <span>
          Sanctum · {floor ? `этаж ${floor.floor} · комната ${floor.rooms}/8` : active.inSanctum ? 'между этажами' : 'пауза'}
        </span>
        <button onClick={() => void window.poe.sanctum.failActive()} title="Resolve закончился">
          Провал
        </button>
      </div>
      <dl className="overlay-stats">
        <div>
          <dt>Этаж</dt>
          <dd>{floor ? formatDuration(floor.ms + live) : '—'}</dd>
        </div>
        <div>
          <dt>Забег</dt>
          <dd>{formatDuration(active.run.durationMs + live)}</dd>
        </div>
        <div>
          <dt>Лут</dt>
          <dd>{lootSummary(active.run.loot)}</dd>
        </div>
      </dl>
      <ul className="floor-times">
        {active.run.floors.map((entry) => (
          <li key={entry.floor} className={entry.done ? 'done' : ''}>
            <span className="muted">{entry.floor}</span>
            <strong>{formatDuration(entry.ms + (entry.floor === active.floor ? live : 0))}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Overlay() {
  const session = useSession()
  const plan = usePlan()
  const sanctum = useSanctum()
  const now = useNow()
  if (!session || !plan || !sanctum) return null

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

      {sanctum.active ? (
        <SanctumRun active={sanctum.active} now={now} />
      ) : plan.steps.length > 0 ? (
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
