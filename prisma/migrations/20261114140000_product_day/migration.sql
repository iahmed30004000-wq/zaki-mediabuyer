-- CreateTable
CREATE TABLE "ProductDay" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2),
    "impressions" INTEGER,
    "linkClicks" INTEGER,
    "pixelPurchases" INTEGER,
    "ordersIn" INTEGER,
    "uniqueCustomers" INTEGER,
    "confirmed" INTEGER,
    "rejected" INTEGER,
    "cancelled" INTEGER,
    "waiting" INTEGER,
    "rejectReasons" JSONB,
    "offerBreakdown" JSONB,
    "aov" DECIMAL(12,2),
    "shippedOrders" INTEGER,
    "shippedPieces" INTEGER,
    "outForDelivery" INTEGER,
    "stuck" INTEGER,
    "delivered" INTEGER,
    "returned" INTEGER,
    "revenueShipped" DECIMAL(12,2),
    "expectedRevenue" DECIMAL(12,2),
    "stockUnits" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductDay_date_idx" ON "ProductDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDay_productCode_date_key" ON "ProductDay"("productCode", "date");

