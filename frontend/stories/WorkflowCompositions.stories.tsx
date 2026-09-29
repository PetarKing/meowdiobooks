import { previewAppearance } from './appearance'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, PresentationRoot, StepIntro, WorkflowEmpty, WorkflowLaunch } from '../src/ui'

const meta = {
  title: 'Components/Workflow compositions',
  component: StepIntro,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <PresentationRoot appearance={previewAppearance()} style={{ maxWidth: 960, margin: 'auto', padding: 24 }}><Story /></PresentationRoot>],
} satisfies Meta<typeof StepIntro>
export default meta

export const Introduction: StoryObj<typeof StepIntro> = {
  args: { eyebrow: 'STEP 4 · CAST & VOICES', title: 'Find the voice of your story.', copy: 'Compare auditions and approve the exact sample you want to keep.' },
  argTypes: { title: { control: 'text' }, copy: { control: 'text' }, eyebrow: { control: 'text' } },
}

export const Empty: StoryObj<typeof WorkflowEmpty> = {
  args: { title: 'Your library begins here.', copy: 'Import a PDF to prepare your first audiobook.', symbol: '✦' },
  argTypes: { title: { control: 'text' }, copy: { control: 'text' }, symbol: { control: 'text' } },
  render: (args) => <WorkflowEmpty {...args}><Button>Import a PDF</Button></WorkflowEmpty>,
}

export const Preparation: StoryObj<typeof WorkflowLaunch> = {
  render: () => <><StepIntro eyebrow="STEP 2 · DIALOGUE" title="Choose who reads each line." copy="Scan the text, then review uncertain speaker assignments." /><WorkflowLaunch><Button>Scan dialogue</Button></WorkflowLaunch></>,
}
