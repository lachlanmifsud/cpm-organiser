"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, FileStack, LogOut } from "lucide-react";
import { AppHeaderBackLink, AppPageHeader } from "@/components/app-page-header";
import { BusinessProfileSettings } from "@/components/settings/business-profile-settings";
import { InvoiceQuoteTemplateSettings } from "@/components/settings/invoice-quote-template-settings";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

type SettingsSection = "business" | "templates";

const navItems: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  Icon: typeof Building2;
}> = [
  {
    id: "business",
    label: "Business information",
    description: "Legal entity, banking, logo",
    Icon: Building2,
  },
  {
    id: "templates",
    label: "Invoice & quote templates",
    description: "Prompts & AI-generated layouts",
    Icon: FileStack,
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<SettingsSection>("business");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const raw = searchParams.get("section");
    if (raw === "business" || raw === "templates") {
      setSection(raw);
    }
  }, [searchParams]);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F5F6F8] text-[#323338]">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col px-6 py-10 lg:px-10">
        <AppPageHeader
          title="Settings"
          description="Global workspace configuration — no longer tied to individual jobs."
          action={<AppHeaderBackLink />}
        />

        <div className="grid gap-8 pt-6 lg:grid-cols-12 lg:items-start">
          <aside className="lg:col-span-3">
            <nav className="flex h-full min-h-[600px] flex-col gap-1 rounded-lg border border-[#E6E9EF] bg-white p-3">
              {navItems.map((item) => {
                const Icon = item.Icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-md border-l-4 px-3 py-3 text-left transition-colors duration-150",
                      active
                        ? "border-[#0073EA] bg-[#DDF4FF] font-semibold text-[#0073EA]"
                        : "border-transparent bg-transparent font-medium text-[#323338] hover:bg-[#F5F6F8]",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Icon
                        className={cn("size-4 shrink-0", active ? "text-[#0073EA]" : "text-[#676879]")}
                        aria-hidden
                      />
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 pl-6 text-xs",
                        active ? "text-[#0073EA]/80" : "text-[#676879]",
                      )}
                    >
                      {item.description}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={() => void handleLogout()}
                className="mt-auto flex items-center gap-2 rounded-md px-4 py-2 font-medium text-[#676879] transition-colors hover:bg-[#FCECEE] hover:text-[#E2445C] disabled:opacity-50"
              >
                <LogOut className="size-4" aria-hidden />
                {isLoggingOut ? "Signing out…" : "Log out"}
              </button>
            </nav>
          </aside>

          <div className="min-w-0 lg:col-span-9">
            {section === "business" ? <BusinessProfileSettings /> : <InvoiceQuoteTemplateSettings />}
          </div>
        </div>
      </div>
    </main>
  );
}
