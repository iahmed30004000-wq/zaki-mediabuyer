-- v6 · P8 — the old map is gone (docs/rebuild-v6/02-screens.md §8): «الشغل» became «المهام», «التشغيل» and «المنتجات» became «الأرقام». Every address of the old map redirects to its new
-- home, but an alert or a notice that was written before this release still carries the OLD address: this moves it to the new one, so the link opens the screen directly. Data only — no
-- table, column, index or constraint changes, nothing is deleted, and a second run changes nothing (a link that was already moved no longer matches).
--
-- The query part (`?day=…`) and the hash part (`#…`) of a link are kept. The longer address is moved before the shorter one that would swallow it (`/work/job/<key>/draw` before
-- `/work/job/<key>`). `/tasks` was moved to `/inbox` by v6 · P3 and is not touched here.

-- Alert -------------------------------------------------------------------------------------------------------------------------------------------------------------------
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/job/([^/?#]+)/draw($|[?#])', '/tasks/\1/edit\2') WHERE "href" ~ '^/work/job/[^/?#]+/draw($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/job/([^/?#]+)($|[?#])', '/tasks/\1\2') WHERE "href" ~ '^/work/job/[^/?#]+($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/today($|[?#])', '/tasks/day\1') WHERE "href" ~ '^/work/today($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/tasks($|[?#])', '/tasks/team\1') WHERE "href" ~ '^/work/tasks($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/reports/([^/?#]+)($|[?#])', '/tasks/results/\1\2') WHERE "href" ~ '^/work/reports/[^/?#]+($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work/reports($|[?#])', '/tasks/results\1') WHERE "href" ~ '^/work/reports($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/work($|[?#])', '/tasks/all\1') WHERE "href" ~ '^/work($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/ops/stock($|[?#])', '/numbers/stock\1') WHERE "href" ~ '^/ops/stock($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/ops(/confirm|/shipping)?($|[?#])', '/numbers/ops\2') WHERE "href" ~ '^/ops(/confirm|/shipping)?($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/products/([^/?#]+)($|[?#])', '/numbers/products/\1\2') WHERE "href" ~ '^/products/[^/?#]+($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/products($|[?#])', '/numbers/products\1') WHERE "href" ~ '^/products($|[?#])';
UPDATE "Alert" SET "href" = regexp_replace("href", '^/ads/campaigns($|[?#])', '/ads\1') WHERE "href" ~ '^/ads/campaigns($|[?#])';

-- Notification -------------------------------------------------------------------------------------------------------------------------------------------------------------
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/job/([^/?#]+)/draw($|[?#])', '/tasks/\1/edit\2') WHERE "href" ~ '^/work/job/[^/?#]+/draw($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/job/([^/?#]+)($|[?#])', '/tasks/\1\2') WHERE "href" ~ '^/work/job/[^/?#]+($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/today($|[?#])', '/tasks/day\1') WHERE "href" ~ '^/work/today($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/tasks($|[?#])', '/tasks/team\1') WHERE "href" ~ '^/work/tasks($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/reports/([^/?#]+)($|[?#])', '/tasks/results/\1\2') WHERE "href" ~ '^/work/reports/[^/?#]+($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work/reports($|[?#])', '/tasks/results\1') WHERE "href" ~ '^/work/reports($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/work($|[?#])', '/tasks/all\1') WHERE "href" ~ '^/work($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/ops/stock($|[?#])', '/numbers/stock\1') WHERE "href" ~ '^/ops/stock($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/ops(/confirm|/shipping)?($|[?#])', '/numbers/ops\2') WHERE "href" ~ '^/ops(/confirm|/shipping)?($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/products/([^/?#]+)($|[?#])', '/numbers/products/\1\2') WHERE "href" ~ '^/products/[^/?#]+($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/products($|[?#])', '/numbers/products\1') WHERE "href" ~ '^/products($|[?#])';
UPDATE "Notification" SET "href" = regexp_replace("href", '^/ads/campaigns($|[?#])', '/ads\1') WHERE "href" ~ '^/ads/campaigns($|[?#])';
