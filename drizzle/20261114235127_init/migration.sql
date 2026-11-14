CREATE TABLE "commodities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"description" text,
	"quantity" integer,
	"commodity_type" text,
	"weight_lbs" integer
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" text NOT NULL,
	"review_reasons" text[] NOT NULL,
	"message_id" text NOT NULL,
	"email_subject" text NOT NULL,
	"email_body" text NOT NULL,
	"email_received_at" timestamp with time zone NOT NULL,
	"customer_name" text,
	"reference_number" text,
	"equipment_type" text,
	"rate_amount" numeric(10,2),
	"rate_currency" text,
	"special_instructions" text,
	"raw_extraction" jsonb,
	"prompt_version" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"company_name" text,
	"street" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"window_start" timestamp,
	"window_end" timestamp
);
--> statement-breakpoint
CREATE INDEX "commodities_order_id_idx" ON "commodities" ("order_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_message_id_key" ON "orders" ("message_id");--> statement-breakpoint
CREATE INDEX "stops_order_id_idx" ON "stops" ("order_id");--> statement-breakpoint
ALTER TABLE "commodities" ADD CONSTRAINT "commodities_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;