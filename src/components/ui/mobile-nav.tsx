"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

/** `bagLink` is server-rendered (it reads the bag cookie) and passed in as-is. */
export function MobileNav({ links, bagLink }: { links: { href: string; label: string }[]; bagLink?: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="justify-self-start lg:hidden">
      <button
        type="button"
        className="-ml-2 min-h-11 px-2 text-sm"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="Main" className="absolute inset-x-0 top-16 z-40 border-b border-line bg-ivory px-4 pb-8 pt-2 shadow-[0_12px_24px_-16px_rgba(40,40,33,0.25)] sm:px-6">
          <ul className="divide-y divide-line">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block py-3 font-display text-2xl" onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
            {bagLink && (
              // The link is server-rendered, so it can't take an onClick; its click bubbles here to close the menu.
              <li onClick={() => setOpen(false)}>{bagLink}</li>
            )}
          </ul>
        </nav>
      )}
    </div>
  );
}
