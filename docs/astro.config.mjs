// @ts-check
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { remarkMermaid } from "./src/plugins/remark-mermaid.mjs";

export default defineConfig({
  markdown: {
    // Astro 7 defaults to the Sätteri processor; remark plugins need the unified one.
    processor: unified({ remarkPlugins: [remarkMermaid] }),
  },
  integrations: [
    starlight({
      title: "Sendex",
      description: "User guide and engineering docs for the Sendex bulk SMS platform.",
      head: [
        // Client-side Mermaid rendering; see docs/README.md for why.
        { tag: "script", attrs: { type: "module", src: "/mermaid-init.js" } },
      ],
      sidebar: [
        {
          label: "Using Sendex",
          items: [
            { label: "Upload a list", slug: "using/upload-a-list" },
            { label: "Create a campaign", slug: "using/create-a-campaign" },
            { label: "Send and scale", slug: "using/send-and-scale" },
            { label: "Schedule and stop", slug: "using/schedule-and-stop" },
            { label: "Read the results", slug: "using/read-the-results" },
          ],
        },
        {
          label: "Engineering",
          items: [
            { label: "Architecture", slug: "engineering/architecture" },
            { label: "Services and queues", slug: "engineering/services-and-queues" },
            { label: "Adding a provider", slug: "engineering/adding-a-provider" },
            {
              label: "Runbooks",
              items: [{ label: "Local setup", slug: "engineering/runbooks/local-setup" }],
            },
          ],
        },
        {
          label: "Decisions",
          items: [{ autogenerate: { directory: "decisions" } }],
        },
      ],
    }),
  ],
});
