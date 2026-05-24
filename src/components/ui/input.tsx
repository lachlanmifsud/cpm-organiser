import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-[#C3C6D4] bg-white px-3 py-1 text-sm text-[#323338] transition-colors duration-150 ease-in-out outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#676879] focus-visible:border-[#0073EA] focus-visible:ring-3 focus-visible:ring-[#0073EA]/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#F5F6F8] disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
