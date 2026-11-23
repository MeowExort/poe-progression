import type { Fragment, RouteStep } from '@shared/plan'

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/** The Labyrinths by the names the game gives them. */
const LABS: Record<string, string> = {
  normal: 'The Labyrinth',
  cruel: 'The Cruel Labyrinth',
  merciless: 'The Merciless Labyrinth',
  eternal: 'The Eternal Labyrinth'
}

function Part({ part }: { part: Fragment }) {
  switch (part.type) {
    case 'text':
      return <>{part.text}</>
    case 'enter':
    case 'area':
      return <span className="f-area">{part.name}</span>
    case 'arena':
      return <span className="f-area">{part.name}</span>
    case 'waypoint_use':
      return <span className="f-area">Waypoint ➞ {part.name}</span>
    case 'logout':
      return <span className="f-area">Перезайди в игру ➞ {part.name}</span>
    case 'portal_use':
      return <span className="f-area">Портал ➞ {part.name}</span>
    case 'portal_set':
      return <span className="f-way">портал</span>
    case 'waypoint':
    case 'waypoint_get':
      return <span className="f-way">Waypoint</span>
    case 'kill':
      return <span className="f-kill">{part.name}</span>
    case 'quest':
      return <span className="f-quest">{part.name}</span>
    case 'quest_text':
    case 'generic':
      return <span className="f-item">{part.text}</span>
    case 'trial':
      return <span className="f-trial">Trial of Ascendancy</span>
    case 'ascend':
      return <span className="f-trial">{LABS[part.lab] ?? 'The Labyrinth'}</span>
    case 'crafting':
      return (
        <span className="f-craft">
          рецепт крафта{part.recipes.length ? `: ${part.recipes.join(', ')}` : ''}
        </span>
      )
    case 'dir':
      return <span className="f-dir">{ARROWS[part.index] ?? '?'}</span>
    case 'gem':
      return (
        <>
          {part.reward === 'quest' ? `Возьми в награду у ${part.npc}: ` : `Купи у ${part.npc}: `}
          <span className={`gem g-${part.attribute}`}>{part.name}</span>
          {part.count > 1 && ` ×${part.count}`}
          <span className="gem-note"> — {part.note}</span>
        </>
      )
  }
}

export function Parts({ parts }: { parts: Fragment[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Part key={i} part={part} />
      ))}
    </>
  )
}

export function StepLine({ step }: { step: RouteStep }) {
  return (
    <>
      <div className="step-main">
        <Parts parts={step.parts} />
      </div>
      {step.subSteps.length > 0 && (
        <ul className="step-subs">
          {step.subSteps.map((sub, i) => (
            <li key={i}>
              <Parts parts={sub} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
