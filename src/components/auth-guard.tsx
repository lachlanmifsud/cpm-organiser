"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";

const PUBLIC_ROUTES = new Set(["/login"]);

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentUser, isAuthLoading } = useAuth();

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!currentUser && !PUBLIC_ROUTES.has(pathname)) {
      router.replace("/login");
      return;
    }

    if (currentUser && pathname === "/login") {
      router.replace("/");
    }
  }, [currentUser, isAuthLoading, pathname, router]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-400">Checking Session...</p>
      </div>
    );
  }

  if (!currentUser && !PUBLIC_ROUTES.has(pathname)) {
    return null;
  }

  if (currentUser && pathname === "/login") {
    return null;
  }

  return <>{children}</>;
}
