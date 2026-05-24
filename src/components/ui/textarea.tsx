import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-[#C3C6D4] bg-white px-3 py-2 text-sm text-[#323338] transition-colors duration-150 ease-in-out outline-none placeholder:text-[#676879] focus-visible:border-[#0073EA] focus-visible:ring-3 focus-visible:ring-[#0073EA]/20 disabled:cursor-not-allowed disabled:bg-[#F5F6F8] disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
