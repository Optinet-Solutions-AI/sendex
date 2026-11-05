import { Hono } from "hono";

export type Bindings = {
  SENDEX_VERSION: string;
  LINKS?: KVNamespace;
};

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, version: c.env.SENDEX_VERSION ?? "dev" }));

// Short link redirect and click capture land in D2-11 and D2-12.
app.get("/:code", (c) => c.text("Not found", 404));

export default app;
