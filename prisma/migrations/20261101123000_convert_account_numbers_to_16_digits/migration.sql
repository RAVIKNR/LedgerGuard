-- Enable cryptographically secure random bytes for account-number backfill.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Remove the UUID default before converting the existing values.
ALTER TABLE "accounts" ALTER COLUMN "account_number" DROP DEFAULT;

-- Replace legacy UUID-shaped values in place without changing account IDs or relationships.
DO $$
DECLARE
    account_row RECORD;
    candidate TEXT;
    digit INTEGER;
BEGIN
    FOR account_row IN SELECT "id" FROM "accounts" ORDER BY "id" LOOP
        LOOP
            candidate := '';
            FOR digit IN 1..16 LOOP
                candidate := candidate || (get_byte(gen_random_bytes(1), 0) % 10)::TEXT;
            END LOOP;

            BEGIN
                UPDATE "accounts"
                SET "account_number" = candidate
                WHERE "id" = account_row."id";
                EXIT;
            EXCEPTION
                WHEN unique_violation THEN
                    NULL;
            END;
        END LOOP;
    END LOOP;
END $$;

ALTER TABLE "accounts"
    ALTER COLUMN "account_number" TYPE VARCHAR(16),
    ALTER COLUMN "account_number" SET NOT NULL;

ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_account_number_format_check"
    CHECK ("account_number" ~ '^[0-9]{16}$');
