import { useState } from 'react'
import { BANDITS, type PlanView } from '@shared/plan'
import { BuildList, BuildSummary } from './BuildList'
import { BANDIT_LABELS } from './labels'
import { PobImport } from './PobImport'
import { GemsView, ItemsView, NotesView, TreeView } from './PobViews'
import { Questionnaire } from './Questionnaire'
import { RouteView } from './RouteView'

type View = 'route' | 'gems' | 'tree' | 'items' | 'notes'

const VIEW_LABELS: Record<View, string> = {
  route: 'Маршрут',
  gems: 'Гемы',
  tree: 'Дерево',
  items: 'Предметы',
  notes: 'Заметки'
}

function PobBlock({ plan }: { plan: PlanView }) {
  const [replacing, setReplacing] = useState(false)
  const { pob, build } = plan

  if (!pob || replacing) {
    return (
      <section className="side-block">
        <h4>Path of Building</h4>
        {!pob && <p className="hint">Импортируй билд, чтобы в маршруте появились гемы, а рядом — дерево и предметы.</p>}
        <PobImport onImported={() => setReplacing(false)} onCancel={pob ? () => setReplacing(false) : undefined} />
      </section>
    )
  }

  return (
    <section className="side-block">
      <h4>Path of Building</h4>
      <p>
        {pob.className}
        {pob.ascendancy ? ` · ${pob.ascendancy}` : ''}
        {pob.level ? ` · ур. ${pob.level}` : ''}
      </p>
      <p className="muted">
        Наборов скиллов: {pob.skillSets.length} · деревьев: {pob.treeSpecs.length} · наборов предметов:{' '}
        {pob.itemSets.length}
      </p>
      {build && build.class !== pob.className && (
        <p className="note bad">
          Класс в импортированном билде ({pob.className}) не совпадает с выбранной карточкой ({build.class}). План
          строится по импортированному билду.
        </p>
      )}
      <div className="actions">
        <button onClick={() => setReplacing(true)}>Заменить</button>
        <button onClick={() => void window.poe.plan.clearPob()}>Убрать</button>
      </div>
    </section>
  )
}

export function PlanTab({ plan }: { plan: PlanView }) {
  const [editingAnswers, setEditingAnswers] = useState(false)
  const [choosingBuild, setChoosingBuild] = useState(false)
  const [view, setView] = useState<View>('route')

  if (!plan.answers || editingAnswers) {
    return (
      <Questionnaire
        initial={plan.answers}
        onDone={() => setEditingAnswers(false)}
        onCancel={plan.answers ? () => setEditingAnswers(false) : undefined}
      />
    )
  }

  const hasPlan = plan.build !== null || plan.pob !== null
  if (!hasPlan || choosingBuild) {
    return (
      <>
        {hasPlan && (
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
  const views: View[] = plan.pob ? ['route', 'gems', 'tree', 'items', 'notes'] : ['route']
  const shown = views.includes(view) ? view : 'route'

  return (
    <div className="plan">
      <aside className="plan-side">
        {plan.build && (
          <article className="build-card">
            <BuildSummary build={plan.build} />
          </article>
        )}
        <div className="actions">
          <button onClick={() => setChoosingBuild(true)}>{plan.build ? 'Другой билд' : 'Выбрать из списка'}</button>
        </div>

        <PobBlock plan={plan} />

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
          <small>{plan.pob ? 'Взято из импортированного билда.' : 'Что выбирать — написано в гайде билда.'}</small>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={plan.options.leagueStart}
            onChange={(e) => void window.poe.plan.setOptions({ leagueStart: e.target.checked })}
          />
          <span>Первый персонаж лиги: собирать вейпоинты, триалы и побочные квесты</span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={plan.options.library}
            onChange={(e) => void window.poe.plan.setOptions({ library: e.target.checked })}
          />
          <span>Зайти в библиотеку в 3 акте: Siosa продаёт гемы, которые твоему классу не выдают</span>
        </label>

        <p className="hint">
          Шаг {Math.min(plan.position + 1, total)} из {total}. Позиция двигается сама, когда ты входишь в следующую зону;
          кликни по шагу, чтобы поправить вручную.
        </p>
      </aside>

      <div className="plan-main">
        {views.length > 1 && (
          <nav className="acts">
            {views.map((v) => (
              <button key={v} className={v === shown ? 'active' : ''} onClick={() => setView(v)}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </nav>
        )}
        {shown === 'route' && <RouteView plan={plan} />}
        {shown === 'gems' && <GemsView plan={plan} />}
        {shown === 'tree' && <TreeView plan={plan} />}
        {shown === 'items' && <ItemsView plan={plan} />}
        {shown === 'notes' && <NotesView plan={plan} />}
      </div>
    </div>
  )
}
