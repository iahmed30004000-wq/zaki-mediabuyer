import { cn } from "@/lib/utils";

/**
 * A product's name in Arabic, with its code small and faint after it (docs/rebuild-v6/03-look.md §8 rule 10). The name arrives resolved (`src/core/product-name.ts`: the Arabic name, or an Arabic
 * alias); when there is no Arabic name the code IS the name and is written once. The code is Latin, so it is written left to right.
 */
export function ProductName({ name, code, className, codeClassName }: { name: string; code?: string; className?: string; codeClassName?: string }) {
  const showCode = !!code && code !== name;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-baseline gap-x-2", className)}>
      <b className="font-bold text-fg">{name}</b>
      {showCode ? (
        <span dir="ltr" className={cn("text-sm text-fg-muted opacity-70", codeClassName)}>
          {code}
        </span>
      ) : null}
    </span>
  );
}
