import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
  integrations: [mdx()],
  base: "/agent-forge",
  site: "https://yourusername.github.io",
  build: {
    assets: "_assets",
  },
  markdown: {
    shikiConfig: {
      theme: "github-dark",
    },
  },
});
