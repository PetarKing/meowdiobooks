import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button, Panel, PresentationRoot } from '../src/ui'
import App from '../src/App'
import { createFixtureGateway } from '../design-kit/fixtures'
import { enterScenario } from './enterScenario'

const action = fn()
const meta = { title: 'Foundations/Presentation contract' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const IsolatedPalette: Story = {
  // White on baseline coral is inherited accepted-main contrast debt (3.15:1).
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', selector: '*:not([data-testid="baseline"] .primary)' }] } } },
  render: () => <div style={{ padding: 32, display: 'grid', gap: 24 }}>
    <PresentationRoot data-testid="baseline"><Panel title="Accepted baseline"><Button onClick={action}>Baseline action</Button></Panel></PresentationRoot>
    <PresentationRoot data-testid="proposal" palette={{ action: '#235548', actionHover: '#183d33', paper: '#f0ecd8', border: '#817652' }}><Panel title="Independent palette"><Button onClick={action}>Proposal action</Button></Panel></PresentationRoot>
    <PresentationRoot data-testid="host" className="host-consumer"><Panel title="Host override"><Button onClick={action}>Host action</Button></Panel></PresentationRoot>
    <style>{'.host-consumer .primary { background: rgb(47, 64, 110); }'}</style>
  </div>,
  play: async ({ canvasElement }) => {
    action.mockClear()
    const canvas = within(canvasElement)
    const baseline = canvas.getByRole('button', { name: 'Baseline action' })
    const proposal = canvas.getByRole('button', { name: 'Proposal action' })
    const host = canvas.getByRole('button', { name: 'Host action' })
    await expect(getComputedStyle(baseline).backgroundColor).toBe('rgb(237, 102, 89)')
    await expect(getComputedStyle(proposal).backgroundColor).toBe('rgb(35, 85, 72)')
    await expect(getComputedStyle(host).backgroundColor).toBe('rgb(47, 64, 110)')
    for (const key of ['fontFamily', 'borderRadius', 'padding', 'height'] as const) {
      await expect(getComputedStyle(proposal)[key]).toBe(getComputedStyle(baseline)[key])
    }
    await expect(getComputedStyle(canvas.getByTestId('proposal').querySelector('.panel')!).backgroundColor).toBe('rgb(240, 236, 216)')
    await userEvent.click(baseline)
    await userEvent.click(proposal)
    await userEvent.click(host)
    await expect(action).toHaveBeenCalledTimes(3)
  },
}

export const ProductPalette: Story = {
  render: () => <App gateway={createFixtureGateway('import')} presentationPalette={{ action: '#235548', actionHover: '#183d33', paper: '#f0ecd8' }} />,
  play: async ({ canvasElement }) => {
    await enterScenario(canvasElement, 'import')
    await userEvent.upload(canvasElement.querySelector('input[type="file"]')!, new File(['%PDF-1.4 synthetic preview'], 'preview.pdf', { type: 'application/pdf' }))
    const action = await within(canvasElement).findByRole('button', { name: /Import PDF/ })
    await expect(getComputedStyle(action).backgroundColor).toBe('rgb(35, 85, 72)')
    await expect(canvasElement.querySelectorAll('[data-presentation-root]').length).toBe(1)
  },
}
