import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export interface ButtonLinkProps extends ComponentProps<typeof Link>, Omit<VariantProps<typeof buttonVariants>, "block"> {
  block?: boolean;
}

/** A link that looks exactly like a Button (same variants, same sizes). */
export function ButtonLink({ className, variant, size, block, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}
