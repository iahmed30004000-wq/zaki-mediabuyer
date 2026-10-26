-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "week" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'code',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lesson_week_idx" ON "Lesson"("week");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_key_week_key" ON "Lesson"("key", "week");

