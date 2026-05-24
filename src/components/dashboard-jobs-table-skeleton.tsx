const SKELETON_ROW_COUNT = 3;

function SkeletonBar({ className }: { className?: string }) {
  return <div className={className ?? "h-4 w-3/4 animate-pulse rounded-md bg-[#F5F6F8]"} />;
}

function SkeletonPill() {
  return <div className="h-7 w-20 animate-pulse rounded-md bg-[#F5F6F8]" />;
}

export function DashboardJobsTableSkeleton() {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
        <tr key={index} className="border-b border-[#E6E9EF] bg-white">
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-2/3 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-1/2 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonPill />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-24 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-20 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-16 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-28 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <SkeletonBar className="h-4 w-20 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
          <td className="px-4 py-5 sm:px-5">
            <div className="ml-auto h-8 w-8 animate-pulse rounded-md bg-[#F5F6F8]" />
          </td>
        </tr>
      ))}
    </>
  );
}
