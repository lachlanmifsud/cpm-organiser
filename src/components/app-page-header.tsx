"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AppDashboardNav } from "@/components/app-dashboard-nav";

type AppPageHeaderProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function AppPageHeader({ title, description, action }: AppPageHeaderProps) {
  return (
    <header className="w-full">
      <div className="flex w-full items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-[#323338]">{title}</h1>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <p className="mb-4 mt-1 block text-sm text-[#676879]">{description}</p>
      <AppDashboardNav />
    </header>
  );
}

export function AppHeaderBackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center rounded-md border border-[#C3C6D4] bg-white px-4 py-2 text-sm font-medium text-[#323338] shadow-sm transition-colors hover:bg-[#F5F6F8]"
    >
      Back to dashboard
    </Link>
  );
}
