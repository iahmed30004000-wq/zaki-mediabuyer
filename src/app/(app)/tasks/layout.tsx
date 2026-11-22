import { PlaceTabs } from "@/components/shell/place-tabs";

/** المهام: the four ways to look at the work (هلق · جدول اليوم · كل المهام · النتائج) as tabs under the header. */
export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-tour="views">
        <PlaceTabs place="tasks" map="v6" />
      </div>
      {children}
    </>
  );
}
