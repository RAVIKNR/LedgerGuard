ALTER TABLE "accounts"
ADD COLUMN "outgoing_restriction_until" TIMESTAMP(3);

CREATE INDEX "accounts_outgoing_restriction_until_idx"
ON "accounts"("outgoing_restriction_until");
