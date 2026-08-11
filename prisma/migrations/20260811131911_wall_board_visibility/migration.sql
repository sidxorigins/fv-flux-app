-- AlterTable
ALTER TABLE "User" ADD COLUMN     "showOnWallBoard" BOOLEAN NOT NULL DEFAULT true;


-- Preserve existing wall-board behaviour: the seeded bootstrap account owns
-- setup tasks and was previously filtered by a hardcoded username list, which
-- this column replaces. Everyone else defaults to visible.
UPDATE "User" SET "showOnWallBoard" = false WHERE "username" = 'admin';
