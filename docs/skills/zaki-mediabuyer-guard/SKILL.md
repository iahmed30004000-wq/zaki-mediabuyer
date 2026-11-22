---
name: zaki-mediabuyer-guard
description: Guards the architecture of «الميديا باير» (Zaki Media Buyer) — the owner's standalone Next.js + Prisma Meta-ads manager for COD at C:\Users\LOQ\Documents\zaki-mediabuyer. Use it before ANY work in that repository — a screen, a number, a rule, a Meta/OMS/Telegram integration, a theme, an image — or whenever the owner (Ahmad / Zaki AI) mentions the media buyer, ميديا باير, ads manager, ChangeSet, truth/الحقيقة, or its themes (إزنيق · المرصد · مدينة الغروب · وُضوح). It supplies the fixed five-place map, the red lines, where numbers come from, the theme and image rules, and the build order, so nothing is duplicated or broken.
---

# Zaki Media Buyer — guard

Reply to the owner in Arabic (simple Jordanian/Syrian), short, non-technical, one example. Code, fields and tables in English.

## The system is standalone
Own folder, own git, own Postgres (`mediabuyer-db`, 127.0.0.1:5450, compose project `mediabuyer`), app on port **3140** (3100 is the OMS and 5440 the Workspace DB on his machine). Nothing shared at runtime with the OMS or Zaki Workspace; code was copied from the Workspace once (theme engine) and evolves here on its own. Read `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` and `docs/PROGRESS.md` first.

## The map — four places + settings (v6 · P8; never add a fifth without the owner)
| Place | Route | Holds |
|---|---|---|
| الرئيسية | `/` | بدّها منك (decisions + stopped runs) · شغّالة هلق · مين شغّال · كنا ← صرنا · الجاي اليوم · آخر النتائج |
| المهام | `/tasks` | tabs: هلق · جدول اليوم `/tasks/day` · كل المهام `/tasks/all` · النتائج `/tasks/results`; also `/tasks/new` · `/tasks/team` (the team's board) · `/tasks/<key>` (+ `/edit`, `/runs/<id>`) |
| الأرقام | `/numbers` | tabs: الخلاصة · المنتجات `/numbers/products` · التأكيد والشحن `/numbers/ops` · المخزون `/numbers/stock` (read only) |
| الإعلانات | `/ads` | tabs: الحملات · الفيديوهات `/ads/videos` · الاختبارات `/ads/tests`; «＋ إطلاق» wizard; links to `/ads/health` and `/ads/scale` |
| الإعدادات | `/settings` | الربط · الفريق والصلاحيات · القواعد · المنتجات · الإشعارات · المظهر · متقدّم |
«بانتظارك» (`/inbox`) is the first section of the home, not a place; «التشغيل» is a tab of «الأرقام». Old addresses (`/work…` `/ops…` `/products…` `/ads/campaigns` `/p/…`) redirect (`LEGACY_REDIRECTS` in `next.config.mjs`) and must never be linked to (`tests/old-routes.test.ts`). The assistant is a button on every page, the kill switch is always in the header. A new feature goes INTO one of these (a tab, a sheet, a card), never a new page beside them. Where the site stands today: `docs/STATE.md`.

## Red lines (spec section 3)
- The code computes every number (`src/core/economics.ts`, Decimal); a model only explains. Spec 17.1 / 17.2 are tests and must stay exact.
- Decisions use OMS truth (confirmed / delivered, mature orders only — `src/core/maturity.ts`), never Meta Purchase alone.
- Every Meta change is a ChangeSet (propose → prepare → simulate → approve → execute → verify → follow-up → rollback). Safety (pause / reduce) is automatic; more spend and creation need approval **on the site**, never from Telegram.
- No customer data to any model; tokens encrypted, never in logs, prompts or the browser.
- Everything is created PAUSED and verified against the template before activation. Every Meta field / endpoint is checked against the docs of the version in use.

## Screens
- Every number shows its source (ميتا · حقيقي · تقدير) and opens «ليش؟» (`<Num term=…>` + `src/lib/glossary.ts`).
- Every page has «؟»: what this page is, the next step, «فرجيني» tour (`src/lib/guide.ts`, `data-tour` attributes).
- Colours only from theme tokens (`src/lib/themes/palettes.ts` → `npm run themes:css`; the contrast gate test must pass). Red is for risk only.
- Decoration only in the four places (door · empty · sidebar · strip) — never behind a number or a table.
- Phone first: no horizontal scroll at 375 px, thumb-size buttons, bottom bar of five slots (الرئيسية · المهام · ＋ · الأرقام · الإعلانات).
- The UI is the kit only (`src/components/ui`): no raw `<button>` `<select>` `<input>` `<textarea>` `<table>` outside it, no `text-xs`, no technical words for the owner, no demo data imported by a screen — the ratchet (`scripts/ui-rules.ts`, `npm run ui:baseline`) is at zero on every metric and never goes up.
- GTA-style touches are ours: autonomy level as stars ★★☆ (`LevelStars`), the «تمّت ✓» banner (`useMission`). Never a game name, logo or screenshot.

## Themes
`iznik` (default, light, Iznik tiles) · `observatory` (dark, astrolabe and brass) · `sunset-city` (dark, real golden-hour photos) · `wudooh` (light, spec 18.1). New palettes must pass `tests/themes-palettes.test.ts`.

## Images — the owner's rule
He prefers that Claude **finds and downloads** freely licensed images (CC0 / public domain — The Met Open Access is ideal — Unsplash, Pexels) instead of writing GPT prompts for him. Ornament that must recolour (masks in `public/brand/decor/`) is drawn in code (SVG → WebP alpha). Art slots are `public/brand/art/<slot>.webp` (names in `ART_SLOTS`, `src/lib/themes/decor.ts`); a missing file hides itself. Every file gets a row in `public/brand/CREDITS.md`. No faces, people, hands, animals, logos, readable text or calligraphy-as-decoration; nothing from games or films.

## Build order
Phase 1 (read + truth + report) → 2 (guard rules, ChangeSets, level 1) → 3 (creatives) → 4 (builder + CAPI) → 5 (agents, level 2) → 6 (polish). Until the owner finishes the prerequisites (Meta app + System User, OMS read API), adapters run against mock servers and screens use `src/lib/mock/data.ts`. One task per session; update `docs/PROGRESS.md`; `npm test` and `npx tsc --noEmit` before every commit.
