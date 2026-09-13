import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { RouteTerms } from "./route-policy";
const tokenPrograms = [
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
];
/** Keep an upstream route from gaining access to unrelated existing wallet inventory. */
export async function inspectRouteWallet(
  c: Connection,
  instructions: TransactionInstruction[],
  terms: RouteTerms,
) {
  const addresses = [
    ...new Set(
      instructions.flatMap((i) =>
        i.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58()),
      ),
    ),
  ];
  if (addresses.length > 64) throw new Error("Too many route accounts.");
  const infos = (await Promise.all(Array.from({ length: Math.ceil(addresses.length / 20) }, (_, i) =>
    c.getMultipleAccountsInfo(addresses.slice(i * 20, (i + 1) * 20).map(a => new PublicKey(a))),
  ))).flat();
  const endpoints = [
    getAssociatedTokenAddressSync(
      terms.inputMint,
      terms.owner,
      true,
      terms.inputProgram,
    ).toBase58(),
    getAssociatedTokenAddressSync(
      terms.outputMint,
      terms.owner,
      true,
      terms.outputProgram,
    ).toBase58(),
  ];
  // Legacy-token route hops need the token account, but may omit its mint.
  // Setup/cleanup instructions have already passed validateWalletRoute.
  const created = new Set(
    instructions
      .filter((i) => i.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))
      .map((i) => i.keys[1].pubkey.toBase58()),
  );
  const closed = new Set(
    instructions
      .filter(
        (i) =>
          i.programId.equals(TOKEN_PROGRAM_ID) &&
          i.data.length === 1 &&
          i.data[0] === 9,
      )
      .map((i) => i.keys[0].pubkey.toBase58()),
  );
  const watched: Array<{
    address: string;
    before: ReturnType<typeof unpackAccount> | null;
    closeAllowed?: boolean;
  }> = [];
  for (let i = 0; i < addresses.length; i++) {
    const info = infos[i];
    if (!info) {
      if (created.has(addresses[i]) || endpoints.includes(addresses[i]))
        watched.push({
          address: addresses[i],
          before: null,
          closeAllowed: closed.has(addresses[i]),
        });
      continue;
    }
    if (
      !tokenPrograms.includes(info.owner.toBase58()) ||
      info.data.length < 165
    )
      continue;
    const state = unpackAccount(new PublicKey(addresses[i]), info, info.owner);
    if (!state.owner.equals(terms.owner)) continue;
    if (state.amount > 0n && !endpoints.includes(addresses[i]))
      throw new Error(
        "Route would access unrelated wallet inventory. Try another route.",
      );
    watched.push({
      address: addresses[i],
      before: state,
      closeAllowed: closed.has(addresses[i]),
    });
  }
  return watched;
}
export function verifyRouteWallet(
  watched: Awaited<ReturnType<typeof inspectRouteWallet>>,
  after: ({
    data: string[];
    owner: string;
    lamports: number;
    executable: boolean;
    rentEpoch?: number;
  } | null)[],
  owner: PublicKey,
) {
  if (after.length !== watched.length)
    throw new Error("Route account verification unavailable.");
  const states = new Map<string, ReturnType<typeof unpackAccount>>();
  watched.forEach((w, i) => {
    const info = after[i];
    // RPCs can encode a closed WSOL account as null or an empty system account.
    // Only the explicitly validated close instruction may produce either form.
    const closed =
      !info ||
      (info.owner === PublicKey.default.toBase58() &&
        info.lamports === 0 &&
        !info.executable &&
        info.data[0] === "" &&
        info.data[1] === "base64");
    if (closed) {
      if (!w.closeAllowed)
        throw new Error("Route unexpectedly closed a wallet token account.");
      return;
    }
    if (!info) throw new Error("Route account verification unavailable.");
    if (info.data.length !== 2 || info.data[1] !== "base64")
      throw new Error("Invalid simulated token data.");
    if (!tokenPrograms.includes(info.owner))
      throw new Error("Route changed token account program.");
    const state = unpackAccount(
      new PublicKey(w.address),
      {
        ...info,
        owner: new PublicKey(info.owner),
        data: Buffer.from(info.data[0], "base64"),
      },
      new PublicKey(info.owner),
    );
    const same = (a: PublicKey | null, b: PublicKey | null) =>
      a?.toBase58() === b?.toBase58();
    if (
      !state.owner.equals(owner) ||
      !same(state.delegate, w.before?.delegate ?? null) ||
      !same(state.closeAuthority, w.before?.closeAuthority ?? null) ||
      state.delegatedAmount !== (w.before?.delegatedAmount ?? 0n)
    )
      throw new Error("Route changed wallet token authority.");
    states.set(w.address, state);
  });
  return states;
}
