"use client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { StockroomWalletProvider } from "./wallet-dialog";
import { ProtocolProvider } from "./protocol-provider";
import { MobileViewport } from "./mobile-viewport";
import { ReferralCapture } from "./referral-capture";
import { useMemo } from "react";
import "@/styles/wallet-adapter.css";
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint =
    typeof window === "undefined"
      ? "http://localhost:3000/api/rpc"
      : `${window.location.origin}/api/rpc`;
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <StockroomWalletProvider>
          <MobileViewport />
          <ReferralCapture />
          <ProtocolProvider>{children}</ProtocolProvider>
        </StockroomWalletProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
