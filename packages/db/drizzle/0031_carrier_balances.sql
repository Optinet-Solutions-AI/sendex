CREATE TABLE "carrier_balances" (
	"provider" text PRIMARY KEY NOT NULL,
	"balance_micro" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"reported_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL
);
