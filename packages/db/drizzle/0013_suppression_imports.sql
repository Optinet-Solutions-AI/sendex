CREATE TABLE "suppression_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "country" char(2);--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "suppression_imports" ADD CONSTRAINT "suppression_imports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_import_id_suppression_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."suppression_imports"("id") ON DELETE set null ON UPDATE no action;