/**
 * Bridge from the Pyth company bundle to the Execution Guard's input. Flag
 * gated, never throws, and hands the guard references only — the executable
 * price is the quote's own.
 */
import { routerRepresentation } from "@henar/router-core";
import type { PythGuardInput } from "@henar/execution-guard";
import { equityForMint } from "@/lib/equities/registry";
import { henarFlag, pythGuardMode } from "@/lib/feature-flags";
import { companyPyth } from "./company";

export async function pythGuardInputFor(representationId: string): Promise<PythGuardInput | null> {
  if (!henarFlag("pythPro") || !henarFlag("pythFairValueGuard")) return null;
  const rep = routerRepresentation(representationId);
  const found = rep ? equityForMint(rep.mint) : null;
  if (!found) return null;
  try {
    const company = await companyPyth(found.equity);
    if (!company.enabled) return null;
    const row = company.representations.find((r) => r.representationId === found.representation.id);
    if (!row) return null;
    return { references: { underlying: company.underlying.reference, token: row.reference, redemptionRate: row.redemptionRate }, mode: pythGuardMode() };
  } catch {
    return null;
  }
}
