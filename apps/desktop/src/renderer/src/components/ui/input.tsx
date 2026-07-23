import { cn } from "@/lib/utils"

export function Input({ className, type, ...props }: React.ComponentProps<"input">): React.JSX.Element {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background/70 px-3 py-2 text-xs shadow-xs outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/80 selection:bg-primary selection:text-primary-foreground hover:border-ring/25 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}
