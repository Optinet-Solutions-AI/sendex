"use server";

import {
  customRouteSchema,
  priceEurToMicro,
  routePriceInputSchema,
  routingExceptionSchema,
  routingStrategySchema,
  smsTestSchema,
} from "@sendex/core";
import {
  createCustomRoute,
  createSmsTest,
  db,
  deleteCustomRoute,
  deleteRoutingException,
  orderedRoutesForCountry,
  recordAudit,
  removeSmsTest,
  setCustomRouteActive,
  setCustomRoutePrices,
  setRoutingStrategy,
  updateCustomRoute,
  upsertRoutingException,
} from "@sendex/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireAction } from "../../../lib/auth";
import { assertCountryOpen } from "../../../lib/open-countries";
import { routeSecretKey } from "../../../lib/route-secret";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    }
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: "Something went wrong" };
  }
}

const uuid = z.uuid();

function key(): Buffer {
  try {
    return routeSecretKey();
  } catch {
    throw new Error(
      "CUSTOM_ROUTE_SECRET_KEY is not set on the web app, so route credentials cannot be stored.",
    );
  }
}

function revalidateRoutes(): void {
  revalidatePath("/routes/custom");
  revalidatePath("/routes/platform");
  revalidatePath("/routes/testing");
}

// ---------------------------------------------------------------------------
// Custom routes
// ---------------------------------------------------------------------------

export async function createCustomRouteAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const data = customRouteSchema.parse(input);
    const row = await createCustomRoute(db(), ctx.organisationId, data, key());
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "route.create",
      targetType: "route",
      targetId: row.id,
      details: { name: data.name, type: data.type },
    });
    revalidateRoutes();
    return row;
  });
}

export async function updateCustomRouteAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const { routeId, ...rest } = z.object({ routeId: uuid }).passthrough().parse(input);
    const data = customRouteSchema.parse(rest);
    const ok = await updateCustomRoute(db(), ctx.organisationId, routeId, data, key());
    if (!ok) throw new Error("Route not found");
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "route.update",
      targetType: "route",
      targetId: routeId,
      details: { name: data.name, type: data.type },
    });
    revalidateRoutes();
    return null;
  });
}

export async function setCustomRouteActiveAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const { routeId, active } = z.object({ routeId: uuid, active: z.boolean() }).parse(input);
    if (!(await setCustomRouteActive(db(), ctx.organisationId, routeId, active))) {
      throw new Error("Route not found");
    }
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: active ? "route.enable" : "route.disable",
      targetType: "route",
      targetId: routeId,
    });
    revalidateRoutes();
    return null;
  });
}

export async function deleteCustomRouteAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const { routeId } = z.object({ routeId: uuid }).parse(input);
    if (!(await deleteCustomRoute(db(), ctx.organisationId, routeId))) {
      throw new Error("Route not found");
    }
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "route.delete",
      targetType: "route",
      targetId: routeId,
    });
    revalidateRoutes();
    return null;
  });
}

export async function setCustomRoutePricesAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const { routeId, prices } = z
      .object({ routeId: uuid, prices: z.array(routePriceInputSchema).max(250) })
      .parse(input);
    const seen = new Set<string>();
    for (const p of prices) {
      if (seen.has(p.country)) throw new Error(`${p.country} is listed twice`);
      seen.add(p.country);
    }
    const ok = await setCustomRoutePrices(
      db(),
      ctx.organisationId,
      routeId,
      prices.map((p) => ({ country: p.country, priceMicro: priceEurToMicro(p.priceEur) })),
    );
    if (!ok) throw new Error("Route not found");
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "route.prices",
      targetType: "route",
      targetId: routeId,
      details: { countries: prices.map((p) => p.country) },
    });
    revalidateRoutes();
    return null;
  });
}

// ---------------------------------------------------------------------------
// Routing configuration
// ---------------------------------------------------------------------------

export async function setRoutingStrategyAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const strategy = routingStrategySchema.parse(input);
    await setRoutingStrategy(db(), ctx.organisationId, strategy);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "routing.strategy",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: { strategy },
    });
    revalidateRoutes();
    return null;
  });
}

export async function upsertRoutingExceptionAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const data = routingExceptionSchema.parse(input);
    await upsertRoutingException(db(), ctx.organisationId, data);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: "routing.exception",
      targetType: "organisation",
      targetId: ctx.organisationId,
      details: {
        country: data.country,
        locked: data.lockedRoute,
        disabled: data.disabledRoutes.length,
      },
    });
    revalidateRoutes();
    return null;
  });
}

export async function deleteRoutingExceptionAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("route.manage");
    const { country } = z.object({ country: z.string().length(2) }).parse(input);
    await deleteRoutingException(db(), ctx.organisationId, country);
    revalidateRoutes();
    return null;
  });
}

// ---------------------------------------------------------------------------
// Testing
// ---------------------------------------------------------------------------

export interface RouteChoice {
  id: string;
  name: string;
  platform: boolean;
  priceMicro: string | null;
}

/** The routes of a country in routing order, for the Send Single dialog. */
export async function routesForCountryAction(input: unknown): Promise<ActionResult<RouteChoice[]>> {
  return run(async () => {
    const ctx = await requireAction("route.view");
    const country = z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .parse(input);
    const options = await orderedRoutesForCountry(db(), ctx.organisationId, country);
    return options.map((o) => ({
      id: o.id,
      name: o.platform ? `Route ${o.name}` : o.name,
      platform: o.platform,
      priceMicro: o.priceMicro === null ? null : o.priceMicro.toString(),
    }));
  });
}

export async function createSmsTestAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireAction("test.send");
    const data = smsTestSchema.parse(input);
    assertCountryOpen(data.country);
    const row = await createSmsTest(db(), ctx.organisationId, data, ctx.userId);
    await recordAudit(db(), ctx.organisationId, {
      actorUserId: ctx.userId,
      action: data.type === "single" ? "test.single" : "test.handset",
      targetType: "sms_test",
      targetId: row.id,
      details: {
        country: data.country,
        routes: data.routeIds.length,
        scheduled: data.schedule !== null,
      },
    });
    revalidateRoutes();
    return { id: row.id };
  });
}

export async function removeSmsTestAction(input: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireAction("test.send");
    const { id } = z.object({ id: uuid }).parse(input);
    if (!(await removeSmsTest(db(), ctx.organisationId, id))) throw new Error("Test not found");
    revalidateRoutes();
    return null;
  });
}
