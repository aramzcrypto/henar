import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { IssuerProfile } from "@/components/issuer-profile";
import { henarFlag } from "@/lib/feature-flags";
import { issuerProfile } from "@/lib/issuers/profiles";
import { issuerSnapshot } from "@/lib/issuers/registry";
import { ISSUER_IDS, type IssuerId } from "@/lib/issuers/types";

export const dynamic = "force-dynamic";

function resolve(slug: string): IssuerId | null {
  const id = slug.trim().toLowerCase();
  return (ISSUER_IDS as readonly string[]).includes(id) ? (id as IssuerId) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ issuer: string }>;
}): Promise<Metadata> {
  const id = resolve((await params).issuer);
  const profile = id ? issuerProfile(id) : null;
  if (!profile) return { title: "Issuer · Henar Markets" };
  return {
    title: `${profile.label} · Henar Markets`,
    description: `${profile.label}: ${profile.instrument}. Catalog, onchain market and the issuer's own disclosures.`,
  };
}

/**
 * The reads cover every verified mint plus the issuer's own API, so they are
 * streamed rather than awaited in the shell.
 */
async function Profile({ id }: { id: IssuerId }) {
  const data = await issuerSnapshot(id).catch(() => null);
  if (!data) notFound();
  return <IssuerProfile data={data} />;
}

export default async function Page({ params }: { params: Promise<{ issuer: string }> }) {
  if (!henarFlag("issuerIntelligence")) notFound();
  const id = resolve((await params).issuer);
  if (!id) notFound();
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <Suspense
          fallback={
            <div className="markets-page-loading" aria-busy="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          }
        >
          <Profile id={id} />
        </Suspense>
      </main>
    </div>
  );
}
