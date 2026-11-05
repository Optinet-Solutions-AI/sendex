/** Unauthenticated liveness probe for Vercel and uptime checks. */
export function GET() {
  return Response.json({ ok: true, service: "web" });
}
