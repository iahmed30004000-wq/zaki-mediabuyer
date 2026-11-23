export const SMOKE_PAGES: string[];
export const BAD_TEXT: string[];
export function judgePage(a: { status: number; body?: string; location?: string | null }): string | null;
export function cookieHeader(setCookies: string[]): string;
export function isLocalBase(url: string): boolean;
export function runSmoke(a: {
  base: string;
  email: string;
  password: string;
  pages?: string[];
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; results: { path: string; problem: string | null }[] }>;
