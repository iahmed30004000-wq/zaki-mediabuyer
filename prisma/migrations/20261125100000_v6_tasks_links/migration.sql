-- v6 · P3 — «/tasks» is a real place now (المهام). It used to be an old address that led to «/inbox» (the decisions), so every alert and notice that was
-- written with the link «/tasks» (or «/tasks#approval») pointed at the decisions: it points there still. Data only — no table, column or index changes, and a
-- second run changes nothing (nothing is left to match).
UPDATE "Alert" SET "href" = '/inbox' WHERE "href" = '/tasks' OR "href" LIKE '/tasks#%';
UPDATE "Notification" SET "href" = '/inbox' WHERE "href" = '/tasks' OR "href" LIKE '/tasks#%';
