import { useCallback, useEffect, useState } from 'react'

/**
 * The shell's navigation, in the URL.
 *
 * The app has no router dependency: a hash is enough, and it keeps the
 * renderer free of a second library for five destinations. The overlay uses
 * the same file with `#overlay`, which is why the route check happens before
 * the app mounts.
 */

export const ROUTES = ['home', 'models', 'knowledge', 'interviews', 'integrations', 'settings', 'privacy'] as const

export type Route = (typeof ROUTES)[number]

function routeFromHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split('?')[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'home'
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash))

  useEffect(() => {
    const onChange = (): void => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route): void => {
    if (routeFromHash(window.location.hash) === next) return
    window.location.hash = `#/${next}`
  }, [])

  return [route, navigate]
}
