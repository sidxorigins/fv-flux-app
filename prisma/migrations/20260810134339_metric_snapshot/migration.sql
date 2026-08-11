-- CreateEnum
CREATE TYPE "MetricGrain" AS ENUM ('INSTANT', 'DAY');

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "grain" "MetricGrain" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricSnapshot_metric_grain_periodStart_idx" ON "MetricSnapshot"("metric", "grain", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_source_scope_metric_grain_periodStart_key" ON "MetricSnapshot"("source", "scope", "metric", "grain", "periodStart");
