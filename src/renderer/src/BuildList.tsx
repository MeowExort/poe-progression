import type { BuildCard, PlanView, RankedBuild } from '@shared/plan'
import { STYLE_LABELS, TRAIT_LABELS } from './labels'
import { PobImport } from './PobImport'

function Meter({ value }: { value: number }) {
  return (
    <span className="meter" aria-label={`${value} из 3`}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= value ? 'on' : ''} />
      ))}
    </span>
  )
}

export function BuildSummary({ build }: { build: BuildCard }) {
  return (
    <>
      <h3>{build.name}</h3>
      <p className="build-meta">
        {build.class} · {build.ascendancy} · {build.mainSkill} · {build.styles.map((s) => STYLE_LABELS[s]).join(', ')}
      </p>
      <p>{build.summary}</p>
      <dl className="traits">
        {(Object.keys(TRAIT_LABELS) as (keyof typeof TRAIT_LABELS)[]).map((trait) => (
          <div key={trait}>
            <dt>{TRAIT_LABELS[trait]}</dt>
            <dd>
              <Meter value={build.traits[trait]} />
            </dd>
          </div>
        ))}
      </dl>
      {build.uniquesNote && <p className={build.needsUniques ? 'note bad' : 'note'}>{build.uniquesNote}</p>}
      {build.caveats.map((caveat) => (
        <p key={caveat} className="note bad">
          {caveat}
        </p>
      ))}
      <p className="note">
        <a href={build.guide.url} target="_blank" rel="noreferrer">
          Гайд на {build.guide.site}
          {build.guide.author ? ` (${build.guide.author})` : ''}
        </a>
        {!build.verified && ' · карточка не сверена с гайдом'}
      </p>
    </>
  )
}

function Card({ entry, top, onChoose }: { entry: RankedBuild; top: boolean; onChoose: () => void }) {
  return (
    <article className={`build-card${entry.excluded ? ' excluded' : ''}${top ? ' top' : ''}`}>
      <BuildSummary build={entry.build} />
      {entry.reasons.length > 0 && (
        <ul className="reasons">
          {entry.reasons.map((reason) => (
            <li key={reason.text} className={reason.positive ? 'ok' : 'bad'}>
              {reason.text}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button className={top ? 'primary' : ''} onClick={onChoose}>
          Играть этим билдом
        </button>
      </div>
    </article>
  )
}

export function BuildList({
  plan,
  onEditAnswers,
  onChosen
}: {
  plan: PlanView
  onEditAnswers: () => void
  onChosen: () => void
}) {
  const choose = (id: string): void => {
    if ((plan.build || plan.pob) && plan.build?.id !== id && plan.position > 0) {
      if (!window.confirm('Другой билд — это новый персонаж: прогресс по актам начнётся заново. Продолжить?')) return
    }
    void window.poe.plan.chooseBuild(id).then(onChosen)
  }

  return (
    <div className="build-list">
      <div className="list-head">
        <p className="hint">
          Билды отсортированы по твоим ответам. Карточки собраны по поисковой выдаче и с гайдами не сверены, а шкалы —
          мои прикидки по архетипу, не цифры из гайда. Перед выбором открой гайд.
        </p>
        <button onClick={onEditAnswers}>Изменить ответы</button>
      </div>
      <section className="side-block own-build">
        <h4>У меня уже есть билд</h4>
        <p className="hint">Импортируй его из Path of Building — карточку из списка выбирать не обязательно.</p>
        <PobImport onImported={onChosen} />
      </section>
      <div className="cards-grid">
        {plan.ranked.map((entry, i) => (
          <Card key={entry.build.id} entry={entry} top={i < 3 && !entry.excluded} onChoose={() => choose(entry.build.id)} />
        ))}
      </div>
    </div>
  )
}
