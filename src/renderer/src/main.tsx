import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './OverlayApp'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

const isOverlay = window.location.hash.replace(/^#\/?/, '') === 'overlay'

createRoot(container).render(isOverlay ? <OverlayApp /> : <App />)
