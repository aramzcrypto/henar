# Payment token artwork

Payment tokens use Jupiter Tokens API V2 metadata, matched by exact mint address. The server retains the API key and caches metadata for one hour. Token amounts and transaction decimals remain based on verified onchain mint data.

USDC and SOL artwork is pinned locally under `public/logos/tokens` for immediate rendering. Source URLs returned by Jupiter on 2026-09-12:

- USDC: https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png
- SOL: https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png

Other wallet tokens are fetched in a single batch, up to 100 mints. Imported token metadata is optional; unavailable metadata does not bypass or prevent mint verification. Images use the existing circular treatment and fall back to initials when missing, failed, or outside the trusted HTTPS host list. Images send no referrer. Logos and names do not establish issuer authenticity; mint addresses remain visible in the selector.

API reference: https://developers.jup.ag/docs/guides/how-to-get-token-information
