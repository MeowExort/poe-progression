import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Bounds, OverlayLayout } from '@shared/api'

const MIN: Record<OverlayLayout, { width: number; height: number }> = {
  panel: { width: 240, height: 180 },
  bar: { width: 480, height: 44 }
}

/** Which edges a handle drags: "move" drags the whole window. */
type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Grip[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** The rectangle after dragging `grip` by (dx, dy), never smaller than the layout allows. */
export function dragBounds(start: Bounds, grip: Grip, dx: number, dy: number, layout: OverlayLayout): Bounds {
  if (grip === 'move') return { ...start, x: start.x + dx, y: start.y + dy }
  const min = MIN[layout]
  let { x, y, width, height } = start
  if (grip.includes('e')) width = Math.max(min.width, start.width + dx)
  if (grip.includes('s')) height = Math.max(min.height, start.height + dy)
  if (grip.includes('w')) {
    width = Math.max(min.width, start.width - dx)
    x = start.x + start.width - width
  }
  if (grip.includes('n')) {
    height = Math.max(min.height, start.height - dy)
    y = start.y + start.height - height
  }
  return { x, y, width, height }
}

/**
 * Drawn over the overlay while it is being placed: drag the middle to move it, the edges and
 * corners to resize it. The window is transparent and frameless, so Windows offers no resize
 * border of its own — the handles here do the work and tell the main process the new rectangle.
 */
export function OverlayEdit({ layout, bounds }: { layout: OverlayLayout; bounds: Bounds }) {
  function start(event: ReactPointerEvent<HTMLElement>, grip: Grip): void {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    // Screen coordinates stay meaningful while the window itself moves under the pointer.
    const origin = { x: event.screenX, y: event.screenY }
    const move = (e: PointerEvent): void => {
      void window.poe.setOverlayBounds(dragBounds(bounds, grip, e.screenX - origin.x, e.screenY - origin.y, layout))
    }
    const stop = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', stop)
      target.removeEventListener('pointercancel', stop)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', stop)
    target.addEventListener('pointercancel', stop)
  }

  return (
    <div className="edit-frame" onPointerDown={(e) => start(e, 'move')}>
      {HANDLES.map((grip) => (
        <i key={grip} className={`grip grip-${grip}`} onPointerDown={(e) => start(e, grip)} />
      ))}
      <div className="edit-hint">
        <span>
          {layout === 'bar' ? 'Полоска Sanctum' : 'Боковая панель'} · {bounds.width}×{bounds.height} — тяни за середину,
          чтобы подвинуть, за края — чтобы изменить размер
        </span>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => void window.poe.resetOverlay(layout)}>
          Сбросить
        </button>
        <button className="primary" onPointerDown={(e) => e.stopPropagation()} onClick={() => void window.poe.editOverlay(null)}>
          Готово
        </button>
      </div>
    </div>
  )
}
