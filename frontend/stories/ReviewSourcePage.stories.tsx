import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ReviewSourcePage } from "../src/components/ReviewSourcePage";
import { sourceImage } from "../design-kit/fixtures";

const meta = {
  title: "Workflow/Review original page",
  component: ReviewSourcePage,
  args: { bookId: "synthetic-book", page: 2, pageCount: 3, gateway: { sourcePageImageUrl: () => sourceImage } },
} satisfies Meta<typeof ReviewSourcePage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OriginalPage: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "View original page" }));
    const dialog = await page.findByRole("dialog", { name: "Original PDF page 2" });
    await expect(within(dialog).getByRole("img")).toHaveAttribute("src", sourceImage);
    await userEvent.click(within(dialog).getByRole("button", { name: "Next page →" }));
    await expect(page.getByRole("dialog", { name: "Original PDF page 3" })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Next page →" })).toBeDisabled();
  },
};
export const FailedPage: Story = {
  args: { gateway: { sourcePageImageUrl: () => "data:image/png;base64,invalid" } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "View original page" }));
    await expect(await page.findByRole("alert")).toHaveTextContent("Your review choices are unchanged.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await userEvent.click(page.getByRole("button", { name: "Back to review" }));
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
