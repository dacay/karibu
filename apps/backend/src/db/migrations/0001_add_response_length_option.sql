CREATE TYPE "public"."response_length_option" AS ENUM('short', 'medium', 'long');

ALTER TABLE "conversation_patterns"
  ADD COLUMN "response_length_option" "response_length_option" NOT NULL DEFAULT 'medium';
