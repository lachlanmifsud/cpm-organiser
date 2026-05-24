"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Copy, Archive, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteJob, duplicateJob, setJobArchived } from "@/lib/firebase/repository";
import { cn } from "@/lib/utils";

const MENU_WIDTH = 192;
const CONFIRM_WIDTH = 224;

interface ActionsMenuProps {
  jobId: string;
  isArchived: boolean;
  onArchiveChange?: () => void;
}

function computePanelPosition(
  trigger: DOMRect,
  panelWidth: number,
  estimatedHeight: number,
): { top: number; left: number } {
  const gap = 4;
  const margin = 8;
  let top = trigger.bottom + gap;
  if (top + estimatedHeight > window.innerHeight - margin) {
    top = Math.max(margin, trigger.top - estimatedHeight - gap);
  }

  let left = trigger.right - panelWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));

  return { top, left };
}

export function ActionsMenu({ jobId, isArchived, onArchiveChange }: ActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelWidth = showDeleteConfirm ? CONFIRM_WIDTH : MENU_WIDTH;
    const estimatedHeight = showDeleteConfirm ? 200 : 160;
    setPanelPos(computePanelPosition(rect, panelWidth, estimatedHeight));
  }, [showDeleteConfirm]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updatePanelPosition();
  }, [isOpen, showDeleteConfirm, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onScrollOrResize = () => updatePanelPosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
      setShowDeleteConfirm(false);
    };

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateJob(jobId),
    onSuccess: () => {
      toast.success("Job duplicated successfully");
      queryClient.invalidateQueries({
        queryKey: ["active-jobs"],
      });
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => setJobArchived(jobId, !isArchived),
    onSuccess: () => {
      toast.success(isArchived ? "Job restored" : "Job archived");
      queryClient.invalidateQueries({
        queryKey: ["active-jobs"],
      });
      queryClient.invalidateQueries({
        queryKey: ["archived-jobs"],
      });
      queryClient.invalidateQueries({
        queryKey: ["completed-jobs"],
      });
      onArchiveChange?.();
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteJob(jobId),
    onSuccess: () => {
      toast.success("Job deleted permanently");
      queryClient.invalidateQueries({
        queryKey: ["active-jobs"],
      });
      queryClient.invalidateQueries({
        queryKey: ["archived-jobs"],
      });
      queryClient.invalidateQueries({
        queryKey: ["completed-jobs"],
      });
      setIsOpen(false);
      setShowDeleteConfirm(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const isLoading =
    duplicateMutation.isPending || archiveMutation.isPending || deleteMutation.isPending;

  const portalContent =
    isOpen && mounted ? (
      <div
        ref={panelRef}
        className={cn(
          "fixed z-[9999] rounded-lg border border-[#D0D4E4] bg-white shadow-monday-2",
          showDeleteConfirm ? "w-56 border-red-500/50 bg-red-950/20 p-4" : "w-48 py-1",
        )}
        style={{
          top: panelPos.top,
          left: panelPos.left,
        }}
      >
        {!showDeleteConfirm ? (
          <>
            <button
              type="button"
              onClick={() => {
                duplicateMutation.mutate();
              }}
              disabled={isLoading}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-[#323338] transition-colors first:rounded-t-lg hover:bg-[#F5F6F8] disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              Duplicate
            </button>

            <button
              type="button"
              onClick={() => {
                archiveMutation.mutate();
              }}
              disabled={isLoading}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-[#323338] transition-colors hover:bg-[#F5F6F8] disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              {isArchived ? "Restore" : "Archive"}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(true);
              }}
              disabled={isLoading}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium text-red-400 transition-colors last:rounded-b-lg hover:bg-red-950/30 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm font-semibold text-[#323338]">Delete this job permanently?</p>
            <p className="mb-4 text-xs text-[#676879]">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  deleteMutation.mutate();
                }}
                disabled={isLoading}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-[#323338] transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isLoading ? "Deleting..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                }}
                disabled={isLoading}
                className="flex-1 rounded-lg bg-[#F5F6F8] px-3 py-2 text-xs font-semibold text-[#323338] transition-colors hover:bg-[#E6E9EF] disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen((open) => {
            const next = !open;
            if (!next) {
              setShowDeleteConfirm(false);
            }
            return next;
          });
        }}
        className="inline-flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-white"
        disabled={isLoading}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="h-5 w-5 text-[#676879]" />
      </button>

      {mounted && typeof document !== "undefined" ? createPortal(portalContent, document.body) : null}
    </div>
  );
}
