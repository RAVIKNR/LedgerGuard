ALTER TABLE "transfers"
ADD COLUMN "review_deadline_at" TIMESTAMP(3);

CREATE INDEX "transfers_status_review_deadline_at_idx"
ON "transfers"("status", "review_deadline_at");

ALTER TABLE "transaction_notifications"
ADD COLUMN "review_deadline_at" TIMESTAMP(3);
