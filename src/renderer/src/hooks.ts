import { useEffect, useState } from 'react'
import type { SessionState } from '@shared/api'
import type { PlanView } from '@shared/plan'
import type { SanctumView } from '@shared/sanctum'
import type { UpdateState } from '@shared/update'

/** The live session state pushed from the main process; null until the first snapshot arrives. */
export function useSession(): SessionState | null {
  const [state, setState] = useState<SessionState | null>(null)
  useEffect(() => {
    let active = true
    void window.poe.getState().then((s) => {
      if (active) setState((current) => current ?? s)
    })
    const unsubscribe = window.poe.onState(setState)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return state
}

/** Re-renders the caller every `intervalMs` and returns the current time. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** The plan pushed from the main process; null until the first snapshot arrives. */
export function usePlan(): PlanView | null {
  const [plan, setPlan] = useState<PlanView | null>(null)
  useEffect(() => {
    let active = true
    void window.poe.plan.get().then((view) => {
      if (active) setPlan((current) => current ?? view)
    })
    const unsubscribe = window.poe.plan.onChange(setPlan)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return plan
}

/** The loot tracker's state pushed from the main process; null until the first snapshot arrives. */
export function useSanctum(): SanctumView | null {
  const [view, setView] = useState<SanctumView | null>(null)
  useEffect(() => {
    let active = true
    void window.poe.sanctum.get().then((initial) => {
      if (active) setView((current) => current ?? initial)
    })
    const unsubscribe = window.poe.sanctum.onChange(setView)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return view
}

/** What the app knows about updates of itself; null until the first snapshot arrives. */
export function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let active = true
    void window.poe.update.get().then((initial) => {
      if (active) setState((current) => current ?? initial)
    })
    const unsubscribe = window.poe.update.onChange(setState)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return state
}
