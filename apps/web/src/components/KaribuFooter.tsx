"use client";

import Image from "next/image";

export function KaribuFooter({ className }: { className?: string }) {
  const year = new Date().getFullYear();

  return (
    <footer className={["flex items-center justify-center gap-1.5 py-3 text-[11px] text-muted-foreground/50 select-none", className].filter(Boolean).join(" ")}>
      <span>Powered by</span>
      <span className="relative inline-flex w-14 h-4 shrink-0">
        <Image
          src="/logo-light.png"
          alt="Karibu"
          fill
          className="block dark:hidden object-contain object-left"
          unoptimized
        />
        <Image
          src="/logo-dark.png"
          alt="Karibu"
          fill
          className="hidden dark:block object-contain object-left"
          unoptimized
        />
      </span>
      <span>·</span>
      <span>© {year}</span>
    </footer>
  );
}
