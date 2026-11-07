CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "messages_org_sent_idx" ON "messages" USING btree ("organisation_id","sent_at");--> statement-breakpoint
CREATE INDEX "postbacks_message_idx" ON "postbacks" USING btree ("message_id");