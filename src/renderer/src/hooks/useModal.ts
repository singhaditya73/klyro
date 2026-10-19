import { useEffect, useRef } from 'react'

/**
 * Wires a modal panel for keyboard dismissal: Escape closes it, and the panel
 * itself takes focus on open so the next Tab lands inside the dialog.
 *
 * The close callback is kept in a ref on purpose. Panels are usually handed a
 * fresh arrow function on every render of the app, and depending on that
 * identity re-ran this effect — which re-focused the panel and pulled the
 * caret out of whatever field the user was typing in after every keystroke.
 */
export function useModal(onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    ref.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return ref
}
