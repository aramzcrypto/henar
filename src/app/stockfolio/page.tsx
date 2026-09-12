import { Stockroom } from "@/components/stockroom";
import { getProductConfig } from "@/lib/product-config";
export const metadata = { title: "Stockfolio · Kani Markets" };
export default function Page() {
  return <Stockroom page="portfolio" config={getProductConfig()} />;
}
