import { useEffect, useRef } from 'react'

/**
 * Wires a modal panel for keyboard dismissal: Escape closes it, and the panel
 * itself takes focus on open so the next Tab lands inside the dialog.
 */
export function useModal(onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return ref
}
