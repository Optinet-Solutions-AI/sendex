CREATE TABLE "list_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"source" text DEFAULT 'file' NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"rows_in_file" integer DEFAULT 0 NOT NULL,
	"valid" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"added_good" integer DEFAULT 0 NOT NULL,
	"added_bad" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"dedup" boolean DEFAULT true NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_imports" ADD CONSTRAINT "list_imports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_imports" ADD CONSTRAINT "list_imports_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_imports_list_idx" ON "list_imports" USING btree ("list_id","created_at");