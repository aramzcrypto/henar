import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton active="markets" rows={4} />;
}
