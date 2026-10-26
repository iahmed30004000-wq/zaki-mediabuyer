/**
 * Seeds (spec 16): product economics and aliases, and the owner account when SEED_OWNER_EMAIL and
 * SEED_OWNER_PASSWORD are set in .env (never in code). Running it twice changes nothing (upserts).
 * Settings are not seeded: their defaults live in src/server/settings.ts until the owner changes one.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SEED_PRODUCTS } from "../src/core/naming";
import { PRODUCTS } from "../src/lib/mock/data";

const db = new PrismaClient();

async function main() {
  for (const p of SEED_PRODUCTS) {
    for (const alias of p.aliases) {
      await db.productAlias.upsert({ where: { productCode_alias: { productCode: p.code, alias } }, create: { productCode: p.code, alias }, update: {} });
    }
  }
  for (const p of PRODUCTS) {
    const data = { name: p.name, market: p.market, price: p.price, unitCost: p.unitCost, deliveryFee: p.delivery, returnFee: p.returnFee, codFeePct: p.codFee, confirmCost: p.confirmCost, stockDays: p.stockDays };
    await db.productEconomics.upsert({ where: { productCode: p.code }, create: { productCode: p.code, ...data }, update: {} });
  }
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (email && password) {
    await db.user.upsert({ where: { email }, create: { email, name: "المالك", role: "OWNER", passwordHash: await bcrypt.hash(password, 12) }, update: {} });
  }
  const counts = { aliases: await db.productAlias.count(), products: await db.productEconomics.count(), users: await db.user.count() };
  console.log("seeded", counts);
}

main().finally(() => db.$disconnect());
