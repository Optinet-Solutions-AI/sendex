import {
  analyseSmsText,
  expandTestCombos,
  generateSenderId,
  isCustomProvider,
  jitterDelayMs,
  presetText,
  type SenderMode,
  type TextPreset,
} from "@sendex/core";
import type { SmsTestRow as CoreTestRow, TestContext, TestMessageInput } from "@sendex/db";
import type { OutboundMessage, Provider, ProviderRegistry } from "@sendex/providers";
import { UnrecoverableError } from "bullmq";
import type { SmsTestJob } from "../jobs.js";
import type { Logger } from "../log.js";

/**
 * Routes > Testing (D4-06): run one Send Single (or Test SMS) row. One message per sender
 * mode × text option combination and per route (or, with cascade, through the routes in
 * order until one accepts). Every accepted message is recorded with its debit; a failed one
 * is recorded without a charge. Only registry providers (platform routes) are served here;
 * a custom route in the test is recorded as failed with `ROUTE_NOT_SERVABLE`.
 */

export interface TestStore {
  loadTestContext(testId: string): Promise<TestContext | null>;
  recordTestMessage(input: TestMessageInput): Promise<string>;
  finishTest(testId: string, outcome: "done" | "failed"): Promise<void>;
  getBalanceMicro(organisationId: string): Promise<bigint>;
}

export interface RunTestDeps {
  store: TestStore;
  providers: ProviderRegistry;
  log: Logger;
  rng?: () => number;
  /** Replaces the jitter sleep in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunTestResult {
  outcome: "done" | "failed" | "missing";
  sent: number;
  failed: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runSmsTest(deps: RunTestDeps, job: SmsTestJob): Promise<RunTestResult> {
  const { store, log } = deps;
  const rng = deps.rng ?? Math.random;
  const sleep = deps.sleep ?? wait;
  const ctx = await store.loadTestContext(job.testId);
  if (!ctx) throw new UnrecoverableError(`test ${job.testId} not found`);
  if (ctx.test.organisationId !== job.organisationId) {
    throw new UnrecoverableError(`test ${job.testId} does not belong to the job's organisation`);
  }
  const test = ctx.test;
  if (test.type !== "single" || !test.recipient) {
    // Handset tests need a test-network provider, which no environment has yet.
    await store.finishTest(test.id, "failed");
    log("warn", "test skipped: no test-network provider", { testId: test.id, type: test.type });
    return { outcome: "failed", sent: 0, failed: 0 };
  }
  const combos = expandTestCombos({
    senderModes: test.senderModes as SenderMode[],
    textPresets: test.textPresets as TextPreset[],
  });
  let sent = 0;
  let failed = 0;
  for (const combo of combos) {
    if (test.jitter) await sleep(jitterDelayMs(rng));
    const senderId = generateSenderId(combo.senderMode, test.customSender, rng);
    const text = presetText(combo.textPreset, {
      custom: test.customText,
      history: ctx.history,
      rng,
    });
    const analysis = analyseSmsText(text);
    for (const route of ctx.routes) {
      const outcome = await sendOne(deps, ctx, {
        route,
        recipient: test.recipient,
        senderId,
        text,
        encoding: analysis.encoding,
        parts: analysis.parts,
      });
      if (outcome === "sent") sent += 1;
      else failed += 1;
      if (test.cascade && outcome === "sent") break;
    }
  }
  const outcome = sent > 0 || combos.length === 0 ? "done" : "failed";
  await store.finishTest(test.id, outcome);
  log("info", "sms test finished", { testId: test.id, sent, failed, outcome });
  return { outcome, sent, failed };
}

async function sendOne(
  deps: RunTestDeps,
  ctx: TestContext,
  input: {
    route: TestContext["routes"][number];
    recipient: string;
    senderId: string;
    text: string;
    encoding: string;
    parts: number;
  },
): Promise<"sent" | "failed"> {
  const { route } = input;
  const test: CoreTestRow = ctx.test;
  const base: Omit<TestMessageInput, "status" | "providerMessageId" | "errorCode"> = {
    testId: test.id,
    organisationId: test.organisationId,
    routeId: route.id,
    routeOrganisationId: route.organisationId,
    e164: input.recipient,
    senderId: input.senderId,
    text: input.text,
    encoding: input.encoding,
    parts: input.parts,
    priceMicro: route.priceMicro ?? 0n,
    feeMicro: route.organisationId === null ? 0n : ctx.feeMicro,
  };
  const fail = async (errorCode: string): Promise<"failed"> => {
    await deps.store.recordTestMessage({
      ...base,
      status: "failed",
      providerMessageId: null,
      errorCode,
    });
    return "failed";
  };
  if (!route.active) return fail("ROUTE_INACTIVE");
  if (route.priceMicro === null) return fail("NO_PRICE");
  if (isCustomProvider(route.provider) || !deps.providers.has(route.provider)) {
    return fail("ROUTE_NOT_SERVABLE");
  }
  const cost = BigInt(input.parts) * (route.priceMicro + base.feeMicro);
  if ((await deps.store.getBalanceMicro(test.organisationId)) < cost) {
    return fail("INSUFFICIENT_BALANCE");
  }
  const provider: Provider = deps.providers.get(route.provider);
  const message: OutboundMessage = {
    id: `${test.id}:${route.id}:${input.senderId}`,
    to: input.recipient,
    senderId: input.senderId,
    text: input.text,
    encoding: input.encoding === "UCS2" ? "UCS2" : "GSM_7BIT",
    route: route.name,
    country: test.country,
  };
  const [result] = await provider.send([message]);
  if (result?.status === "accepted") {
    await deps.store.recordTestMessage({
      ...base,
      status: "sent",
      providerMessageId: result.providerMessageId,
      errorCode: null,
    });
    return "sent";
  }
  return fail(result ? result.reason : "NO_OUTCOME");
}
