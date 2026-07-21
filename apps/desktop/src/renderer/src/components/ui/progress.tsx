import { cn } from "@/lib/utils"

export function Progress({ value = 0, className, ...props }: React.ComponentProps<"div"> & { value?: number }): React.JSX.Element {
  return (
    <div data-slot="progress" className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/15", className)} {...props}>
      <div className="h-full w-full flex-1 bg-primary transition-transform" style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }} />
    </div>
  )
}
