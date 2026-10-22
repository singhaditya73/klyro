import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './OverlayApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

const isOverlay = window.location.hash.replace(/^#\/?/, '') === 'overlay'

// A window that throws must not go blank: the boundary says what happened.
createRoot(container).render(
  <ErrorBoundary>{isOverlay ? <OverlayApp /> : <App />}</ErrorBoundary>
)
