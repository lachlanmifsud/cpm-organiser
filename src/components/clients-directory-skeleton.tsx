const SKELETON_CARD_COUNT = 3;

export function ClientsDirectorySkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: SKELETON_CARD_COUNT }).map((_, index) => (
        <li
          key={index}
          className="flex h-full flex-col rounded-lg border border-[#E6E9EF] bg-white p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="size-10 shrink-0 animate-pulse rounded-lg bg-[#F5F6F8]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded-md bg-[#F5F6F8]" />
              <div className="h-3 w-1/2 animate-pulse rounded-md bg-[#F5F6F8]" />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-3 w-full animate-pulse rounded-md bg-[#F5F6F8]" />
            <div className="h-3 w-4/5 animate-pulse rounded-md bg-[#F5F6F8]" />
          </div>
          <div className="mt-3 h-3 w-24 animate-pulse rounded-md bg-[#F5F6F8]" />
        </li>
      ))}
    </ul>
  );
}
