"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { mondayStatusClass } from "@/lib/monday-theme";
import { JobWorkflowStatus } from "@/types/database";

interface StatusDropdownProps {
  status: JobWorkflowStatus;
  onStatusChange: (status: JobWorkflowStatus) => void;
  disabled?: boolean;
}

const STATUS_OPTIONS: Array<{ value: JobWorkflowStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "quoted", label: "Quoted" },
  { value: "in-progress", label: "In Progress" },
  { value: "invoiced", label: "Invoiced" },
  { value: "paid", label: "Paid" },
];

const MENU_GAP = 4;
const MENU_MARGIN = 8;
const ESTIMATED_MENU_HEIGHT = STATUS_OPTIONS.length * 40 + 8;

function computeMenuPosition(trigger: DOMRect, menuWidth: number) {
  let top = trigger.bottom + MENU_GAP;
  if (top + ESTIMATED_MENU_HEIGHT > window.innerHeight - MENU_MARGIN) {
    top = Math.max(MENU_MARGIN, trigger.top - ESTIMATED_MENU_HEIGHT - MENU_GAP);
  }

  let left = trigger.left;
  left = Math.max(MENU_MARGIN, Math.min(left, window.innerWidth - menuWidth - MENU_MARGIN));

  return { top, left };
}

export function StatusDropdown({
  status,
  onStatusChange,
  disabled = false,
}: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const width = rect.width;
    const { top, left } = computeMenuPosition(rect, width);
    setMenuPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updateMenuPosition();
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const currentOption = STATUS_OPTIONS.find((opt) => opt.value === status);

  const portalContent =
    isOpen && mounted ? (
      <div
        ref={panelRef}
        role="listbox"
        className="animate-monday-in fixed z-50 overflow-hidden rounded-lg border border-[#D0D4E4] bg-white shadow-monday-2"
        style={{
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
        }}
      >
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={status === option.value}
            onClick={() => {
              onStatusChange(option.value);
              setIsOpen(false);
            }}
            className={cn(
              "w-full px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 ease-in-out hover:bg-[#F5F6F8]",
              status === option.value ? "bg-[#DDF4FF] text-[#0073EA]" : "text-[#323338]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="relative inline-block w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        className={cn(
          "relative inline-flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-sm font-semibold transition-colors duration-150 ease-in-out active:scale-[0.97]",
          mondayStatusClass(status),
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span>{currentOption?.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {mounted && typeof document !== "undefined" ? createPortal(portalContent, document.body) : null}
    </div>
  );
}
