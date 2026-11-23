import type { GemSource, PlanView, PobGem } from '@shared/plan'
import { SourcingView } from './SourcingView'

function sourceText(gem: PobGem, source: GemSource | undefined, setSelected: boolean): { text: string; bad: boolean } {
  if (!gem.id) return { text: 'нет в моих данных об игре — смотри гайд', bad: true }
  if (!setSelected) return { text: 'набор не собирается в актах', bad: false }
  if (!source) return { text: 'в актах его не взять и не купить (или нужна библиотека) — смотри гайд', bad: true }
  if (source.kind === 'start') return { text: 'есть с самого начала', bad: false }
  if (source.kind === 'quest') return { text: `Акт ${source.act} · награда за «${source.quest}» (${source.npc})`, bad: false }
  return { text: `Акт ${source.act} · купить у ${source.npc} после «${source.quest}»`, bad: false }
}

export function GemsView({ plan }: { plan: PlanView }) {
  const pob = plan.pob
  if (!pob) return null
  const selected = new Set(plan.pobSets)

  const toggle = (index: number): void => {
    const next = new Set(selected)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    void window.poe.plan.setPobSets([...next])
  }

  // Gems the class only gets from the "sells everything" vendors are worth pointing out.
  const late = Object.entries(plan.gemSources).filter(([, source]) => source.npc === 'Lilly Roth')
  const lateNames = new Set<string>()
  for (const set of pob.skillSets) {
    for (const group of set.groups) {
      for (const gem of group.gems) {
        if (gem.id && late.some(([id]) => id === gem.id)) lateNames.add(gem.baseName ?? gem.name)
      }
    }
  }

  return (
    <div className="pob-view">
      <p className="hint">
        Отметь наборы, гемы которых нужно собрать по ходу актов: шаги «возьми в награду» и «купи» появятся в маршруте
        у нужных квестов. Финальные наборы можно снять, чтобы не покупать лишнего раньше времени.
      </p>
      {lateNames.size > 0 && (
        <p className="note bad">
          Твоему классу эти гемы не выдают и не продают до 6 акта (Lilly Roth): {[...lateNames].join(', ')}. Если они
          нужны раньше — включи слева заход в библиотеку в 3 акте.
        </p>
      )}
      {plan.libraryOnlyGems.length > 0 && (
        <p className="note bad">
          Эти гемы твоему классу продаёт только Siosa в библиотеке (3 акт): {plan.libraryOnlyGems.join(', ')}. Включи
          слева заход в библиотеку, чтобы шаг появился в маршруте.
        </p>
      )}
      {pob.skillSets.map((set, index) => (
        <section key={index} className="gem-set">
          <label className="check">
            <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
            <span className="gem-set-title">{set.title}</span>
          </label>
          {set.groups.map((group, g) => (
            <div key={g} className="gem-group">
              <h4>
                {group.label}
                {group.slot && <small> · {group.slot}</small>}
              </h4>
              <ul>
                {group.gems.map((gem, i) => {
                  const source = sourceText(gem, gem.id ? plan.gemSources[gem.id] : undefined, selected.has(index))
                  return (
                    <li key={i}>
                      <span className={`gem g-${gem.attribute}`}>{gem.name}</span>
                      {gem.baseName && <small> (в актах берётся {gem.baseName})</small>}
                      <small className={source.bad ? 'bad' : ''}> — {source.text}</small>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

export function TreeView({ plan }: { plan: PlanView }) {
  const specs = plan.pob?.treeSpecs ?? []
  if (!specs.length) return <p className="empty">В билде нет деревьев.</p>
  return (
    <div className="pob-view">
      <p className="hint">
        Деревья из билда по этапам. Ссылка открывает дерево на pathofexile.com; число узлов включает стартовый узел
        класса и асцендант.
      </p>
      <ul className="spec-list">
        {specs.map((spec, i) => (
          <li key={i}>
            <strong>{spec.title}</strong>
            <span className="muted"> · {spec.nodes} узлов</span>
            {spec.url ? (
              <>
                {' · '}
                <a href={spec.url} target="_blank" rel="noreferrer">
                  открыть дерево
                </a>
              </>
            ) : (
              <span className="muted"> · ссылки в билде нет, смотри в Path of Building</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ItemsView({ plan }: { plan: PlanView }) {
  const sets = plan.pob?.itemSets ?? []
  if (!sets.length) return <p className="empty">В билде нет предметов.</p>

  return (
    <div className="pob-view">
      <SourcingView plan={plan} />
      <section>
        <h4>Наборы предметов из билда</h4>
        {sets.map((set, i) => (
          <details key={i} className="method">
            <summary>{set.title}</summary>
            <table className="items">
              <tbody>
                {set.items.map((item, n) => (
                  <tr key={n}>
                    <td className="muted">{item.slot}</td>
                    <td className={item.rarity === 'UNIQUE' || item.rarity === 'RELIC' ? 'unique' : ''}>{item.name}</td>
                    <td className="muted">{item.base ?? ''}</td>
                    <td className="muted">{item.links >= 5 ? `${item.links}L` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>
    </div>
  )
}

export function NotesView({ plan }: { plan: PlanView }) {
  const notes = plan.pob?.notes
  return notes ? <pre className="pob-notes">{notes}</pre> : <p className="empty">Автор билда не оставил заметок.</p>
}
