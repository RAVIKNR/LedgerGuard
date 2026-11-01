/*
  Warnings:

  - You are about to drop the column `legacy_phone_verified_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `legacy_phone_otp_challenges` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "legacy_phone_otp_challenges" DROP CONSTRAINT "legacy_phone_otp_challenges_user_id_fkey";

-- AlterTable
ALTER TABLE "security_notifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transaction_notifications" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "legacy_phone_verified_at",
ALTER COLUMN "password_hash" DROP NOT NULL;

-- DropTable
DROP TABLE "legacy_phone_otp_challenges";
