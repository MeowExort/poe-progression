import { useState } from 'react'
import type { PlanView, TreePoint, VendorSearch } from '@shared/plan'
import { formatDateTime } from './format'

const KIND_MARK: Record<TreePoint['kind'], string> = { small: '', notable: '★', keystone: '◆', mastery: '✦', jewel: '◇' }
const KIND_LABEL: Record<TreePoint['kind'], string> = {
  small: '',
  notable: 'нотабл',
  keystone: 'кистоун',
  mastery: 'мастери',
  jewel: 'гнездо самоцвета'
}
const LAB_NAMES: Record<string, string> = {
  normal: 'The Labyrinth',
  cruel: 'The Cruel Labyrinth',
  merciless: 'The Merciless Labyrinth',
  eternal: 'The Eternal Labyrinth'
}

function PointName({ point }: { point: TreePoint }) {
  return (
    <span className={`tree-point k-${point.kind}`}>
      {KIND_MARK[point.kind] && <i>{KIND_MARK[point.kind]} </i>}
      {point.name}
    </span>
  )
}

/** The next passive points as one line: for the overlay, where room is short. */
export function TreeLine({ plan, limit = 6 }: { plan: PlanView; limit?: number }) {
  const tree = plan.tree
  if (!tree || !tree.next.length) return null
  return (
    <section className="overlay-tree">
      <h5>
        Дерево · {tree.taken} из {tree.total}
        {!tree.known && ' · дерево персонажа не прочитано'}
      </h5>
      <p>
        {tree.next.slice(0, limit).map((point, i) => (
          <span key={point.id}>
            {i > 0 && <span className="muted"> → </span>}
            <PointName point={point} />
          </span>
        ))}
      </p>
    </section>
  )
}

/** Search strings with a button that copies them, for pasting into a vendor's search box. */
export function VendorSearches({ searches, compact = false }: { searches: VendorSearch[]; compact?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null)
  if (!searches.length) return null
  const copy = (pattern: string): void => {
    void window.poe.copyText(pattern).then(() => {
      setCopied(pattern)
      setTimeout(() => setCopied((current) => (current === pattern ? null : current)), 1500)
    })
  }
  return (
    <ul className={`vendor-searches${compact ? ' compact' : ''}`}>
      {searches.map((search) => (
        <li key={search.pattern}>
          <span className="vendor-label">{search.label}</span>
          <code>{search.pattern}</code>
          <button onClick={() => copy(search.pattern)}>{copied === search.pattern ? 'Скопировано' : 'Копировать'}</button>
          {!compact && search.note && <small className="muted">{search.note}</small>}
        </li>
      ))}
    </ul>
  )
}

/** The full advice on the passive tree: what is next, what is off the plan, the Labyrinths. */
export function TreeAdviceView({ plan }: { plan: PlanView }) {
  const tree = plan.tree
  const specs = plan.pob?.treeSpecs ?? []
  if (!tree) return null
  const reading = plan.treeReading

  return (
    <section className="tree-advice">
      <h4>Что брать дальше</h4>
      <div className="tree-head">
        <label>
          Следовать дереву{' '}
          <select
            value={plan.treeTarget ?? 'auto'}
            onChange={(e) => void window.poe.plan.setTreeTarget(e.target.value === 'auto' ? null : +e.target.value)}
          >
            <option value="auto">по порядку: сейчас «{tree.specTitle}»</option>
            {tree.stages.map((index) => (
              <option key={index} value={index}>
                {specs[index]?.title} · {specs[index]?.nodes} узлов
              </option>
            ))}
          </select>
        </label>
        <span>
          взято <b>{tree.taken}</b> из {tree.total}
        </span>
        <button disabled={reading.busy} onClick={() => void window.poe.plan.refreshTree()}>
          {reading.busy ? 'Читаю дерево…' : 'Обновить с сайта'}
        </button>
      </div>
      <p className={`hint${reading.error ? ' bad' : ''}`}>
        {reading.error
          ? `Дерево персонажа не прочитано: ${reading.error} Пока порядок показан от старта класса.`
          : reading.readAt
            ? `Дерево персонажа ${reading.character ?? ''} прочитано ${formatDateTime(reading.readAt)}. Обновляется само после левел-апа и при входе в город.`
            : 'Дерево персонажа ещё не прочитано: порядок показан от старта класса.'}
      </p>

      {tree.next.length > 0 ? (
        <ol className="tree-next">
          {tree.next.map((point) => (
            <li key={point.id}>
              <PointName point={point} />
              {KIND_LABEL[point.kind] && <span className="muted"> · {KIND_LABEL[point.kind]}</span>}
              {point.stats.length > 0 && <small className="muted">{point.stats.join('; ')}</small>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="note ok">Это дерево взято целиком.</p>
      )}
      {tree.more > 0 && <p className="hint">…и ещё {tree.more} до конца этого дерева.</p>}
      <p className="hint">
        Path of Building не хранит порядок, в котором брали очки, поэтому порядок здесь мой: каждый раз иду к ближайшему
        нотаблу, кистоуну или мастери из дерева билда. Если в гайде порядок другой — верь гайду.
      </p>
      {tree.unreachable > 0 && (
        <p className="note bad">
          {tree.unreachable} узлов этого дерева я не могу связать с остальными: скорее всего, билд сделан под другую
          версию дерева или использует кластерные самоцветы. Их смотри в Path of Building.
        </p>
      )}
      {tree.extra.length > 0 && (
        <p className="note bad">
          У персонажа взяты узлы, которых нет ни в одном дереве билда: {tree.extra.map((point) => point.name).join(', ')}.
        </p>
      )}

      {plan.labs.length > 0 && (
        <>
          <h4>Очки возвышения по лабам</h4>
          <ul className="spec-list">
            {plan.labs.map((lab) => (
              <li key={lab.lab}>
                <strong>{LAB_NAMES[lab.lab]}</strong>
                <span className="muted"> · </span>
                {lab.nodes.map((point, i) => (
                  <span key={point.id}>
                    {i > 0 && <span className="muted"> → </span>}
                    <PointName point={point} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
