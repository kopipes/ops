"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type ComponentProps } from "react";

/** Keep the current screen usable while fresh, authenticated navigation loads. */
export function NavigationLink({ children, onClick, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <><Link {...props} className={`${props.className ?? ""} relative`} prefetch={false} aria-busy={pending || undefined} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.download !== undefined && props.download !== false) || (props.target && props.target !== "_self")) return;
    if (typeof props.href !== "string" || !props.href.startsWith("/") || props.href.startsWith("//")) return;
    event.preventDefault();
    startTransition(() => {
      const navigate = props.replace ? router.replace : router.push;
      navigate(props.href as string, { scroll: props.scroll });
    });
  }}>
    {children}
    {pending ? <span aria-hidden="true" className="absolute right-2 top-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
  </Link>{pending ? <span role="status" className="sr-only">Memuat halaman</span> : null}</>;
}
