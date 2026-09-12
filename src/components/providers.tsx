"use client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { StockroomWalletProvider } from "./wallet-dialog";
import { ProtocolProvider } from "./protocol-provider";
import { MobileViewport } from "./mobile-viewport";
import { useMemo } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
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
          <ProtocolProvider>{children}</ProtocolProvider>
        </StockroomWalletProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
