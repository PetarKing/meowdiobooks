import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const supplementalStyles = readFileSync(resolve(process.cwd(), 'src/media.css'), 'utf8')
const mobileStyles = workflowStyles.match(/@media\(max-width:\s*650px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const supplementalMobileStyles = supplementalStyles.match(/@media\s*\(max-width:\s*650px\)\s*\{([\s\S]*?)\n\}/)?.[1]

function rule(selector, styles = mobileStyles) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles?.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1]
}

describe('mobile workflow layout', () => {
  it('keeps form controls readable without triggering iOS focus zoom', () => {
    const formControls = rule('input,select,textarea')
    const normalizedFormControls = rule('input,select,textarea', supplementalMobileStyles)

    expect(formControls).toMatch(/font-size\s*:\s*16px\s*!important/)
    expect(normalizedFormControls).toMatch(/font-weight\s*:\s*500\s*!important/)
    expect(normalizedFormControls).toMatch(/letter-spacing\s*:\s*0/)
    expect(normalizedFormControls).toMatch(/text-transform\s*:\s*none/)
  })

  it('bounds cast audio settings and keeps language choices readable on mobile', () => {
    expect(rule('.cast-toolbar > .cast-toolbar-actions')).toMatch(/align-self\s*:\s*stretch/)
    expect(rule('.cast-audio-settings')).toMatch(/right\s*:\s*0/)
    expect(rule('.cast-audio-settings')).toMatch(/left\s*:\s*0/)
    expect(rule('.cast-audio-settings')).toMatch(/width\s*:\s*auto/)
    expect(rule('.language-flags')).toMatch(/grid-template-columns\s*:\s*repeat\(auto-fit,minmax\(min\(120px,100%\),1fr\)\)/)
    expect(rule('.language-flags button small')).toMatch(/overflow-wrap\s*:\s*normal/)
    expect(rule('.language-flags button small')).toMatch(/word-break\s*:\s*normal/)
    expect(mobileStyles).not.toMatch(/\.cast-audio-settings\s*\{[^}]*88vw/)
  })

  it('stacks enrichment previews instead of clipping a horizontal card', () => {
    expect(rule('.future-feature-grid')).toMatch(/grid-template-columns\s*:\s*1fr/)
    expect(mobileStyles).not.toMatch(/\.future-feature-grid article\s*\{[^}]*min-width\s*:\s*82%/)
  })

  it('gives odd accepted-summary metrics a complete final row', () => {
    expect(rule('.accepted-summary')).toMatch(/grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/)
    expect(rule('.accepted-summary span:last-child:nth-child(odd)')).toMatch(/grid-column\s*:\s*1\/-1/)
    expect(rule('.accepted-summary b,.accepted-summary small')).toMatch(/overflow-wrap\s*:\s*anywhere/)
  })

  it('allows generated chapter actions and stats to shrink and wrap', () => {
    expect(rule('.generate-hero-stats dd')).toMatch(/overflow-wrap\s*:\s*anywhere/)
    expect(rule('.generation-selection > *')).toMatch(/min-width\s*:\s*0/)
    expect(rule('.generation-selection-actions .primary,.generation-selection-actions .ghost')).toMatch(/min-width\s*:\s*0/)
    expect(rule('.generation-selection-actions .primary,.generation-selection-actions .ghost')).toMatch(/white-space\s*:\s*normal/)
  })

  it('stacks export details and keeps format estimates readable on mobile', () => {
    expect(rule('.export-layout,.export-sidebar')).toMatch(/gap\s*:\s*14px/)
    expect(rule('.export-format-options label')).toMatch(/grid-template-columns\s*:\s*18px minmax\(0,1fr\)/)
    expect(rule('.export-format-options strong')).toMatch(/grid-column\s*:\s*2/)
    expect(rule('.export-format-options strong')).toMatch(/justify-self\s*:\s*start/)
    expect(rule('.export-summary')).toMatch(/flex-direction\s*:\s*column/)
  })
})
