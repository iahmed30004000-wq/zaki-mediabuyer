-- v6 P11: money in one currency. Additive only (new nullable columns; no row is rewritten).

-- Set by the OMS pull when the product's prices or fees are in a currency with no rate: the money columns of the row are then not to be read.
ALTER TABLE "ProductEconomics" ADD COLUMN IF NOT EXISTS "moneyMissing" TEXT;

-- The currency of a stored spend row. Null on rows written before this column: pushed/pasted rows are dollars, the rest take their ad account's currency (src/core/currency.ts).
ALTER TABLE "InsightDaily" ADD COLUMN IF NOT EXISTS "currency" TEXT;

-- Why a truth row's money is not known ("fx:EGP,SYP" = no exchange rate, "market" = no economics for that market). Null = the figures are whole.
ALTER TABLE "TruthDaily" ADD COLUMN IF NOT EXISTS "spendMissing" TEXT;
ALTER TABLE "TruthDaily" ADD COLUMN IF NOT EXISTS "moneyMissing" TEXT;
