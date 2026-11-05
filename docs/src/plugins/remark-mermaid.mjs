// @ts-check
import { visit } from "unist-util-visit";

/**
 * Turns ```mermaid fenced blocks into `<pre class="mermaid">` elements so that
 * Expressive Code leaves them alone and the client-side script in
 * `public/mermaid-init.js` can render them in the browser.
 *
 * @returns {(tree: import("mdast").Root) => void}
 */
export function remarkMermaid() {
  return (tree) => {
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== "mermaid" || parent === undefined || index === undefined) {
        return;
      }
      const escaped = node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      /** @type {import("mdast").Html} */
      const html = { type: "html", value: `<pre class="mermaid">${escaped}</pre>` };
      parent.children.splice(index, 1, html);
    });
  };
}
