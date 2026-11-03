ALTER TABLE "transaction_notifications"
ADD COLUMN "next_attempt_at" TIMESTAMP(3);

CREATE INDEX "transaction_notifications_status_next_attempt_at_idx"
ON "transaction_notifications"("status", "next_attempt_at");
