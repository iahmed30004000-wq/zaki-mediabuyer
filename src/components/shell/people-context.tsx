"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { PEOPLE, assigneeName } from "@/core/tasks";

export interface PersonOption {
  key: string;
  label: string;
}

const FALLBACK: PersonOption[] = PEOPLE.map((p) => ({ key: p.key, label: p.label }));
const Ctx = createContext<PersonOption[]>(FALLBACK);

/** The people of the team directory (docs/rebuild/05-permissions.md §4), read once by the layout. A name is data: a new person appears here without a code change. */
export function PeopleProvider({ people, children }: { people: PersonOption[]; children: ReactNode }) {
  return <Ctx.Provider value={people.length ? people : FALLBACK}>{children}</Ctx.Provider>;
}

export const usePeople = (): PersonOption[] => useContext(Ctx);

/** key → the name to show (the directory's, then the one the code always had, then the key). */
export function usePersonName(): (key: string | null | undefined) => string | null {
  const people = useContext(Ctx);
  return useCallback((key) => (key ? people.find((p) => p.key === key)?.label ?? assigneeName(key) ?? key : null), [people]);
}
