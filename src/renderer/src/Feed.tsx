import type { FeedEntry } from '@shared/events'
import { formatClock } from './format'

function describe(entry: FeedEntry): { label: string; detail?: string; tone: string } {
  switch (entry.type) {
    case 'area_entered':
      return {
        label: entry.name,
        detail: entry.level != null ? `ур. ${entry.level}` : undefined,
        tone: 'area'
      }
    case 'level_up':
      return { label: `Уровень ${entry.level}`, detail: `${entry.character} · ${entry.class}`, tone: 'level' }
    case 'death':
      return { label: 'Смерть', detail: entry.character, tone: 'death' }
    case 'dialogue':
      return { label: entry.speaker, detail: entry.text, tone: 'dialogue' }
    case 'system':
      return { label: entry.text, tone: 'system' }
    case 'afk':
      return { label: entry.on ? 'AFK' : 'Вернулся из AFK', tone: 'system' }
    case 'area_generated':
      return { label: entry.areaId, detail: `ур. ${entry.level}`, tone: 'system' }
  }
}

export function Feed({ entries, limit, empty }: { entries: FeedEntry[]; limit?: number; empty: string }) {
  const shown = (limit ? entries.slice(-limit) : entries).slice().reverse()
  if (!shown.length) return <p className="empty">{empty}</p>
  return (
    <ul className="feed">
      {shown.map((entry) => {
        const { label, detail, tone } = describe(entry)
        return (
          <li key={entry.id} className={`feed-item tone-${tone}`}>
            <time>{formatClock(entry.ts)}</time>
            <span className="feed-label">{label}</span>
            {detail && <span className="feed-detail">{detail}</span>}
          </li>
        )
      })}
    </ul>
  )
}
