import type { Connection } from "@solana/web3.js";
/** HTTP polling works through the same-origin RPC proxy; it does not require a public WebSocket key. */
export async function awaitConfirmation(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  signature: string,
  lastValidBlockHeight?: number,
  timeoutMs = 60000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err) throw new Error("Transaction failed onchain.");
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return;
    if (
      !status &&
      lastValidBlockHeight !== undefined &&
      (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight
    )
      throw new Error(
        "Transaction blockhash expired. Check its signature before retrying.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Confirmation is pending. Check the submitted signature before retrying.",
  );
}
