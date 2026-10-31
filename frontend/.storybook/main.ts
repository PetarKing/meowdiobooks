import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: process.env.STORYBOOK_BASELINE_ROOT ? ["../stories/Product.stories.tsx"] : ["../stories/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  async viteFinal(config) {
    // The parity runner redirects only production source to an immutable git archive.
    // Fixtures, stories and dependencies are identical in the two renders.
    const baseline = process.env.STORYBOOK_BASELINE_ROOT;
    config.cacheDir = baseline ? path.join(baseline, ".vite") : process.env.VITEST ? "node_modules/.vite-storybook-tests" : "node_modules/.vite-storybook";
    if (baseline) {
      const source = path.resolve("src");
      config.plugins = [...(config.plugins ?? []), {
        name: "accepted-source-parity",
        enforce: "pre",
        async resolveId(id, importer) {
          if (!importer || !id.startsWith(".")) return;
          const resolved = path.resolve(path.dirname(importer.split("?")[0]), id);
          if (!resolved.startsWith(source + path.sep)) return;
          return this.resolve(path.join(baseline, "src", path.relative(source, resolved)), importer, { skipSelf: true });
        },
      }];
    }
    // Never inherit the application's real API proxy in a fixture preview.
    config.resolve = { ...config.resolve, dedupe: ["react", "react-dom"] };
    config.server = { ...config.server, proxy: {} };
    return config;
  },
};
export default config;
