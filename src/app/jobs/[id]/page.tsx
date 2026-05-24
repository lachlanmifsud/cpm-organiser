import JobDetailClientPage from "./job-detail-client";

export const dynamicParams = false;

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function JobDetailPage() {
  return <JobDetailClientPage />;
}
