import { useEffect, useRef, useState } from 'react'
import type { PlanView } from '@shared/plan'
import { StepLine } from './StepLine'

/** The whole campaign route, one act at a time; click a step to move the position there. */
export function RouteView({ plan }: { plan: PlanView }) {
  const { steps, position } = plan
  const currentAct = steps[Math.min(position, steps.length - 1)]?.act ?? 1
  const [act, setAct] = useState(currentAct)
  const currentRef = useRef<HTMLLIElement | null>(null)

  // Follow the player: when the position crosses into another act, show that act.
  useEffect(() => setAct(currentAct), [currentAct])
  useEffect(() => {
    // Braces matter: scrollIntoView returns a promise in current Chromium, and an effect
    // must not return one.
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [position, act])

  const acts = [...new Set(steps.map((step) => step.act))]
  const shown = steps.filter((step) => step.act === act)

  return (
    <div className="route">
      <nav className="acts">
        {acts.map((n) => (
          <button key={n} className={n === act ? 'active' : ''} onClick={() => setAct(n)}>
            Акт {n}
            {n === currentAct && <i className="dot" />}
          </button>
        ))}
      </nav>
      <ol className="steps">
        {shown.map((step, i) => {
          const state = step.index < position ? 'done' : step.index === position ? 'current' : 'todo'
          const newArea = i === 0 || shown[i - 1].areaId !== step.areaId
          return (
            <li key={step.index} ref={state === 'current' ? currentRef : null}>
              {newArea && <h4 className="step-area">{step.areaName}</h4>}
              <button
                className={`step ${state}`}
                title="Сделать этот шаг текущим"
                onClick={() => void window.poe.plan.setPosition(step.index)}
              >
                <StepLine step={step} />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
