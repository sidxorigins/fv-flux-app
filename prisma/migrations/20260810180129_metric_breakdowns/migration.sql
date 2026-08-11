-- DropIndex
DROP INDEX "MetricSnapshot_source_scope_metric_grain_periodStart_key";

-- AlterTable
ALTER TABLE "MetricSnapshot" ADD COLUMN     "dimension" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dimensionValue" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "MetricSnapshot_dimension_grain_periodStart_idx" ON "MetricSnapshot"("dimension", "grain", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_source_scope_metric_dimension_dimensionValue_key" ON "MetricSnapshot"("source", "scope", "metric", "dimension", "dimensionValue", "grain", "periodStart");

