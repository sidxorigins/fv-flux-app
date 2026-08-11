-- CreateTable
CREATE TABLE "DisplayToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisplayToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisplayToken_prefix_key" ON "DisplayToken"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "DisplayToken_tokenHash_key" ON "DisplayToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DisplayToken_createdById_idx" ON "DisplayToken"("createdById");

-- AddForeignKey
ALTER TABLE "DisplayToken" ADD CONSTRAINT "DisplayToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

