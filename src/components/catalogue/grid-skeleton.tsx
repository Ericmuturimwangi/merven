export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="aspect-[4/5] bg-ivory-deep" />
          <div className="mt-3 h-3 w-1/3 bg-ivory-deep" />
          <div className="mt-2 h-4 w-2/3 bg-ivory-deep" />
        </li>
      ))}
    </ul>
  );
}
