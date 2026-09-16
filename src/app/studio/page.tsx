import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DbcStudio } from "@/components/dbc-studio";

export const metadata: Metadata = {
  title: "DBC Studio · Henar",
  robots: { index: false, follow: false },
};

export default function StudioPage() {
  // The page exists only where the Studio is enabled; the APIs check the server flag again.
  if (process.env.NEXT_PUBLIC_HENAR_DBC_STUDIO !== "1") notFound();
  return <DbcStudio />;
}
