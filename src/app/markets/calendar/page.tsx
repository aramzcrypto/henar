import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { MarketsCalendar } from "@/components/markets-calendar";
import { isoDay, loadCalendar, monthGridRange } from "@/lib/equities/calendar";

export const revalidate = 1_800;
export const metadata: Metadata = {
  title: "Calendar · Henar",
  description: "Earnings and macro events for verified tokenized companies.",
};

export default async function Page() {
  const today = new Date();
  const range = monthGridRange(today);
  const calendar = await loadCalendar(range);
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <MarketsCalendar initial={calendar} today={isoDay(today)} />
      </main>
    </div>
  );
}
