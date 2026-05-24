import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  side?: "left" | "right";
  panelClassName?: string;
  contentClassName?: string;
}

export function Sheet({
  isOpen,
  onClose,
  title,
  children,
  side = "right",
  panelClassName,
  contentClassName,
}: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#323338]/30 backdrop-blur-[1px] transition-opacity duration-150",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        ref={sheetRef}
        className={cn(
          "fixed top-0 z-50 h-full w-full max-w-md border-[#D0D4E4] bg-white text-[#323338] shadow-monday-2 transition-transform duration-150 ease-in-out",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          isOpen
            ? "translate-x-0"
            : side === "right"
              ? "translate-x-full"
              : "-translate-x-full",
          panelClassName,
        )}
      >
        <div className="flex items-center justify-between border-b border-[#E6E9EF] px-6 py-4">
          {title && <h2 className="text-lg font-semibold text-[#323338]">{title}</h2>}
          {!title && <div />}
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md p-2 text-[#676879] transition-colors duration-150 hover:bg-[#F5F6F8] active:scale-[0.97]"
            aria-label="Close sheet"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={cn("h-[calc(100%-4rem)] overflow-y-auto px-6 py-4", contentClassName)}>
          {children}
        </div>
      </div>
    </>
  );
}
