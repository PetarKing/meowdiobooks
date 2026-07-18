import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

describe('library card layout', () => {
  it('caps desktop cards instead of stretching a single audiobook across the row', () => {
    const gridRule = workflowStyles.match(/\.library-grid\s*\{([^}]*)\}/)?.[1]

    expect(gridRule).toMatch(/grid-template-columns\s*:\s*repeat\(auto-fill,minmax\(min\(100%,300px\),380px\)\)/)
    expect(gridRule).toMatch(/justify-content\s*:\s*start/)
  })

  it('keeps the capped card fluid and centered on mobile', () => {
    const mobileStyles = workflowStyles.match(/@media\(max-width:\s*650px\)\s*\{([\s\S]*?)\n\}/)?.[1]
    const gridRule = mobileStyles?.match(/\.library-grid\s*\{([^}]*)\}/)?.[1]

    expect(gridRule).toMatch(/grid-template-columns\s*:\s*minmax\(0,380px\)/)
    expect(gridRule).toMatch(/justify-content\s*:\s*center/)
  })
})
