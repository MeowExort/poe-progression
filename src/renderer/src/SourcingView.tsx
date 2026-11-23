import type { ItemSourcing, PlanView, SourceNote } from '@shared/plan'

function Note({ note }: { note: SourceNote }) {
  return (
    <li className={`tone-${note.tone}`}>
      {note.text}
      {note.ref && (
        <>
          {' '}
          <a href={note.ref.url} target="_blank" rel="noreferrer" className="ref">
            {note.ref.label}
          </a>
        </>
      )}
    </li>
  )
}

function Item({ item, methodTitles }: { item: ItemSourcing; methodTitles: Map<string, string> }) {
  const unique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC'
  return (
    <article className="sourcing-item">
      <h5>
        <span className={unique ? 'unique' : ''}>{item.name}</span>
        {item.base && <small> · {item.base}</small>}
        {item.wikiUrl && (
          <>
            {' '}
            <a href={item.wikiUrl} target="_blank" rel="noreferrer" className="ref">
              вики
            </a>
          </>
        )}
      </h5>
      <p className="muted">{item.usedIn.join(' · ')}</p>
      <ul className="source-notes">
        {item.notes.map((note, i) => (
          <Note key={i} note={note} />
        ))}
      </ul>
      {item.methods.length > 0 && (
        <p className="muted">Подробнее ниже: {item.methods.map((id) => methodTitles.get(id) ?? id).join('; ')}.</p>
      )}
    </article>
  )
}

/** What is known about getting the build's items without trading. */
export function SourcingView({ plan }: { plan: PlanView }) {
  const sourcing = plan.sourcing
  if (!sourcing) return null
  const methodTitles = new Map(sourcing.methods.map((method) => [method.id, method.title]))

  return (
    <>
      <section>
        <h4>Уники: где брать в SSF</h4>
        {sourcing.uniques.length ? (
          <div className="sourcing-grid">
            {sourcing.uniques.map((item) => (
              <Item key={`${item.name}|${item.base}`} item={item} methodTitles={methodTitles} />
            ))}
          </div>
        ) : (
          <p className="hint">Уников в билде нет.</p>
        )}
      </section>

      {sourcing.special.length > 0 && (
        <section>
          <h4>Предметы, над которыми придётся поработать</h4>
          <div className="sourcing-grid">
            {sourcing.special.map((item) => (
              <Item key={`${item.name}|${item.base}`} item={item} methodTitles={methodTitles} />
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
        Источники уников — из данных Path of Building, карты — с PoEDB, общие способы — дословно из патчноутов 3.30.
        Чего в этих источниках нет, я не додумываю: так и написано.
      </p>
    </>
  )
}
