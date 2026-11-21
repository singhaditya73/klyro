import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OverlayCommandMenu } from './OverlayCommandMenu'

describe('OverlayCommandMenu', () => {
  it('renders commands when open', () => {
    const html = renderToStaticMarkup(
      <OverlayCommandMenu
        open={true}
        onClose={vi.fn()}
        onSelectAction={vi.fn()}
        state={{
          privateMode: false,
          zeroFocus: false,
          hesitationRadar: false,
          ghostPhone: false,
          hasAnswer: true,
          hasHistory: true,
          mode: 'idle'
        }}
      />
    )

    expect(html).toContain('Catch Me Up Briefing')
    expect(html).toContain('Live Hesitation &amp; Intent Radar')
    expect(html).toContain('Decoy Notepad Camouflage')
    expect(html).toContain('Alt+U')
    expect(html).toContain('Alt+H')
    expect(html).toContain('Alt+D')
  })

  it('renders null when closed', () => {
    const html = renderToStaticMarkup(
      <OverlayCommandMenu
        open={false}
        onClose={vi.fn()}
        onSelectAction={vi.fn()}
        state={{
          privateMode: false,
          zeroFocus: false,
          hesitationRadar: false,
          ghostPhone: false,
          hasAnswer: false,
          hasHistory: false,
          mode: 'idle'
        }}
      />
    )

    expect(html).toBe('')
  })
})
