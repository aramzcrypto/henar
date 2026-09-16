import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PrivateCompanyDetail } from "@/components/private-company-detail";
import { henarFlag } from "@/lib/feature-flags";
import { companyForSlug } from "@/lib/private-markets/companies";
import { loadPrivateMarkets } from "@/lib/private-markets/registry";

type Props = { params: Promise<{ company: string }> };
export const dynamic = "force-dynamic";
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).company;
  const markets = await loadPrivateMarkets({ onchain: false, execution: false }).catch(() => null);
  const company = markets ? companyForSlug(markets.companies, slug) : null;
  return company ? { title: `${company.name} · Pre-IPO · Henar` } : { title: "Company not found · Henar" };
}

export default async function Page({ params }: Props) {
  if (!henarFlag("preIpoMarkets")) notFound();
  const slug = (await params).company;
  const markets = await loadPrivateMarkets({ onchain: true, execution: true, liquidity: true }).catch(() => null);
  const company = markets ? companyForSlug(markets.companies, slug) : null;
  if (!company) notFound();
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <PrivateCompanyDetail company={company} sources={markets!.sources} generatedAt={markets!.generatedAt} />
      </main>
    </div>
  );
}
