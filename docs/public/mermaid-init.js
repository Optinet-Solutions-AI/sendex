// Renders <pre class="mermaid"> blocks in the browser with a pinned Mermaid build.
// Re-renders when the Starlight theme toggle flips between light and dark.
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs";

async function render() {
  const blocks = Array.from(document.querySelectorAll("pre.mermaid"));
  if (blocks.length === 0) {
    return;
  }
  const { default: mermaid } = await import(MERMAID_URL);
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default" });
  for (const block of blocks) {
    if (block.dataset.source === undefined) {
      block.dataset.source = block.textContent ?? "";
    }
    block.removeAttribute("data-processed");
    block.textContent = block.dataset.source;
  }
  await mermaid.run({ nodes: blocks });
}

render();

new MutationObserver((mutations) => {
  if (mutations.some((m) => m.attributeName === "data-theme")) {
    render();
  }
}).observe(document.documentElement, { attributes: true });
