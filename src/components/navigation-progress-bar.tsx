"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavigationProgressBar() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "active" | "done">("idle");
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
    }
    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
    }

    setPhase("active");

    completeTimerRef.current = setTimeout(() => {
      setPhase("done");
      fadeTimerRef.current = setTimeout(() => {
        setPhase("idle");
      }, 150);
    }, 320);

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
      }
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
      }
    };
  }, [pathname]);

  if (phase === "idle") {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-0 right-0 left-0 z-[99999] h-[3px] overflow-hidden bg-[#0073EA]/15 transition-opacity duration-150",
        phase === "done" ? "opacity-0" : "opacity-100",
      )}
      aria-hidden
    >
      <div className="h-full w-1/3 animate-loading-bar bg-[#0073EA]" />
    </div>
  );
}
