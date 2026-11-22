import { useState } from 'react'
import { BANDITS, type PlanView } from '@shared/plan'
import { BuildList, BuildSummary } from './BuildList'
import { BANDIT_LABELS } from './labels'
import { Questionnaire } from './Questionnaire'
import { RouteView } from './RouteView'

export function PlanTab({ plan }: { plan: PlanView }) {
  const [editingAnswers, setEditingAnswers] = useState(false)
  const [choosingBuild, setChoosingBuild] = useState(false)

  if (!plan.answers || editingAnswers) {
    return (
      <Questionnaire
        initial={plan.answers}
        onDone={() => setEditingAnswers(false)}
        onCancel={plan.answers ? () => setEditingAnswers(false) : undefined}
      />
    )
  }

  if (!plan.build || choosingBuild) {
    return (
      <>
        {plan.build && (
          <div className="actions">
            <button onClick={() => setChoosingBuild(false)}>← Назад к плану</button>
          </div>
        )}
        <BuildList
          plan={plan}
          onEditAnswers={() => setEditingAnswers(true)}
          onChosen={() => setChoosingBuild(false)}
        />
      </>
    )
  }

  const total = plan.steps.length
  return (
    <div className="plan">
      <aside className="plan-side">
        <article className="build-card">
          <BuildSummary build={plan.build} />
          <div className="actions">
            <button onClick={() => setChoosingBuild(true)}>Другой билд</button>
          </div>
        </article>

        <label className="field">
          <span>Бандиты (Акт 2)</span>
          <select
            value={plan.options.bandit}
            onChange={(e) => void window.poe.plan.setOptions({ bandit: e.target.value as (typeof BANDITS)[number] })}
          >
            {BANDITS.map((bandit) => (
              <option key={bandit} value={bandit}>
                {BANDIT_LABELS[bandit]}
              </option>
            ))}
          </select>
          <small>Что выбирать — написано в гайде билда.</small>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={plan.options.leagueStart}
            onChange={(e) => void window.poe.plan.setOptions({ leagueStart: e.target.checked })}
          />
          <span>Первый персонаж лиги: собирать вейпоинты, триалы и побочные квесты</span>
        </label>

        <p className="hint">
          Маршрут актов пока общий для всех билдов. Гемы, дерево и шмот под выбранный билд — следующий шаг.
        </p>
        <p className="hint">
          Шаг {Math.min(plan.position + 1, total)} из {total}. Позиция двигается сама, когда ты входишь в следующую зону;
          кликни по шагу, чтобы поправить вручную.
        </p>
      </aside>
      <RouteView plan={plan} />
    </div>
  )
}
