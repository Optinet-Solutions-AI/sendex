import { z } from "zod";

/**
 * Schemas of the worker's internal HTTP API (`/internal/*`), shared with the web app
 * so both sides validate the same shape. See docs/engineering/sending-engine.md.
 */

const nonEmpty = z.string().min(1);

export const lapModeSchema = z.enum(["finish", "budget"]);
export type LapMode = z.infer<typeof lapModeSchema>;

const lapRequestBase = {
  organisationId: nonEmpty,
  campaignId: nonEmpty,
  listId: nonEmpty,
  routeId: nonEmpty,
};

/** `POST /internal/laps`: queue a Finish List lap or a budget lap for one list and route. */
export const createLapRequestSchema = z.discriminatedUnion("mode", [
  z.object({ ...lapRequestBase, mode: z.literal("finish") }),
  z.object({
    ...lapRequestBase,
    mode: z.literal("budget"),
    /** Budget in micro-EUR; the lap sends as many messages as it buys at the route price. */
    budgetMicro: z.number().int().positive(),
  }),
]);
export type CreateLapRequest = z.infer<typeof createLapRequestSchema>;
