/** Monday.com design tokens & shared status styling. */

export const mondayStatusClass = (status: string) => {
  if (status === "new") {
    return "bg-[#0073EA] text-white border-transparent";
  }
  if (status === "quoted") {
    return "bg-[#A25DDC] text-white border-transparent";
  }
  if (status === "in-progress" || status === "in_progress") {
    return "bg-[#FDAB3D] text-[#323338] border-transparent";
  }
  if (status === "invoiced" || status === "partially_paid") {
    return "bg-[#A25DDC] text-white border-transparent";
  }
  if (status === "paid" || status === "completed") {
    return "bg-[#00C875] text-white border-transparent";
  }
  return "bg-[#E2445C] text-white border-transparent";
};

/** Workbench line-item document history badges (invoice vs quote popovers). */
export function lineItemHistoryBadgeClasses(kind: "invoice" | "quote") {
  if (kind === "invoice") {
    return {
      trigger:
        "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#A25DDC]/20 bg-[#A25DDC]/10 px-2 py-1 text-xs font-medium text-[#676879] transition-all hover:border-[#A25DDC]/40 hover:bg-[#A25DDC]/15",
      icon: "size-3.5 text-[#A25DDC]",
      popoverLink:
        "group flex items-center justify-between rounded-md p-1.5 text-left text-xs text-[#A25DDC] transition-colors hover:bg-[#F5F6F8] hover:text-[#A25DDC]",
    };
  }

  return {
    trigger:
      "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#0073EA]/20 bg-[#0073EA]/10 px-2 py-1 text-xs font-medium text-[#676879] transition-all hover:border-[#0073EA]/40 hover:bg-[#0073EA]/15",
    icon: "size-3.5 text-[#0073EA]",
    popoverLink:
      "group flex items-center justify-between rounded-md p-1.5 text-left text-xs text-[#0073EA] transition-colors hover:bg-[#F5F6F8] hover:text-[#0073EA]",
  };
}

export const mondayLineItemStatusClass = (status: string) => {
  if (status === "draft" || status === "pending") {
    return "bg-[#C4C4C4] text-[#323338]";
  }
  if (status === "quoted") {
    return "bg-[#A25DDC] text-white";
  }
  if (status === "invoiced") {
    return "bg-[#0073EA] text-white";
  }
  if (status === "paid") {
    return "bg-[#00C875] text-white";
  }
  return "bg-[#FDAB3D] text-[#323338]";
};
