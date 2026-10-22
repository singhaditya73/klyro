import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCcw } from 'lucide-react'

/**
 * The last line of defence.
 *
 * A desktop window that throws shows a white rectangle and the user has no
 * idea what happened. This catches it, says what went wrong, and offers the
 * one thing that usually helps: a reload.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Klyro hit an error in the interface', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="fatal">
        <div className="fatal__panel">
          <span className="fatal__icon">
            <AlertCircle className="icon icon--md" aria-hidden="true" />
          </span>
          <h1 className="fatal__title">Klyro hit an error</h1>
          <p className="fatal__text">
            The window could not be drawn. Nothing was lost — your settings, your history and your keys are on this
            machine.
          </p>
          <pre className="fatal__detail">{error.message}</pre>
          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              <RefreshCcw className="icon icon--sm" aria-hidden="true" />
              <span>Reload the window</span>
            </button>
          </div>
        </div>
      </div>
    )
  }
}
