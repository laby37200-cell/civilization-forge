CREATE TABLE IF NOT EXISTS "vision_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"granter_id" integer,
	"grantee_id" integer,
	"created_turn" integer DEFAULT 0 NOT NULL,
	"revoked_turn" integer
);

ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "offer_peace_treaty" boolean DEFAULT false;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "offer_share_vision" boolean DEFAULT false;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "offer_city_id" integer;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "offer_spy_id" integer;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "request_peace_treaty" boolean DEFAULT false;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "request_share_vision" boolean DEFAULT false;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "request_city_id" integer;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "request_spy_id" integer;

DO $$ BEGIN
	ALTER TABLE "vision_shares" ADD CONSTRAINT "vision_shares_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "vision_shares" ADD CONSTRAINT "vision_shares_granter_id_game_players_id_fk" FOREIGN KEY ("granter_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "vision_shares" ADD CONSTRAINT "vision_shares_grantee_id_game_players_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "trades" ADD CONSTRAINT "trades_offer_city_id_cities_id_fk" FOREIGN KEY ("offer_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "trades" ADD CONSTRAINT "trades_request_city_id_cities_id_fk" FOREIGN KEY ("request_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
