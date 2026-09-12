import {
  PRO_COMPATIBLE_PUSH_ORACLE_PROGRAM_ID,
  PRO_COMPATIBLE_RECEIVER_PROGRAM_ID,
  PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID,
} from "@pythnetwork/pyth-solana-receiver";
/** Pyth's upgraded Core stack: endpoint and verifier generation must move together. */
export const PYTH_HERMES_URL = "https://pyth.dourolabs.app/hermes";
export const PYTH_PROGRAMS = {
  pushOracleProgramId: PRO_COMPATIBLE_PUSH_ORACLE_PROGRAM_ID,
  receiverProgramId: PRO_COMPATIBLE_RECEIVER_PROGRAM_ID,
  wormholeProgramId: PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID,
};
