import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { EarnPoolDetail } from "@/components/earn-pool-detail";
import { Stockroom } from "@/components/stockroom";
import { getProductConfig } from "@/lib/product-config";
import { FEATURED_SLUG, findEarnPool } from "@/lib/equities/earn/pools";

type Props = { params: Promise<{ pool: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pool = await findEarnPool((await params).pool).catch(() => null);
  return pool
    ? { title: `${pool.name} · Earn · Henar` }
    : { title: "Pool not found · Henar" };
}

export default async function Page({ params }: Props) {
  const slug = (await params).pool;
  // The featured strategy is the protocol-wired product and keeps its existing
  // live dashboard and ticket rather than the preview layout.
  if (slug === FEATURED_SLUG)
    return <Stockroom page="earn" config={getProductConfig()} />;

  const pool = await findEarnPool(slug).catch(() => null);
  if (!pool) notFound();
  return (
    <div className="app page-earn">
      <AppHeader active="earn" />
      <main className="markets-main">
        <EarnPoolDetail pool={pool} />
      </main>
    </div>
  );
}
