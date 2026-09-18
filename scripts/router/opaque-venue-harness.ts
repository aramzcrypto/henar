/**
 * Opaque-venue research harness.
 *
 * About a third of the legs in Jupiter's winning routes for Henar's equities
 * run through closed-source proprietary AMMs — HumidiFi, ZeroFi, GoonFi,
 * BisonFi, Riptide, Archer, Denali and others — that publish no SDK and no
 * curve. This measures them without reverse-engineering anything, by using
 * Jupiter as an oracle:
 *
 *   a. `/program-id-to-label` resolves each label to its on-chain program.
 *   b. `dexes=<label>` forces a single-venue quote, which isolates that
 *      venue's own price from the split Jupiter would otherwise build.
 *   c. Outputs are recorded at six real order sizes.
 *   d. `/swap-instructions` returns the instructions Jupiter would send.
 *   e. Their shape is recorded: program, account metas, data length, signers,
 *      address-lookup-table use.
 *
 * It then classifies what Henar could do with each venue. The classification
 * is deliberately conservative, because the expensive mistake is treating
 * liquidity Henar can only reach *through Jupiter's builder* as if it were
 * Henar's own:
 *
 *   OFFCHAIN_AUTH_REQUIRED     the swap carries a signer beyond the payer, so
 *                              the fill is authorised off chain and cannot be
 *                              rebuilt from public state at all
 *   JUPITER_BUILDER_DEPENDENT  the venue's own program never appears in the
 *                              instruction, so Jupiter reaches it by a path
 *                              not visible here and Henar cannot follow
 *   NATIVE_ADAPTER_CANDIDATE   the venue program is the CPI target and the
 *                              payer is the only signer: nothing observed
 *                              rules out a native adapter, but reproducing
 *                              the curve is a separate question this harness
 *                              does NOT answer
 *   STATEFUL_OR_UNCLEAR        builds, but the shape is not understood well
 *                              enough to say
 *   NO_STOCK_LIQUIDITY         never quoted for any equity probed for it
 *
 * One trap worth recording, because it invalidates the obvious test: Jupiter
 * always wraps a route in its own program, so `swapInstruction.programId` is
 * `JUP6Lkb...` for *every* venue — including Raydium CLMM and Whirlpool, which
 * Henar already builds natively. Verified by control. The top-level program is
 * therefore meaningless as a discriminator; what carries signal is whether the
 * venue's own program appears among the instruction's accounts as the CPI
 * target, and whether any signature beyond the payer is required.
 *
 * Probing is staged, because Jupiter's free tier is rate limited and a full
 * cross-product would be mostly wasted calls: a cheap $1,000 pass finds which
 * pairs a venue prices at all, and only those get the six-size sweep.
 *
 * Nothing here is wired into the router. It writes evidence.
 */
import { readFile, writeFile } from "node:fs/promises";
import { equityRegistry } from "../../src/lib/equities/registry";
import poolsJson from "../../src/data/router/pools.json";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "https://lite-api.jup.ag/swap/v1";
const OUTPUT = "src/data/router/opaque-venues.json";
const CENSUS = "src/data/router/route-leg-census.json";
const SIZES = [100, 1_000, 5_000, 10_000, 25_000, 50_000];
const DISCOVERY_SIZE = 1_000;
/**
 * A forced quote counts as liquidity only if it is within this much of
 * Jupiter's open route. Orderbook venues answer a forced quote even with an
 * empty book: Manifest returned quotes on seven pairs up to $50,000 whose
 * output was 0.02% of baseline — about -9,998 bps. Without a floor that reads
 * as "seven pairs of liquidity" when it is nothing at all.
 */
const MATERIAL_BPS = -1_000;
const RATE_MS = 1_100;

/** Jupiter's router program. Every forced route wraps in it, so its presence
    at the top level says nothing; it is excluded when looking for CPI targets. */
const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const TARGETS = [
  "HumidiFi", "GoonFi V2", "ZeroFi", "BisonFi", "Archer", "Denali",
  "BinaryFi", "Deriverse", "Scorch", "Quantum", "Quay", "AlphaQ",
  "Riptide", "TesseraV", "Manifest", "Byreal",
];

type Classification =
  | "OFFCHAIN_AUTH_REQUIRED"
  | "JUPITER_BUILDER_DEPENDENT"
  | "NATIVE_ADAPTER_CANDIDATE"
  | "STATEFUL_OR_UNCLEAR"
  | "NO_STOCK_LIQUIDITY";

type SizeResult = {
  ticker: string;
  sizeUsd: number;
  outAmount: string | null;
  /** Against Jupiter's unrestricted route for the same trade. */
  vsJupiterBps: number | null;
};

type InstructionShape = {
  /** Always Jupiter's router program; kept for the record, not for deciding. */
  programId: string;
  accounts: number;
  writableAccounts: number;
  signerAccounts: number;
  dataBytes: number;
  /** Whether the venue's own program is among the accounts, i.e. the CPI target. */
  venueProgramIsCpiTarget: boolean;
};

type VenueReport = {
  label: string;
  programId: string | null;
  /** Equities this venue priced at the discovery size. */
  tickersQuoted: string[];
  quotes: SizeResult[];
  /** Pairs that answered but only with dust, below the materiality floor. */
  dustPairs: number;
  /** Largest size that produced a quote anywhere. */
  maxSizeUsd: number;
  /** Median gap to Jupiter's unrestricted route across all recorded quotes. */
  medianVsJupiterBps: number | null;
  swapInstruction: InstructionShape | null;
  extraSigners: number | null;
  lookupTables: number | null;
  classification: Classification;
  note: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jupiter's free tier is rate limited; back off rather than lose the probe. */
async function getJson(url: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (res?.status === 429) {
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (!res?.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  }
  return null;
}

async function quote(mint: string, sizeUsd: number, label: string | null) {
  const amount = BigInt(sizeUsd) * 1_000_000n;
  const dexes = label ? `&dexes=${encodeURIComponent(label)}` : "";
  const q = await getJson(`${JUP}/quote?inputMint=${USDC}&outputMint=${mint}&amount=${amount}&slippageBps=50${dexes}`);
  await sleep(RATE_MS);
  return q && typeof q.outAmount === "string" ? q : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function main() {
  /* A wallet is required to build instructions. Any address works: the shape
     of the instruction does not depend on who pays, and nothing is signed or
     sent. Overridable so a funded address can be used when a live simulation
     is wanted too. */
  const user = process.env.HENAR_HARNESS_WALLET ?? "8psNvWTrdNTiVRNzAgsou9kyXLvGjTqgrqfLBGLE1oLZ";

  const labelMap = (await getJson(`${JUP}/program-id-to-label`)) as Record<string, string> | null;
  if (!labelMap) throw new Error("Jupiter program-id-to-label is unavailable; the harness needs it.");
  const programFor = new Map<string, string>();
  for (const [program, label] of Object.entries(labelMap)) if (!programFor.has(label)) programFor.set(label, program);

  /* Probe the equities Henar can already route: a venue that cannot price
     those is not going to help on the rest. Private-market products are
     excluded — they are not fungible with anything and never route. */
  const pools = poolsJson as { mint: string; tokenSymbol: string; enabled: boolean; provider: string }[];
  const tradable = new Map<string, string>();
  for (const p of pools) {
    if (!p.enabled || p.provider === "prestocks" || p.provider === "tessera") continue;
    if (!tradable.has(p.tokenSymbol)) tradable.set(p.tokenSymbol, p.mint);
  }
  const known = new Set(equityRegistry.flatMap((e) => e.representations.map((r) => r.mint)));
  const universe = [...tradable.entries()].filter(([, mint]) => known.has(mint));

  /* Targets come from the route-leg census, not from an arbitrary prefix of the
     ticker list. Probing a fixed slice produces false negatives: Riptide quotes
     TSLAx, but a twelve-ticker prefix that excludes TSLAx reports it as holding
     no equity at all. The census records which equities each venue actually
     appears on, so each venue is probed where it has been seen, plus a small
     common set so a venue the census missed still gets a chance. */
  const censusRaw = await readFile(CENSUS, "utf8").catch(() => null);
  if (!censusRaw) throw new Error(`${CENSUS} is missing. Run \`npm run router:census:legs\` first.`);
  const census = JSON.parse(censusRaw) as { venues: { label: string; tickers?: string[] }[] };
  const seenOn = new Map<string, string[]>();
  for (const v of census.venues) seenOn.set(v.label, v.tickers ?? []);

  const byTicker = new Map(universe);
  const common = universe.slice(0, 6).map(([t]) => t);
  const targetsFor = (label: string): [string, string][] => {
    const names = [...new Set([...(seenOn.get(label) ?? []), ...common])];
    return names.flatMap((t) => {
      const mint = byTicker.get(t);
      return mint ? ([[t, mint]] as [string, string][]) : [];
    });
  };
  /* The baseline is only needed for equities some venue is actually probed on. */
  const probes = universe.filter(([t]) => TARGETS.some((l) => targetsFor(l).some(([pt]) => pt === t)));

  /* Jupiter's unrestricted route is the baseline every forced quote is scored
     against. Fetched once per (ticker, size) and reused across all 16 venues,
     which is where most of the request budget is saved. */
  const baseline = new Map<string, bigint>();
  process.stdout.write(`Baselining Jupiter across ${probes.length} equities x ${SIZES.length} sizes…\n`);
  for (const [ticker, mint] of probes) {
    for (const sizeUsd of SIZES) {
      const q = await quote(mint, sizeUsd, null);
      if (q) baseline.set(`${ticker}:${sizeUsd}`, BigInt(q.outAmount as string));
    }
  }
  process.stdout.write(`  ${baseline.size} baselines recorded\n\n`);

  const reports: VenueReport[] = [];

  for (const label of TARGETS) {
    const programId = programFor.get(label) ?? null;
    const report: VenueReport = {
      label,
      programId,
      tickersQuoted: [],
      quotes: [],
      dustPairs: 0,
      maxSizeUsd: 0,
      medianVsJupiterBps: null,
      swapInstruction: null,
      extraSigners: null,
      lookupTables: null,
      classification: "NO_STOCK_LIQUIDITY",
      note: "",
    };

    // Stage one: which pairs does this venue price materially?
    const priced: [string, string][] = [];
    const candidates = targetsFor(label);
    let dustPairs = 0;
    for (const [ticker, mint] of candidates) {
      const q = await quote(mint, DISCOVERY_SIZE, label);
      if (!q) continue;
      const full = baseline.get(`${ticker}:${DISCOVERY_SIZE}`);
      const out = BigInt(q.outAmount as string);
      const vs = full && full > 0n ? Number(((out - full) * 10_000n) / full) : 0;
      if (vs < MATERIAL_BPS) {
        dustPairs += 1;
        continue;
      }
      priced.push([ticker, mint]);
    }
    report.tickersQuoted = priced.map(([t]) => t);

    if (!priced.length) {
      report.note = dustPairs
        ? `quoted ${dustPairs} of ${candidates.length} equities probed, but every quote was below ${MATERIAL_BPS} bps against Jupiter — an answer, not liquidity`
        : `never quoted for any of the ${candidates.length} equities probed for it`;
      reports.push(report);
      process.stdout.write(`${label.padEnd(12)} no stock liquidity\n`);
      continue;
    }

    // Stage two: the full size sweep, only on pairs known to price.
    const gaps: number[] = [];
    let deepest: { ticker: string; mint: string; sizeUsd: number } | null = null;
    for (const [ticker, mint] of priced) {
      for (const sizeUsd of SIZES) {
        const q = await quote(mint, sizeUsd, label);
        const out = q ? BigInt(q.outAmount as string) : null;
        const full = baseline.get(`${ticker}:${sizeUsd}`);
        /* Negative is the norm and not a defect: Jupiter combines venues, so a
           single forced venue is expected to lose to the open route. The size
           of the gap is what ranks integration targets. */
        const vs = out !== null && full && full > 0n ? Number(((out - full) * 10_000n) / full) : null;
        report.quotes.push({ ticker, sizeUsd, outAmount: out?.toString() ?? null, vsJupiterBps: vs });
        if (out !== null) {
          report.maxSizeUsd = Math.max(report.maxSizeUsd, sizeUsd);
          if (vs !== null) gaps.push(vs);
          if (!deepest || sizeUsd > deepest.sizeUsd) deepest = { ticker, mint, sizeUsd };
        }
      }
    }
    report.medianVsJupiterBps = median(gaps);
    report.dustPairs = dustPairs;

    /* Build instructions for the deepest fill seen: a venue that only prices
       $100 is not an integration target, and the shape is what is being read. */
    const forced = deepest ? await quote(deepest.mint, deepest.sizeUsd, label) : null;
    let built: Record<string, unknown> | null = null;
    if (forced) {
      const res = await fetch(`${JUP}/swap-instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteResponse: forced, userPublicKey: user, wrapAndUnwrapSol: true }),
        signal: AbortSignal.timeout(25_000),
      }).catch(() => null);
      if (res?.ok) built = (await res.json()) as Record<string, unknown>;
      await sleep(RATE_MS);
    }

    if (!built) {
      report.classification = "STATEFUL_OR_UNCLEAR";
      report.note = "quotes, but Jupiter would not return swap instructions for the forced route";
    } else {
      type Ix = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
      const swap = built.swapInstruction as Ix | undefined;
      report.lookupTables = ((built.addressLookupTableAddresses as string[] | undefined) ?? []).length;
      if (!swap) {
        report.classification = "STATEFUL_OR_UNCLEAR";
        report.note = "no swapInstruction in the response";
      } else {
        /* The venue program appears as an account of Jupiter's route
           instruction, which is how the CPI reaches it. Its presence is what
           distinguishes a venue Henar could in principle call directly from one
           Jupiter reaches by some path not visible here. */
        const cpiTarget = programId !== null && swap.accounts.some((a) => a.pubkey === programId);
        report.swapInstruction = {
          programId: swap.programId,
          accounts: swap.accounts.length,
          writableAccounts: swap.accounts.filter((a) => a.isWritable).length,
          signerAccounts: swap.accounts.filter((a) => a.isSigner).length,
          dataBytes: Buffer.from(swap.data, "base64").length,
          venueProgramIsCpiTarget: cpiTarget,
        };
        const extraSigners = swap.accounts.filter((a) => a.isSigner && a.pubkey !== user).length;
        report.extraSigners = extraSigners;
        if (extraSigners > 0) {
          report.classification = "OFFCHAIN_AUTH_REQUIRED";
          report.note = `the swap needs ${extraSigners} signer(s) beyond the payer, so the fill is authorised off chain and cannot be rebuilt from public state`;
        } else if (!cpiTarget) {
          report.classification = "JUPITER_BUILDER_DEPENDENT";
          report.note = "the venue's own program is not among the instruction's accounts, so Jupiter reaches it by a path not observable here";
        } else {
          report.classification = "NATIVE_ADAPTER_CANDIDATE";
          report.note = "the venue program is the CPI target and the payer is the only signer; whether its curve can be reproduced is a separate question this harness does not answer";
        }
        void JUPITER_PROGRAM;
      }
    }

    reports.push(report);
    process.stdout.write(
      `${label.padEnd(12)} ${String(priced.length).padStart(2)} pairs  to $${report.maxSizeUsd.toLocaleString("en-US").padStart(6)}  median ${String(report.medianVsJupiterBps ?? "?").padStart(6)} bps  ${report.classification}\n`,
    );
  }

  await writeFile(
    OUTPUT,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), sizes: SIZES, probes: probes.map(([t]) => t), venues: reports }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`\nWrote ${OUTPUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
