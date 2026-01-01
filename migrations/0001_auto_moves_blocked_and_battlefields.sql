CREATE TABLE IF NOT EXISTS "battlefields" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"tile_id" integer,
	"state" text DEFAULT 'open' NOT NULL,
	"started_turn" integer NOT NULL,
	"last_resolved_turn" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "battlefield_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"battlefield_id" integer,
	"player_id" integer,
	"role" text NOT NULL,
	"joined_turn" integer NOT NULL,
	"left_turn" integer,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "battlefield_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"battlefield_id" integer,
	"player_id" integer,
	"turn" integer NOT NULL,
	"action_type" text NOT NULL,
	"strategy_text" text,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);

ALTER TABLE "auto_moves" ADD COLUMN IF NOT EXISTS "blocked_reason" text;
ALTER TABLE "auto_moves" ADD COLUMN IF NOT EXISTS "blocked_tile_id" integer;
ALTER TABLE "auto_moves" ADD COLUMN IF NOT EXISTS "blocked_turn" integer;

DO $$ BEGIN
	ALTER TABLE "battlefields" ADD CONSTRAINT "battlefields_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefields" ADD CONSTRAINT "battlefields_tile_id_hex_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."hex_tiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_participants" ADD CONSTRAINT "battlefield_participants_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_participants" ADD CONSTRAINT "battlefield_participants_battlefield_id_battlefields_id_fk" FOREIGN KEY ("battlefield_id") REFERENCES "public"."battlefields"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_participants" ADD CONSTRAINT "battlefield_participants_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_actions" ADD CONSTRAINT "battlefield_actions_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_actions" ADD CONSTRAINT "battlefield_actions_battlefield_id_battlefields_id_fk" FOREIGN KEY ("battlefield_id") REFERENCES "public"."battlefields"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "battlefield_actions" ADD CONSTRAINT "battlefield_actions_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "auto_moves" ADD CONSTRAINT "auto_moves_blocked_tile_id_hex_tiles_id_fk" FOREIGN KEY ("blocked_tile_id") REFERENCES "public"."hex_tiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
