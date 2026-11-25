ALTER TABLE "organisation_settings" ALTER COLUMN "custom_route_fee_micro" SET DEFAULT 0;--> statement-breakpoint
-- D5-14: no fee on an organisation's own route. The settings rows created so far carry the old
-- EUR 0.01 default (10,000 micro-EUR); nobody chose it, so it goes back to nothing as well.
UPDATE "organisation_settings" SET "custom_route_fee_micro" = 0, "updated_at" = now() WHERE "custom_route_fee_micro" = 10000;
