import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { DialogueAttributionRoute, DialogueRoutingPreview } from '../src/api/contracts'
import { DialogueRoutingChoice } from '../src/components/DialogueRoutingChoice'
import { Button, Panel, PresentationRoot } from '../src/ui'
import { previewAppearance } from './appearance'

const meta = { title: 'Components/Dialogue routing', parameters: { layout: 'padded' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function RoutingExample({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<DialogueAttributionRoute>()
  const routing: DialogueRoutingPreview = {
    targetCount: 140, largeReviewThreshold: 100, shouldPrompt: true, defaultRoute: 'local',
    local: { displayName: 'Qwen', apiCostUsd: 0 },
    remote: {
      displayName: 'Luna', domain: 'api.example.test', credentialConfigured: configured,
      apiKeyEnvironmentVariable: 'SYNTHETIC_API_KEY', estimatedCostUsd: 0.35,
    },
  }
  return <PresentationRoot appearance={previewAppearance()} style={{ padding: 24 }}>
    <Panel title="Speaker-check routing" variant="plain">
      <p>Synthetic route choices. Proceed records a local receipt only; no model or provider is called.</p>
      <Button onClick={() => { setChosen(undefined); setOpen(true) }}>Choose speaker-check route</Button>
      {chosen && <p role="status">Synthetic route chosen: {chosen}</p>}
    </Panel>
    {open && <DialogueRoutingChoice routing={routing} onClose={() => setOpen(false)} onChoose={(route) => { setChosen(route); setOpen(false) }} />}
  </PresentationRoot>
}

export const Configured: Story = {
  render: () => <RoutingExample configured />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose speaker-check route' }))
    const dialog = within(canvas.getByRole('dialog'))
    await expect(dialog.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: /^Luna/ }))
    await expect(dialog.getByRole('button', { name: /^Luna/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: /^Use Luna/ }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Synthetic route chosen: remote')
  },
}

export const CredentialUnavailable: Story = {
  render: () => <RoutingExample configured={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose speaker-check route' }))
    const dialog = within(canvas.getByRole('dialog'))
    await expect(dialog.getByRole('button', { name: /^Luna/ })).toBeDisabled()
    await waitFor(() => expect(dialog.getByText('Remote model unavailable: API credentials are not configured.')).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: /^Qwen/ }))
    await expect(dialog.getByRole('button', { name: /^Qwen/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.queryByRole('button', { name: /^Use Luna/ })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: /^Use Qwen/ }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Synthetic route chosen: local')
  },
}
