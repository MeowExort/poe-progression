import type { ItemSourcing, ModSourcing, PlanView, SourceNote, Way } from '@shared/plan'

function Ref({ link }: { link: { label: string; url: string } | undefined }) {
  if (!link) return null
  return (
    <>
      {' '}
      <a href={link.url} target="_blank" rel="noreferrer" className="ref">
        {link.label}
      </a>
    </>
  )
}

function Note({ note }: { note: SourceNote }) {
  return (
    <li className={`tone-${note.tone}`}>
      {note.text}
      <Ref link={note.ref} />
    </li>
  )
}

/** The ways to get one thing, one of which the player may pick as the plan. */
function Ways({ ways, chosen, choiceKey }: { ways: Way[]; chosen: string | null; choiceKey: string }) {
  if (!ways.length) return <p className="muted">Способов для этого в моих данных нет — смотри Craft of Exile или гайд.</p>
  return (
    <ul className="ways">
      {ways.map((way) => {
        const picked = way.id === chosen
        return (
          <li key={way.id} className={`way tone-${way.tone}${picked ? ' picked' : ''}`}>
            <label>
              <input
                type="checkbox"
                checked={picked}
                onChange={() => void window.poe.plan.chooseWay(choiceKey, picked ? null : way.id)}
                title={picked ? 'Снять выбор' : 'Выбрать этот способ'}
              />
              <span className="way-title">{way.title}</span>
            </label>
            <div className="way-details">
              {way.details.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {way.ref && (
                <p>
                  <Ref link={way.ref} />
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ModBlock({ item, mod }: { item: ItemSourcing; mod: ModSourcing }) {
  const chosen = mod.ways.find((way) => way.id === mod.chosen)
  const facts = [
    mod.crafted ? 'крафт' : mod.fractured ? 'fractured' : mod.affix === 'Prefix' ? 'префикс' : mod.affix === 'Suffix' ? 'суффикс' : 'не распознан',
    mod.tier ? `T${mod.tier} из ${mod.tiers}` : null,
    mod.level && !mod.crafted ? `ур. предмета ${mod.level}+` : null
  ].filter(Boolean)
  return (
    <details className="mod-block">
      <summary>
        <span className="mod-text">{mod.text}</span>
        <span className="muted"> · {facts.join(' · ')}</span>
        {chosen ? <span className="mod-chosen"> → {chosen.title}</span> : <span className="muted"> · способов: {mod.ways.length}</span>}
      </summary>
      <Ways ways={mod.ways} chosen={mod.chosen} choiceKey={`${item.key}#${mod.key}`} />
    </details>
  )
}

function Item({ item, methodTitles }: { item: ItemSourcing; methodTitles: Map<string, string> }) {
  const unique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC'
  return (
    <article className="sourcing-item">
      <h5>
        <span className={unique ? 'unique' : ''}>{item.name}</span>
        {item.base && <small> · {item.base}</small>}
        {item.wikiUrl && <Ref link={{ label: 'вики', url: item.wikiUrl }} />}
      </h5>
      <p className="muted">{item.usedIn.join(' · ')}</p>
      {item.notes.length > 0 && (
        <ul className="source-notes">
          {item.notes.map((note, i) => (
            <Note key={i} note={note} />
          ))}
        </ul>
      )}

      {item.ways.length > 0 && (
        <>
          <h6>{unique ? 'Способы добыть — выбери свой' : 'Получить вещь целиком'}</h6>
          <Ways ways={item.ways} chosen={item.chosen} choiceKey={item.key} />
        </>
      )}

      {item.mods.length > 0 && (
        <>
          <h6>
            Моды и способы получить каждый
            {item.needsItemLevel ? <span className="muted"> · нужна база с уровнем предмета {item.needsItemLevel}+</span> : null}
          </h6>
          {item.mods.map((mod) => (
            <ModBlock key={mod.key} item={item} mod={mod} />
          ))}
        </>
      )}

      {item.methods.length > 0 && (
        <p className="muted">Подробнее ниже: {item.methods.map((id) => methodTitles.get(id) ?? id).join('; ')}.</p>
      )}
    </article>
  )
}

/** What the player decided to go for: one line per choice. */
function Goals({ items }: { items: ItemSourcing[] }) {
  const goals: { key: string; what: string; how: string }[] = []
  for (const item of items) {
    const way = item.ways.find((entry) => entry.id === item.chosen)
    if (way) goals.push({ key: item.key, what: item.name, how: way.title })
    for (const mod of item.mods) {
      const picked = mod.ways.find((entry) => entry.id === mod.chosen)
      if (picked) goals.push({ key: `${item.key}#${mod.key}`, what: `${item.name}: ${mod.text}`, how: picked.title })
    }
  }
  return (
    <section>
      <h4>Мой план по предметам</h4>
      {goals.length ? (
        <ul className="goals">
          {goals.map((goal) => (
            <li key={goal.key}>
              <b>{goal.what}</b> — {goal.how}
              <button className="quiet" title="Снять выбор" onClick={() => void window.poe.plan.chooseWay(goal.key, null)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          Пока пусто. Ниже у каждого уника и у каждого мода редкой вещи перечислены все способы — отметь галочкой тот,
          которым пойдёшь, и он появится здесь.
        </p>
      )}
    </section>
  )
}

/** What is known about getting the build's items without trading, and what the player chose. */
export function SourcingView({ plan }: { plan: PlanView }) {
  const sourcing = plan.sourcing
  if (!sourcing) return null
  const methodTitles = new Map(sourcing.methods.map((method) => [method.id, method.title]))

  return (
    <>
      <Goals items={[...sourcing.uniques, ...sourcing.special]} />

      <section>
        <h4>Уники: все способы добыть в SSF</h4>
        {sourcing.uniques.length ? (
          <div className="sourcing-grid">
            {sourcing.uniques.map((item) => (
              <Item key={item.key} item={item} methodTitles={methodTitles} />
            ))}
          </div>
        ) : (
          <p className="hint">Уников в билде нет.</p>
        )}
      </section>

      {sourcing.special.length > 0 && (
        <section>
          <h4>Редкие вещи: как собрать их моды</h4>
          <p className="hint">
            Проценты — оценка по весам модов из данных игры: шанс за одну попытку для этой базы и этого уровня предмета.
            Они не учитывают цену попытки и то, что нужные моды должны совпасть на одной вещи: точный расчёт «что
            дешевле» делает{' '}
            <a href="https://www.craftofexile.com/" target="_blank" rel="noreferrer" className="ref">
              Craft of Exile
            </a>
            .
          </p>
          <div className="sourcing-grid">
            {sourcing.special.map((item) => (
              <Item key={item.key} item={item} methodTitles={methodTitles} />
            ))}
          </div>
        </section>
      )}

      {sourcing.methods.length > 0 && (
        <section>
          <h4>Способы добычи в 3.30</h4>
          {sourcing.methods.map((method) => (
            <details key={method.id} className="method">
              <summary>{method.title}</summary>
              <p>{method.text}</p>
              {method.quotes.map((quote) => (
                <blockquote key={quote}>{quote}</blockquote>
              ))}
              <p>
                <a href={method.ref.url} target="_blank" rel="noreferrer" className="ref">
                  {method.ref.label}
                </a>
              </p>
            </details>
          ))}
        </section>
      )}

      <p className="hint">
        Источники уников, моды, эссенции и станок — из данных Path of Building; карты, фоссилы, крафты Harvest и пассивки
        Genesis Tree — с PoEDB; общие способы — дословно из патчноутов 3.30. Чего в этих источниках нет, я не додумываю:
        так и написано.
      </p>
    </>
  )
}
