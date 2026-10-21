import { formatKES } from "@/lib/money";

export function Price({ from, to, className }: { from: number; to: number; className?: string }) {
  return (
    <span className={className}>
      {from !== to && <span className="text-stone">From </span>}
      {formatKES(from)}
    </span>
  );
}
