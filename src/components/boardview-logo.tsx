import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import type { HTMLAttributes } from "react";

export function BoardViewLogo(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2", props.className)} {...props}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
        <Users className="h-5 w-5 text-primary-foreground" />
      </div>
      <span className="font-headline text-xl font-bold text-primary">
        BoardView
        <span className="ml-1.5 rounded-md bg-accent/30 px-1.5 py-0.5 text-sm font-semibold text-primary">
          AI
        </span>
      </span>
    </div>
  );
}
