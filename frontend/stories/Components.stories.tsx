import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button, Choice, DialogSurface, Panel, PresentationRoot, Tag, TabList, SourceExcerpt } from '../src/ui'

import { CollectionToolbar } from "../src/components/CollectionToolbar"
import { collectionMatches } from "../src/components/collectionSearch"
import { NarrationLanguagePicker } from '../src/components/LanguagePicker'

const meta = {
  title: 'Components/Studio primitives',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Actions: Story = {
  render: () => <PresentationRoot>
    <Panel title="One clear next step" eyebrow="Actions" variant="plain">
      <p>Primary actions advance the work. Supporting actions stay quiet.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Button>Approve voice</Button><Button variant="secondary">Hear another</Button>
        <Button variant="ghost">Back to cast</Button><Button variant="danger">Remove sample</Button>
        <Button busy>Create audition</Button><Button disabled>Export</Button>
      </div>
    </Panel>
  </PresentationRoot>,
}

function ChoiceExample() {
  const [selected, setSelected] = useState('fast')
  return <PresentationRoot><Panel title="Choose a reading strategy" variant="plain" eyebrow="Selection">
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      <Choice title="Fast extraction" text="Simple pages and continuous prose." badge="Start here" selected={selected === 'fast'} onClick={() => setSelected('fast')} detail="Compare the sample with your PDF before accepting." detailLabel="About fast extraction" />
      <Choice title="Layout aware" text="Columns and complex page layouts." selected={selected === 'layout'} onClick={() => setSelected('layout')} detail="Preserves spatial reading order. Takes longer." detailLabel="About layout aware extraction" />
    </div>
  </Panel></PresentationRoot>
}
export const Choices: Story = {
  render: () => <ChoiceExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Layout aware Columns and complex page layouts.' }))
    await expect(canvas.getByRole('button', { name: 'Layout aware Columns and complex page layouts.' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'About fast extraction' }))
    await expect(await canvas.findByRole('tooltip')).toHaveTextContent('Compare the sample')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvas.queryByRole('tooltip')).not.toBeInTheDocument())
  },
}

export const SurfacesAndStatus: Story = {
  render: () => <PresentationRoot style={{ maxWidth: 880, margin: 'auto', display: 'grid', gap: 24 }}>
    <Panel title="Editorial section" eyebrow="Plain" variant="plain" actions={<Button variant="ghost" compact>Edit details</Button>}>
      <p>A heading and a divider are often enough. Keep the reading canvas open.</p>
    </Panel>
    <Panel title="Source evidence" eyebrow="Surface"><SourceExcerpt source="The moon rose above the silent library." contextBefore="The windows faced the garden." contextAfter="A page turned in the darkness." /></Panel>
    <Panel title="Status carries meaning" eyebrow="Inset" variant="inset">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}><Tag>Not started</Tag><Tag tone="good">Approved</Tag><Tag tone="warn">Needs review</Tag><Tag tone="rose">New audition</Tag></div>
    </Panel>
  </PresentationRoot>,
}

function TabsExample() {
  const [value, setValue] = useState('voices')
  return <PresentationRoot><Panel title="Move between related views" variant="plain">
    <TabList label="Cast review" className="product-tabs" panelId="primitive-tabs" value={value} onChange={setValue} items={[{ value: 'voices', label: 'Voice auditions' }, { value: 'identities', label: 'Character identities' }]} />
    <div id="primitive-tabs" role="tabpanel" aria-labelledby={`primitive-tabs-${value}`} tabIndex={0} style={{ paddingBlock: 24 }}>{value === 'voices' ? 'Compare the voice samples before approval.' : 'Resolve the names that refer to one character.'}</div>
  </Panel></PresentationRoot>
}
export const KeyboardTabs: Story = {
  render: () => <TabsExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Voice auditions' }))
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('tab', { name: 'Character identities' })).toHaveFocus()
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Resolve the names')
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('tab', { name: 'Voice auditions' })).toHaveFocus()
  },
}

function LanguageExample() {
  const [language, setLanguage] = useState('english')
  return <PresentationRoot><Panel title="Narration language" variant="plain">
    <NarrationLanguagePicker languages={['english', 'german', 'japanese']} language={language} onChange={setLanguage} />
  </Panel></PresentationRoot>
}
export const Language: Story = {
  render: () => <LanguageExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Narration language' })
    await userEvent.click(trigger)
    await userEvent.click(canvas.getByRole('button', { name: /german/i }))
    await expect(trigger).toHaveTextContent(/german/i)
    await expect(trigger).toHaveFocus()
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    await expect(trigger.closest('details')).not.toHaveAttribute('open')
  },
}

function DialogExample() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <PresentationRoot><Button ref={trigger} onClick={() => setOpen(true)}>Review audition</Button>
    {open && <div className="cast-inspector-backdrop">
      <DialogSurface className="cast-inspector" aria-label="Review audition" onDismiss={() => setOpen(false)} returnFocusRef={trigger}>
        <Panel title="Approve this voice?" variant="plain"><p>Listen to the audition before approving the exact sample.</p>
          <Button variant="ghost" onClick={() => setOpen(false)}>Close review</Button>
          <Button onClick={() => setOpen(false)}>Approve audition</Button>
        </Panel>
      </DialogSurface>
    </div>}
  </PresentationRoot>
}
export const Dialog: Story = {
  render: () => <DialogExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Review audition' })
    await userEvent.click(trigger)
    await expect(canvas.getByRole('dialog')).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect(canvas.getByRole('button', { name: 'Close review' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect(canvas.getByRole('button', { name: 'Approve audition' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(trigger).toHaveFocus()
  },
}

export const ButtonPlayground: StoryObj<typeof Button> = {
  args: { children: 'Approve voice', variant: 'primary', compact: false, busy: false, disabled: false },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'unstyled'] },
    compact: { control: 'boolean' }, busy: { control: 'boolean' }, disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
  render: (args) => <PresentationRoot style={{ padding: 32 }}><Button {...args} /></PresentationRoot>,
}

export const PanelPlayground: StoryObj<typeof Panel> = {
  args: { title: 'Your recording studio', eyebrow: 'Cast & voices', variant: 'plain', children: 'Compare your auditions, then approve the exact voice you want to keep.' },
  argTypes: {
    variant: { control: 'select', options: ['plain', 'surface', 'inset'] },
    title: { control: 'text' }, eyebrow: { control: 'text' }, children: { control: 'text' },
  },
  render: (args) => <PresentationRoot style={{ maxWidth: 720, margin: 'auto', padding: 24 }}><Panel {...args} /></PresentationRoot>,
}


function CollectionExample() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const members = [{ name: 'Alice', required: false }, { name: 'White Rabbit', required: true }, { name: 'Queen of Hearts', required: false }]
  const shown = members.filter(member => collectionMatches(query, [member.name]) && (filter === 'all' || member.required))
  return <PresentationRoot><Panel title="Find the next voice" eyebrow="Collections" variant="plain">
    <CollectionToolbar query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} filters={[{value:'all',label:'All cast'},{value:'required',label:'Required'}]} searchLabel="Search cast" filterLabel="Show cast" countLabel={`${shown.length} of ${members.length} cast members shown`} clearLabel="Clear" />
    <p>{shown.length ? shown.map(member=>member.name).join(' · ') : 'No cast members match.'}</p>
    <Tag tone="warn">1 voice requires review</Tag>
  </Panel></PresentationRoot>
}
export const Collections: Story = {
  render: () => <CollectionExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('searchbox', {name:'Search cast'}), 'QUEEN')
    await expect(canvas.getByText('1 of 3 cast members shown')).toBeVisible()
    await expect(canvas.getByText('1 voice requires review')).toBeVisible()
    await userEvent.selectOptions(canvas.getByRole('combobox', {name:'Show cast'}), 'required')
    await expect(canvas.getByText('No cast members match.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', {name:'Clear'}))
    await expect(canvas.getByRole('searchbox', {name:'Search cast'})).toHaveFocus()
    await expect(canvas.getByText('3 of 3 cast members shown')).toBeVisible()
  },
}
