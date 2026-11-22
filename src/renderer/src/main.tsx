import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Dashboard } from './Dashboard'
import { Overlay } from './Overlay'
import './styles.css'

const view = new URLSearchParams(location.search).get('view') === 'overlay' ? 'overlay' : 'main'
document.documentElement.dataset.view = view

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view === 'overlay' ? <Overlay /> : <Dashboard />}</StrictMode>
)
