import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandMark, BrandWordmark } from "../src/components/Brand";
import { PresentationRoot } from "../src/components/PresentationRoot";

function BrandFamily({ appearance = "light" }: { appearance?: "light" | "dark" }) {
  return <PresentationRoot appearance={appearance}>
    <div style={{ padding: 32, background: "var(--canvas)", color: "var(--ink)", display: "grid", gap: 32 }}>
      <BrandWordmark />
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {[16, 24, 40, 128].map(size => <div key={size} style={{ width: size }}><BrandMark compact={size <= 40} /></div>)}
        <div style={{ width: 128 }}><BrandMark boxed /></div>
      </div>
      <div style={{ width: 130 }}><button className="brand" aria-label="Meowdiobooks home"><BrandWordmark /><span className="brand-compact"><BrandMark compact /></span></button></div>
    </div>
  </PresentationRoot>;
}
const meta = { title: "Brand/Heart identity", component: BrandFamily } satisfies Meta<typeof BrandFamily>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = { args: { appearance: "light" } };
export const Dark: Story = { args: { appearance: "dark" } };
