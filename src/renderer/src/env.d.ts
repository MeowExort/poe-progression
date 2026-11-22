import type { PoeApi } from '@shared/api'

declare global {
  interface Window {
    poe: PoeApi
  }
}
