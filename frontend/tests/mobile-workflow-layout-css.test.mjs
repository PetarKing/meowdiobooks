import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
const supplementalStyles = readFileSync(resolve(process.cwd(), 'src/media.css'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const mobileStyles = workflowStyles.match(/@media\(max-width:\s*650px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const supplementalMobileStyles = supplementalStyles.match(/@media\s*\(max-width:\s*650px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const tabletStyles = workflowStyles.match(/@media\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const tabletHeaderStyles = workflowStyles.match(/@media\(min-width:651px\) and \(max-width:919px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const narrowPhoneStyles = workflowStyles.match(/@media\(max-width:340px\)\s*\{([\s\S]*?)\n\}/)?.[1]
const shortPhoneStyles = workflowStyles.match(/@media\(max-width:650px\) and \(max-height:700px\)\s*\{([\s\S]*?)\n\}/)?.[1]

function rule(selector, styles = mobileStyles) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles?.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1]
}

describe('responsive layout stylesheet guards', () => {
  it('declares the compact header overrides used through tablet widths', () => {
    expect(rule('.topbar-inner', tabletHeaderStyles)).toMatch(/grid-template-columns\s*:\s*auto minmax\(0,1fr\) auto/)
    expect(rule('.brand > span:last-child', tabletHeaderStyles)).toMatch(/display\s*:\s*none/)
    expect(rule('.product-tabs', tabletHeaderStyles)).toMatch(/justify-self\s*:\s*center/)
    expect(rule('.local-pill', tabletHeaderStyles)).toMatch(/display\s*:\s*none/)
  })

  it('declares a smoothly scaling tablet rail and visible named progress', () => {
    expect(rule('.workspace', workflowStyles)).toMatch(/--workspace-rail-width\s*:\s*clamp\(190px,16vw,250px\)/)
    expect(rule('.workspace', tabletStyles)).toMatch(/--workspace-rail-width\s*:\s*clamp\(150px,21vw,190px\)/)
    expect(rule('.mobile-progress', tabletStyles)).toMatch(/display\s*:\s*grid/)
    expect(appSource).toContain('aria-label={`${label} ${localizedStatus}`}')
    expect(rule('.extraction-choices', tabletStyles)).toMatch(/grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/)
  })

  it('declares narrow-phone artwork and bottom-navigation badge overrides', () => {
    expect(rule('.library-head', narrowPhoneStyles)).toMatch(/grid-template-columns\s*:\s*minmax\(0,1fr\) 76px/)
    expect(rule('.library-head-copy h1', narrowPhoneStyles)).toMatch(/font-size\s*:\s*33px/)
    expect(rule('.product-soon')).toMatch(/right\s*:\s*2px/)
    expect(rule('.product-soon')).toMatch(/left\s*:\s*auto/)
    expect(rule('.product-soon')).toMatch(/top\s*:\s*2px/)
  })

  it('declares reduced decorative heights for short phone viewports', () => {
    expect(rule('.welcome-hero', shortPhoneStyles)).toMatch(/min-height\s*:\s*340px/)
    expect(rule('.coming-soon-art', shortPhoneStyles)).toMatch(/min-height\s*:\s*190px/)
    expect(rule('.coming-soon-art', shortPhoneStyles)).toMatch(/max-height\s*:\s*220px/)
  })

  it('keeps form controls readable without triggering iOS focus zoom', () => {
    const formControls = rule('input,select,textarea')
    const normalizedFormControls = rule('input,select,textarea', supplementalMobileStyles)
    const nativeVoiceSelect = rule('.voice-select-control select', supplementalMobileStyles)
    const visibleVoiceValue = rule('.voice-select-control > span', supplementalMobileStyles)

    expect(workflowStyles).toMatch(/--font-sans\s*:\s*"Avenir Next",\s*Avenir,\s*"Segoe UI",\s*system-ui,\s*sans-serif/)
    expect(formControls).toMatch(/font-size\s*:\s*16px\s*!important/)
    expect(normalizedFormControls).toMatch(/font-family\s*:\s*var\(--font-sans\)\s*!important/)
    expect(normalizedFormControls).toMatch(/font-weight\s*:\s*400\s*!important/)
    expect(normalizedFormControls).toMatch(/letter-spacing\s*:\s*0/)
    expect(normalizedFormControls).toMatch(/text-transform\s*:\s*none/)
    expect(nativeVoiceSelect).toMatch(/position\s*:\s*absolute/)
    expect(nativeVoiceSelect).toMatch(/opacity\s*:\s*0/)
    expect(visibleVoiceValue).toMatch(/font\s*:\s*400 14px\/1 var\(--font-sans\)/)
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
