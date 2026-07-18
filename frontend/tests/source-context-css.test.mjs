import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('dialogue review source evidence styles', () => {
  it('does not visually remove context between the source window and highlight', () => {
    const contextRule = workflowStyles.match(
      /\.dialogue-focused-outcome \.ai-source-evidence:not\(\.expanded\) p\s*\{([^}]*)\}/,
    )?.[1]

    expect(contextRule).toBeDefined()
    expect(contextRule).toMatch(/display\s*:\s*block/)
    expect(contextRule).toMatch(/overflow\s*:\s*visible/)
    expect(contextRule).not.toMatch(/line-clamp|max-height/)
  })
})
