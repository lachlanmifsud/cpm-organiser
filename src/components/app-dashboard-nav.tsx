"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/clients", label: "Clients", Icon: Users },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

export function AppDashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="flex flex-wrap gap-2 border-b border-[#E6E9EF] pb-4"
    >
      {links.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-150",
              active
                ? "bg-[#0073EA] text-white shadow-sm"
                : "text-[#323338] hover:bg-[#F5F6F8]",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
