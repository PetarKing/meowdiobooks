import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const dialogueReview = readFileSync(resolve(process.cwd(), 'src/components/DialogueResultReview.tsx'), 'utf8')

describe('dialogue result actions', () => {
  it('renders the existing actions in a Dialogue-specific floating bar', () => {
    expect(dialogueReview).toContain('className="phase-action dialogue-floating-action"')
    expect(dialogueReview).toContain('{t("Change strategy")}')
    expect(dialogueReview).toContain('{t("Accept dialogue result")}')
  })

  it('fixes the bar above the viewport edge and reserves content space', () => {
    const actionRule = workflowStyles.match(/\.dialogue-floating-action\s*\{([^}]*)\}/)?.[1]
    const workspaceRule = workflowStyles.match(/\.dialogue-result-workspace\s*\{([^}]*)\}/)?.[1]

    expect(actionRule).toMatch(/position\s*:\s*fixed/)
    expect(actionRule).toMatch(/bottom\s*:\s*18px/)
    expect(workspaceRule).toMatch(/padding-bottom\s*:\s*92px/)
  })
})
