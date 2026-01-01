CREATE TABLE "ai_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"player_id" integer,
	"data" jsonb DEFAULT '{}'::jsonb,
	"updated_turn" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"turn" integer NOT NULL,
	"attacker_id" integer,
	"defender_id" integer,
	"tile_id" integer,
	"city_id" integer,
	"attacker_troops" jsonb,
	"defender_troops" jsonb,
	"attacker_strategy" text,
	"defender_strategy" text,
	"result" text DEFAULT 'pending',
	"attacker_losses" jsonb,
	"defender_losses" jsonb,
	"llm_response" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"city_id" integer,
	"building_type" text NOT NULL,
	"level" integer DEFAULT 1,
	"is_constructing" boolean DEFAULT false,
	"turns_remaining" integer DEFAULT 0,
	"hp" integer DEFAULT 100,
	"max_hp" integer DEFAULT 100,
	"effect_json" jsonb,
	"restriction" text
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"sender_id" integer,
	"channel" text DEFAULT 'global' NOT NULL,
	"target_id" integer,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"name" text NOT NULL,
	"name_ko" text NOT NULL,
	"nation_id" text,
	"grade" text NOT NULL,
	"owner_id" integer,
	"center_tile_id" integer,
	"population" integer DEFAULT 1000,
	"happiness" integer DEFAULT 70,
	"gold" integer DEFAULT 5000,
	"food" integer DEFAULT 3000,
	"tax_rate" integer DEFAULT 10,
	"spy_power" integer DEFAULT 0,
	"defense_level" integer DEFAULT 0,
	"is_capital" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "diplomacy" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"player1_id" integer,
	"player2_id" integer,
	"status" text DEFAULT 'neutral' NOT NULL,
	"favorability" integer DEFAULT 50,
	"last_changed" timestamp DEFAULT now(),
	"pending_status" text,
	"pending_requester_id" integer,
	"pending_turn" integer
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"user_id" integer,
	"nation_id" text,
	"color" text DEFAULT '#3b82f6',
	"gold" integer DEFAULT 10000,
	"food" integer DEFAULT 5000,
	"troops" integer DEFAULT 0,
	"score" integer DEFAULT 0,
	"espionage_power" integer DEFAULT 50,
	"is_ai" boolean DEFAULT false,
	"ai_difficulty" text,
	"is_ready" boolean DEFAULT false,
	"is_abandoned" boolean DEFAULT false,
	"abandoned_at" timestamp,
	"last_seen_at" timestamp DEFAULT now(),
	"is_eliminated" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "game_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host_id" integer,
	"max_players" integer DEFAULT 20,
	"min_players" integer DEFAULT 2,
	"turn_duration" integer DEFAULT 45,
	"current_turn" integer DEFAULT 0,
	"turn_end_time" timestamp,
	"phase" text DEFAULT 'lobby',
	"victory_condition" text DEFAULT 'domination',
	"map_mode" text DEFAULT 'random',
	"map_width" integer DEFAULT 50,
	"map_height" integer DEFAULT 30,
	"ai_player_count" integer DEFAULT 0,
	"ai_difficulty" text,
	"created_at" timestamp DEFAULT now(),
	"last_active_at" timestamp DEFAULT now(),
	"inactive_since" timestamp
);
--> statement-breakpoint
CREATE TABLE "hex_tiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"q" integer NOT NULL,
	"r" integer NOT NULL,
	"terrain" text NOT NULL,
	"owner_id" integer,
	"city_id" integer,
	"troops" integer DEFAULT 0,
	"specialty_type" text,
	"is_explored" boolean DEFAULT false,
	"fog_of_war" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"turn" integer NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'global' NOT NULL,
	"involved_player_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"city_id" integer,
	"specialty_type" text NOT NULL,
	"amount" integer DEFAULT 0,
	"rarity" text
);
--> statement-breakpoint
CREATE TABLE "spies" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"player_id" integer,
	"location_type" text DEFAULT 'tile' NOT NULL,
	"location_id" integer,
	"mission" text DEFAULT 'idle' NOT NULL,
	"experience" integer DEFAULT 0,
	"level" integer DEFAULT 1,
	"detection_chance" integer DEFAULT 20,
	"is_alive" boolean DEFAULT true,
	"created_turn" integer NOT NULL,
	"last_active_turn" integer
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"proposer_id" integer,
	"responder_id" integer,
	"status" text DEFAULT 'proposed' NOT NULL,
	"offer_gold" integer DEFAULT 0,
	"offer_food" integer DEFAULT 0,
	"offer_specialty_type" text,
	"offer_specialty_amount" integer DEFAULT 0,
	"offer_unit_type" text,
	"offer_unit_amount" integer DEFAULT 0,
	"request_gold" integer DEFAULT 0,
	"request_food" integer DEFAULT 0,
	"request_specialty_type" text,
	"request_specialty_amount" integer DEFAULT 0,
	"request_unit_type" text,
	"request_unit_amount" integer DEFAULT 0,
	"proposed_turn" integer NOT NULL,
	"resolved_turn" integer
);
--> statement-breakpoint
CREATE TABLE "turn_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"player_id" integer,
	"turn" integer NOT NULL,
	"action_type" text NOT NULL,
	"data" jsonb,
	"resolved" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"owner_id" integer,
	"tile_id" integer,
	"city_id" integer,
	"unit_type" text NOT NULL,
	"count" integer DEFAULT 0,
	"experience" integer DEFAULT 0,
	"morale" integer DEFAULT 100
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ai_memory" ADD CONSTRAINT "ai_memory_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memory" ADD CONSTRAINT "ai_memory_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_attacker_id_game_players_id_fk" FOREIGN KEY ("attacker_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_defender_id_game_players_id_fk" FOREIGN KEY ("defender_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_tile_id_hex_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."hex_tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_game_players_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_owner_id_game_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diplomacy" ADD CONSTRAINT "diplomacy_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diplomacy" ADD CONSTRAINT "diplomacy_player1_id_game_players_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diplomacy" ADD CONSTRAINT "diplomacy_player2_id_game_players_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diplomacy" ADD CONSTRAINT "diplomacy_pending_requester_id_game_players_id_fk" FOREIGN KEY ("pending_requester_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rooms" ADD CONSTRAINT "game_rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_tiles" ADD CONSTRAINT "hex_tiles_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hex_tiles" ADD CONSTRAINT "hex_tiles_owner_id_game_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spies" ADD CONSTRAINT "spies_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spies" ADD CONSTRAINT "spies_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_proposer_id_game_players_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_responder_id_game_players_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_actions" ADD CONSTRAINT "turn_actions_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_actions" ADD CONSTRAINT "turn_actions_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_game_id_game_rooms_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_owner_id_game_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."game_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tile_id_hex_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."hex_tiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;