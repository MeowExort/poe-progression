import type { Fragment, RouteStep } from '@shared/plan'

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

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
      return <span className="f-area">Logout ➞ {part.name}</span>
    case 'portal_use':
      return <span className="f-area">Portal ➞ {part.name}</span>
    case 'portal_set':
      return <span className="f-way">Portal</span>
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
      return <span className="f-trial">The Labyrinth ({part.lab})</span>
    case 'crafting':
      return (
        <span className="f-craft">
          Crafting Recipe{part.recipes.length ? `: ${part.recipes.join(', ')}` : ''}
        </span>
      )
    case 'dir':
      return <span className="f-dir">{ARROWS[part.index] ?? '?'}</span>
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
