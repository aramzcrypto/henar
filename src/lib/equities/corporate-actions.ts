import type { CorporateAction } from "./types";

// Only verified issuer, SEC, or provider records belong here. Empty is an honest state.
const actions: CorporateAction[] = [];

export function corporateActionsFor(equityId: string) {
  return actions.filter((action) => action.equityId === equityId);
}
