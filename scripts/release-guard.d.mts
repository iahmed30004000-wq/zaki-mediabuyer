export const PROTECTED_PATHS: RegExp[];
export function protectedChanges(files: string[]): string[];
export function stripSqlComments(sql: string): string;
export function migrationProblems(sql: string): { rule: string; line: number }[];
export function parseAllowList(text: string): Set<string>;
export function checkMigrations(dir: string, allow?: Set<string>): { migration: string; rule: string; line: number }[];
