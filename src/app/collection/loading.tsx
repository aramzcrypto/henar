import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton active="collection" rows={4} />;
}
