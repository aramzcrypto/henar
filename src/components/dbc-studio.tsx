"use client";
/**
 * Henar DBC Studio (DBC-21..23): Configure → Model → Review → Deploy → Monitor.
 *
 * Market-creation infrastructure for equity-style tokens on Meteora's Dynamic
 * Bonding Curve, migrating to DAMM v2. Every number shown comes from the
 * Meteora SDK through the Studio API; the graduation model is labelled
 * MODELED and never presented as a guarantee.
 *
 * Deployment is wallet-signed. The config and base-mint keypairs are created
 * in this browser and never leave it; the server returns one unsigned
 * transaction, this component validates it against the review, signs it with
 * the two keypairs, then asks the wallet. Mainnet needs the environment flag,
 * a matching review hash and an explicit typed acknowledgement.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { Connection, Keypair } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Buffer } from "buffer";
import { HenarBrand } from "./henar-brand";
import { ADMIN_SESSION_MS, adminMessage } from "@/lib/admin/message";
import { validateStudioDeployment } from "@/lib/dbc-studio/client";
import type { DbcMarketView, DeployCluster, FeeProfileRecommendation, GraduationRecommendation, PreparedDeployment, StudioConfigSummary, StudioMarketConfig } from "@henar/dbc-studio";
import admin from "@/app/admin/admin.module.css";
import styles from "@/app/studio/studio.module.css";

type Step = "configure" | "model" | "review" | "deploy" | "monitor";
const STEPS: { id: Step; label: string }[] = [
  { id: "configure", label: "1 · Configure" },
  { id: "model", label: "2 · Model" },
  { id: "review", label: "3 · Review" },
  { id: "deploy", label: "4 · Deploy" },
  { id: "monitor", label: "5 · Monitor" },
];

type Presets = Record<string, { label: string; description: string; config: StudioMarketConfig }>;
type ModelResponse = {
  config: { ok: true; summary: StudioConfigSummary } | { ok: false; problems: string[] } | null;
  graduation: GraduationRecommendation | null;
  feeProfile: FeeProfileRecommendation | null;
  reviewHash: string | null;
  mainnetDeployEnabled: boolean;
};

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const DEVNET_RPC = "https://api.devnet.solana.com";
const LOCALNET_RPC = "http://127.0.0.1:8899";

export function DbcStudio() {
  const wallet = useWallet();
  const { connection: appConnection } = useConnection();
  const { setVisible } = useWalletModal();
  const owner = wallet.publicKey?.toBase58() ?? null;
  const [step, setStep] = useState<Step>("configure");
  const [presets, setPresets] = useState<Presets | null>(null);
  const [mainnetEnabled, setMainnetEnabled] = useState(false);
  const [config, setConfig] = useState<StudioMarketConfig | null>(null);
  const [pool, setPool] = useState({ name: "", symbol: "", uri: "" });
  const [cluster, setCluster] = useState<DeployCluster>("devnet");
  const [graduationInput, setGraduationInput] = useState({ targetTradeSizeQuote: 10_000, maxPriceImpactBps: 50, referencePriceQuote: 100 });
  const [feeInput, setFeeInput] = useState<{ expectedVolatility: "low" | "medium" | "high"; liquidity: "thin" | "moderate" | "deep"; maturity: "launch" | "established" }>({ expectedVolatility: "medium", liquidity: "thin", maturity: "launch" });
  const [model, setModel] = useState<ModelResponse | null>(null);
  const [modeling, setModeling] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [session, setSession] = useState<{ owner: string; token: string; expiresAt: number } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const [prepared, setPrepared] = useState<PreparedDeployment | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [markets, setMarkets] = useState<DbcMarketView[] | null>(null);
  const keys = useRef<{ config: Keypair; mint: Keypair } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    fetch("/api/dbc/studio/model", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { presets?: Presets; mainnetDeployEnabled?: boolean; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setPresets(data.presets ?? null);
        setMainnetEnabled(Boolean(data.mainnetDeployEnabled));
        const first = data.presets && Object.values(data.presets)[0];
        if (first) setConfig(first.config);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Studio unavailable."));
  }, []);

  const loadMarkets = useCallback(async () => {
    const r = await fetch("/api/dbc/markets", { cache: "no-store" });
    const data = (await r.json()) as { markets?: DbcMarketView[]; error?: string };
    if (data.error) throw new Error(data.error);
    setMarkets(data.markets ?? []);
  }, []);
  useEffect(() => {
    if (step === "monitor" && markets === null) loadMarkets().catch((e) => setError(e instanceof Error ? e.message : "Monitor unavailable."));
  }, [step, markets, loadMarkets]);

  const runModel = useCallback(async () => {
    if (!config || modeling) return;
    setModeling(true);
    setError("");
    try {
      const r = await fetch("/api/dbc/studio/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          pool,
          cluster,
          graduation: { ...graduationInput, totalTokenSupply: config.totalTokenSupply, quoteDecimals: config.quoteDecimals ?? 6, baseDecimals: config.baseDecimals, migrationFeePercentage: config.migrationFeePercentage },
          feeProfile: feeInput,
        }),
      });
      const data = (await r.json()) as ModelResponse & { error?: string };
      if (data.error) throw new Error(data.error);
      setModel(data);
      setMainnetEnabled(data.mainnetDeployEnabled);
      setPrepared(null);
      setAcknowledged(false);
      setTyped("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Modeling failed.");
    } finally {
      setModeling(false);
    }
  }, [config, pool, cluster, graduationInput, feeInput, modeling]);

  async function signIn() {
    if (!owner || !wallet.signMessage) return;
    const res = await fetch(`/api/admin/session?wallet=${encodeURIComponent(owner)}`, { cache: "no-store" });
    const challenge = await res.json();
    if (!res.ok) throw new Error(challenge.error);
    if (challenge.wallet !== owner || Math.abs(challenge.issuedAt - Date.now()) > 60_000 || challenge.expiresAt !== challenge.issuedAt + ADMIN_SESSION_MS || challenge.message !== adminMessage(window.location.origin, owner, challenge.issuedAt))
      throw new Error("Invalid sign-in message.");
    const sig = await wallet.signMessage(new TextEncoder().encode(challenge.message));
    const token = Buffer.from(JSON.stringify({ wallet: owner, issuedAt: challenge.issuedAt, signature: Buffer.from(sig).toString("base64") })).toString("base64");
    const s = { owner, token, expiresAt: challenge.expiresAt };
    setSession(s);
    return s;
  }

  async function prepare() {
    if (!owner || !config || !model?.reviewHash || busy.current) return;
    busy.current = true;
    setError("");
    setStatus("Signing in…");
    try {
      const s = session && session.owner === owner && session.expiresAt > Date.now() ? session : await signIn();
      if (!s) throw new Error("Sign-in required.");
      // Fresh keypairs per deployment. They never leave this browser.
      keys.current = { config: Keypair.generate(), mint: Keypair.generate() };
      setStatus("Preparing transaction…");
      const r = await fetch("/api/dbc/studio/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
        body: JSON.stringify({
          cluster,
          config,
          pool,
          payer: owner,
          configAddress: keys.current.config.publicKey.toBase58(),
          baseMint: keys.current.mint.publicKey.toBase58(),
          reviewHash: model.reviewHash,
          mainnetAcknowledged: cluster === "mainnet" ? acknowledged && typed === "DEPLOY MAINNET" : undefined,
        }),
      });
      const data = (await r.json()) as PreparedDeployment & { error?: string; problems?: string[] };
      if (!r.ok) throw new Error(data.problems?.join("; ") ?? data.error ?? "Prepare failed.");
      setPrepared(data);
      setStatus("Ready to sign");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prepare failed.");
      setStatus("");
    } finally {
      busy.current = false;
    }
  }

  async function signAndSend() {
    if (!owner || !prepared || !keys.current || !wallet.signTransaction || busy.current) return;
    busy.current = true;
    setError("");
    try {
      setStatus("Checking transaction…");
      const tx = validateStudioDeployment(prepared.transaction, { payer: owner, configAddress: keys.current.config.publicKey.toBase58(), baseMint: keys.current.mint.publicKey.toBase58() });
      const conn = cluster === "mainnet" ? appConnection : new Connection(cluster === "devnet" ? DEVNET_RPC : LOCALNET_RPC, "confirmed");
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.partialSign(keys.current.config, keys.current.mint);
      setStatus("Confirm in your wallet");
      const signed = await wallet.signTransaction(tx);
      setStatus("Submitting…");
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 2 });
      setSignature(sig);
      setStatus("Submitted · awaiting confirmation");
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      setStatus("Confirmed");
      setMarkets(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deployment failed.");
      setStatus("");
    } finally {
      busy.current = false;
    }
  }

  const summary = model?.config && model.config.ok ? model.config.summary : null;
  const configProblems = model?.config && !model.config.ok ? model.config.problems : [];
  const canReview = Boolean(summary && pool.name && pool.symbol && pool.uri);
  const mainnetBlocked = cluster === "mainnet" && (!mainnetEnabled || !acknowledged || typed !== "DEPLOY MAINNET");
  const field = (label: string, node: React.ReactNode) => (
    <label className={styles.field}>
      <span>{label}</span>
      {node}
    </label>
  );
  /* The SDK's own identifiers, said in words. A form labelled
     `creatorMigrationFeePercentage` is a struct dump; the label is where a
     control explains itself, which is cheaper than a paragraph above the
     form and does not push the form off the screen. */
  const NUMBER_LABELS: Partial<Record<keyof StudioMarketConfig, string>> = {
    totalTokenSupply: "Total supply",
    leftover: "Unsold tokens kept back",
    initialMarketCap: "Market cap at launch (USDC)",
    migrationMarketCap: "Market cap that triggers migration (USDC)",
    creatorTradingFeePercentage: "Creator share of trading fees (%)",
    migrationFeePercentage: "Migration fee (% of raised quote)",
    creatorMigrationFeePercentage: "Creator share of the migration fee (%)",
  };
  const num = (key: keyof StudioMarketConfig, step = 1) =>
    field(NUMBER_LABELS[key] ?? String(key), <input type="number" step={step} value={Number(config?.[key] ?? 0)} onChange={(e) => config && setConfig({ ...config, [key]: Number(e.target.value) })} />);

  return (
    <div className={admin.shell}>
      <header className={admin.header}>
        <div className={admin.brand}>
          <Link href="/" className="brand" aria-label="Henar home">
            <HenarBrand />
          </Link>
          <span>DBC Studio</span>
        </div>
        <div className={admin.actions}>
          <Link href="/admin">Admin <ArrowUpRight size={14} /></Link>
          <Link href="/trade">Open app <ArrowUpRight size={14} /></Link>
          {owner ? <span className={admin.wallet}>{short(owner)}</span> : <button onClick={() => setVisible(true)}>Connect wallet</button>}
        </div>
      </header>
      <nav className={styles.steps} aria-label="Studio steps">
        {STEPS.map((s) => (
          <button key={s.id} className={styles.step} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)} disabled={(s.id === "review" || s.id === "deploy") && !canReview}>
            {s.label}
          </button>
        ))}
      </nav>
      <main className={admin.main}>
        {error && <div className={admin.error}>{error}</div>}

        {step === "configure" && config && (
          <section className={admin.section}>
            <div className={admin.sectionHeading}>
              <h2>Launch a market</h2>
            </div>

            {/* The quick path. Everything a launch actually needs from a
                person is a name, a ticker and an image; the curve, the fee
                schedule and the migration rules all have working defaults and
                a preset sets them together. The full configuration is one
                disclosure away for anyone who wants it, rather than twenty-one
                controls in the way of anyone who does not. */}
            <div className={styles.quick}>
              {field("Pool name", <input value={pool.name} maxLength={32} onChange={(e) => setPool({ ...pool, name: e.target.value })} placeholder="Acme Corp Equity Token" />)}
              {field("Symbol", <input value={pool.symbol} maxLength={10} onChange={(e) => setPool({ ...pool, symbol: e.target.value })} placeholder="ACMEx" />)}
              {field("Metadata URL", <input value={pool.uri} onChange={(e) => setPool({ ...pool, uri: e.target.value })} placeholder="https://…/metadata.json" />)}
            </div>

            <div className={styles.startRow}>
              <span className={styles.startLabel}>Curve</span>
              {presets && Object.entries(presets).map(([id, p]) => (
                <button
                  key={id}
                  className={
                    config && p.config.migrationMarketCap === config.migrationMarketCap
                      ? `${styles.curve} ${styles.curveOn}`
                      : styles.curve
                  }
                  onClick={() => setConfig(p.config)}
                  title={p.description}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <details className={styles.advanced}>
              <summary>Advanced settings</summary>
            <fieldset className={styles.group}>
              <legend>Token</legend>
              <div className={styles.grid}>
              {field("Pool name", <input value={pool.name} maxLength={32} onChange={(e) => setPool({ ...pool, name: e.target.value })} placeholder="Acme Corp Equity Token" />)}
              {field("Symbol", <input value={pool.symbol} maxLength={10} onChange={(e) => setPool({ ...pool, symbol: e.target.value })} placeholder="ACMEx" />)}
              {field("Metadata URL", <input value={pool.uri} onChange={(e) => setPool({ ...pool, uri: e.target.value })} placeholder="https://…/metadata.json" />)}
              {field("Token program", <select value={config.baseTokenType} onChange={(e) => setConfig({ ...config, baseTokenType: e.target.value as StudioMarketConfig["baseTokenType"] })}><option>Token2022</option><option>SPL</option></select>)}
              {field("Decimals", <select value={config.baseDecimals} onChange={(e) => setConfig({ ...config, baseDecimals: Number(e.target.value) as StudioMarketConfig["baseDecimals"] })}>{[6, 7, 8, 9].map((d) => <option key={d} value={d}>{d}</option>)}</select>)}
              {field("Who can update the token", <select value={config.tokenAuthority} onChange={(e) => setConfig({ ...config, tokenAuthority: e.target.value as StudioMarketConfig["tokenAuthority"] })}><option>Immutable</option><option>CreatorUpdateAuthority</option><option>PartnerUpdateAuthority</option></select>)}
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Supply and pricing</legend>
              <div className={styles.grid}>
              {num("totalTokenSupply")}
              {num("leftover")}
              {num("initialMarketCap")}
              {num("migrationMarketCap")}
              </div>
            </fieldset>

            {/* The three groups below have working defaults and a preset sets
                them all; someone launching a first market should not have to
                read a fee scheduler to get started. */}
            <details className={styles.group}>
              <summary>Trading fees</summary>
              <div className={styles.grid}>
              {field("Trading fee, start → end (bps)", <div className={styles.row}><input type="number" value={config.baseFee.startingFeeBps} onChange={(e) => setConfig({ ...config, baseFee: { ...config.baseFee, startingFeeBps: Number(e.target.value) } })} /><input type="number" value={config.baseFee.endingFeeBps} onChange={(e) => setConfig({ ...config, baseFee: { ...config.baseFee, endingFeeBps: Number(e.target.value) } })} /></div>)}
              {field("How the fee decays", <select value={config.baseFee.mode} onChange={(e) => setConfig({ ...config, baseFee: { ...config.baseFee, mode: e.target.value as StudioMarketConfig["baseFee"]["mode"] } })}><option value="linear">linear</option><option value="exponential">exponential</option></select>)}
              {field("Decay steps / over (seconds)", <div className={styles.row}><input type="number" value={config.baseFee.numberOfPeriod} onChange={(e) => setConfig({ ...config, baseFee: { ...config.baseFee, numberOfPeriod: Number(e.target.value) } })} /><input type="number" value={config.baseFee.totalDuration} onChange={(e) => setConfig({ ...config, baseFee: { ...config.baseFee, totalDuration: Number(e.target.value) } })} /></div>)}
              {field("Extra fee when volatile", <select value={config.dynamicFeeEnabled ? "on" : "off"} onChange={(e) => setConfig({ ...config, dynamicFeeEnabled: e.target.value === "on" })}><option value="on">enabled</option><option value="off">disabled</option></select>)}
              {field("Take fees in", <select value={config.collectFeeMode} onChange={(e) => setConfig({ ...config, collectFeeMode: e.target.value as StudioMarketConfig["collectFeeMode"] })}><option>QuoteToken</option><option>OutputToken</option></select>)}
              {num("creatorTradingFeePercentage")}
              </div>
            </details>
            </details>

            <div className={styles.row}>
              <button className={admin.primary} onClick={() => { setStep("model"); void runModel(); }}>Continue</button>
            </div>
          </section>
        )}

        {step === "model" && (
          <section className={admin.section}>
            <div className={admin.sectionHeading}>
              <h2>Model</h2>
              <span className={styles.badge}>MODELED / ESTIMATED</span>
            </div>
            <div className={styles.grid}>
              {field("Target trade size (USDC)", <input type="number" value={graduationInput.targetTradeSizeQuote} onChange={(e) => setGraduationInput({ ...graduationInput, targetTradeSizeQuote: Number(e.target.value) })} />)}
              {field("Max modeled impact (bps)", <input type="number" value={graduationInput.maxPriceImpactBps} onChange={(e) => setGraduationInput({ ...graduationInput, maxPriceImpactBps: Number(e.target.value) })} />)}
              {field("Reference price at graduation (USDC / token)", <input type="number" value={graduationInput.referencePriceQuote} onChange={(e) => setGraduationInput({ ...graduationInput, referencePriceQuote: Number(e.target.value) })} />)}
              {field("Expected volatility", <select value={feeInput.expectedVolatility} onChange={(e) => setFeeInput({ ...feeInput, expectedVolatility: e.target.value as typeof feeInput.expectedVolatility })}><option>low</option><option>medium</option><option>high</option></select>)}
              {field("Liquidity", <select value={feeInput.liquidity} onChange={(e) => setFeeInput({ ...feeInput, liquidity: e.target.value as typeof feeInput.liquidity })}><option>thin</option><option>moderate</option><option>deep</option></select>)}
              {field("Maturity", <select value={feeInput.maturity} onChange={(e) => setFeeInput({ ...feeInput, maturity: e.target.value as typeof feeInput.maturity })}><option>launch</option><option>established</option></select>)}
            </div>
            <div className={styles.row}>
              <button className={admin.refresh} onClick={() => void runModel()} disabled={modeling}>{modeling ? "Modeling…" : "Run model"}</button>
              {summary && <button className={admin.primary} onClick={() => setStep("review")} disabled={!canReview}>Continue to review</button>}
            </div>
            {configProblems.length > 0 && <ul className={styles.list}>{configProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {summary && (
              <dl className={styles.kv}>
                <dt>Migration quote threshold</dt><dd>{summary.migrationQuoteThreshold.display} USDC</dd>
                <dt>Quote deposited after migration fee</dt><dd>{summary.migrationQuoteAmount.display} USDC</dd>
                <dt>Initial price → migration price</dt><dd>{summary.initialPrice} → {summary.migrationPrice} USDC</dd>
                <dt>Supply on migration</dt><dd>{summary.percentageSupplyOnMigration}% ({summary.migrationBaseAmount.display} tokens)</dd>
                <dt>Migrated pool fee</dt><dd>{summary.migratedPoolFee.poolFeeBps} bps · {summary.migratedPoolFee.collectFeeMode ?? "per option"} · dynamic {summary.migratedPoolFee.dynamicFee ? "on" : "off"}</dd>
                <dt>Curve points</dt><dd>{summary.curvePoints}</dd>
              </dl>
            )}
            {model?.graduation && (
              <div className={admin.section}>
                <div className={admin.sectionHeading}><h2>Liquidity-targeted graduation</h2><span className={styles.badge}>MODELED</span></div>
                {model.graduation.ok ? (
                  <>
                    <dl className={styles.kv}>
                      <dt>Required post-fee quote liquidity</dt><dd>{model.graduation.requiredQuoteLiquidity.display} USDC</dd>
                      <dt>Recommended migration threshold</dt><dd>{model.graduation.recommendedMigrationQuoteThreshold.display} USDC</dd>
                      <dt>Recommended migration market cap</dt><dd>{model.graduation.recommendedMigrationMarketCap} USDC</dd>
                      <dt>Implied initial market cap</dt><dd>{model.graduation.impliedInitialMarketCap ?? "not derivable"}</dd>
                      <dt>Implied supply on migration</dt><dd>{model.graduation.impliedPercentageSupplyOnMigration}%</dd>
                      <dt>Modeled impact at target</dt><dd>{model.graduation.modeledImpactBpsAtTarget} bps</dd>
                      <dt>SDK threshold for those caps</dt><dd>{model.graduation.sdkMigrationQuoteThreshold?.display ?? "n/a"} {model.graduation.sdkDivergenceBps !== null ? `(divergence ${model.graduation.sdkDivergenceBps} bps)` : ""}</dd>
                    </dl>
                    <div className={styles.row}>
                      <button className={admin.refresh} onClick={() => config && model.graduation && model.graduation.ok && setConfig({ ...config, migrationMarketCap: Number(model.graduation.recommendedMigrationMarketCap), initialMarketCap: model.graduation.impliedInitialMarketCap ? Number(model.graduation.impliedInitialMarketCap) : config.initialMarketCap })}>Apply recommended caps to configuration</button>
                    </div>
                    <ul className={styles.list}>{[...model.graduation.assumptions, ...model.graduation.caveats].map((a) => <li key={a}>{a}</li>)}</ul>
                  </>
                ) : <ul className={styles.list}>{model.graduation.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
              </div>
            )}
            {model?.feeProfile && (
              <div className={admin.section}>
                <div className={admin.sectionHeading}><h2>Volatility-aware fee profile</h2><span className={styles.badge}>MODELED</span></div>
                <pre className={styles.mono}>{JSON.stringify(model.feeProfile, null, 2)}</pre>
              </div>
            )}
          </section>
        )}

        {step === "review" && summary && config && (
          <section className={admin.section}>
            <div className={admin.sectionHeading}><h2>Review</h2><span>Every parameter below is what will be deployed. The hash pins it.</span></div>
            <div className={styles.grid}>
              {field("Cluster", <select value={cluster} onChange={(e) => { setCluster(e.target.value as DeployCluster); setModel(null); setPrepared(null); }}><option value="localnet">localnet</option><option value="devnet">devnet</option><option value="mainnet">mainnet</option></select>)}
            </div>
            {!model?.reviewHash && <div className={styles.row}><button className={admin.refresh} onClick={() => void runModel()} disabled={modeling}>{modeling ? "Recomputing…" : "Recompute review hash for this cluster"}</button></div>}
            <dl className={styles.kv}>
              <dt>Pool</dt><dd>{pool.name} · {pool.symbol} · <span className={styles.mono}>{pool.uri}</span></dd>
              <dt>Review hash</dt><dd className={styles.mono}>{model?.reviewHash ?? "—"}</dd>
              <dt>Migration threshold</dt><dd>{summary.migrationQuoteThreshold.display} USDC</dd>
              <dt>Market cap</dt><dd>{config.initialMarketCap} → {config.migrationMarketCap} USDC</dd>
              <dt>Base fee</dt><dd>{config.baseFee.startingFeeBps} → {config.baseFee.endingFeeBps} bps · {config.baseFee.mode} · dynamic {config.dynamicFeeEnabled ? "on" : "off"}</dd>
              <dt>Migration fee</dt><dd>{config.migrationFeePercentage}% (creator share {config.creatorMigrationFeePercentage}%) · option {typeof config.migrationFeeOption === "string" ? config.migrationFeeOption : "Customizable"}</dd>
              <dt>Liquidity distribution</dt><dd>partner {config.liquidityDistribution.partnerPermanentLockedPercentage}% locked / {config.liquidityDistribution.partnerPercentage}% · creator {config.liquidityDistribution.creatorPermanentLockedPercentage}% locked / {config.liquidityDistribution.creatorPercentage}%</dd>
            </dl>
            <details>
              <summary>Full configuration</summary>
              <pre className={styles.mono}>{JSON.stringify(config, null, 2)}</pre>
            </details>
            {cluster === "mainnet" && (
              <div className={styles.warn}>
                <strong>Mainnet deployment.</strong> This creates a real market with real funds. It requires the environment flag on the server{mainnetEnabled ? " (enabled)" : " (currently OFF — the server will refuse)"}, the review hash above, and your explicit acknowledgement.
                <label className={styles.check}><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I reviewed every parameter above and accept that this deploys on mainnet.</label>
                {field("Type DEPLOY MAINNET to confirm", <input value={typed} onChange={(e) => setTyped(e.target.value)} />)}
              </div>
            )}
            <div className={styles.row}>
              <button className={admin.primary} onClick={() => setStep("deploy")} disabled={!model?.reviewHash || mainnetBlocked}>Continue to deploy</button>
            </div>
          </section>
        )}

        {step === "deploy" && (
          <section className={admin.section}>
            <div className={admin.sectionHeading}><h2>Deploy · {cluster}</h2><span>Wallet-signed. Config and mint keypairs are generated here and never leave this browser.</span></div>
            {!owner ? (
              <div className={admin.gate}><div className={admin.lock}><LockKeyhole size={26} /></div><button className={admin.primary} onClick={() => setVisible(true)}>Connect wallet</button></div>
            ) : (
              <>
                <dl className={styles.kv}>
                  <dt>Payer / creator</dt><dd className={styles.mono}>{owner}</dd>
                  {prepared && (<><dt>Config</dt><dd className={styles.mono}>{prepared.configAddress}</dd><dt>Base mint</dt><dd className={styles.mono}>{prepared.baseMint}</dd><dt>Pool (derived)</dt><dd className={styles.mono}>{prepared.poolAddress}</dd><dt>Programs</dt><dd className={styles.mono}>{prepared.programs.join(", ")}</dd><dt>Signers</dt><dd className={styles.mono}>{prepared.requiredSigners.join(", ")}</dd></>)}
                </dl>
                <div className={styles.row}>
                  {!prepared ? (
                    <button className={admin.primary} onClick={() => void prepare()} disabled={!model?.reviewHash || mainnetBlocked || !wallet.signMessage}>Sign in and prepare</button>
                  ) : (
                    <button className={admin.primary} onClick={() => void signAndSend()} disabled={!wallet.signTransaction || Boolean(signature)}>Sign with wallet and deploy</button>
                  )}
                  {status && <span className={admin.status}>{status}</span>}
                </div>
                {signature && <p className={styles.mono}>Signature: {signature}</p>}
                <span className={admin.note}>Admin sign-in required · Nothing is deployed without your wallet signature</span>
              </>
            )}
          </section>
        )}

        {step === "monitor" && (
          <section className={admin.section}>
            <div className={admin.sectionHeading}><h2>Monitor</h2><button className={admin.refresh} onClick={() => { setMarkets(null); }}>Refresh</button></div>
            {markets === null ? <p className={admin.caption}>Reading registry DBC markets…</p> : markets.length === 0 ? <p className={admin.empty}>No DBC markets in the registry yet. A deployed market enters the registry through the discovery pass.</p> : (
              <div className={admin.tableWrap}>
                <table>
                  <thead><tr><th>Market</th><th>Lifecycle</th><th>Price</th><th>Progress</th><th>Fee</th><th>Successor</th></tr></thead>
                  <tbody>
                    {markets.map((m) => (
                      <tr key={m.poolAddress}>
                        <th scope="row"><span className={styles.mono}>{m.tokenSymbol ?? short(m.poolAddress)}</span><br /><small className={styles.mono}>{short(m.poolAddress)}</small></th>
                        <td>{m.lifecycle}{m.errors.length ? ` · ${m.errors[0]}` : ""}</td>
                        <td>{m.currentPrice ?? "—"}</td>
                        <td>{m.graduationProgressBps === null ? "—" : `${(m.graduationProgressBps / 100).toFixed(2)}%`}</td>
                        <td>{m.currentFeeBps === null ? "—" : `${m.currentFeeBps} bps${m.dynamicFeeEnabled ? " · dynamic" : ""}`}</td>
                        <td>{m.successorStatus}{m.successorPoolAddress ? ` · ${short(m.successorPoolAddress)}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
