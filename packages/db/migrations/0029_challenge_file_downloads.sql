CREATE TABLE "challenge_file_downloads" (
	"user_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"first_downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_file_downloads_user_id_challenge_id_pk" PRIMARY KEY("user_id","challenge_id")
);
