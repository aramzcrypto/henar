import type {
  CompanyProfile,
  DividendRecord,
  EarningsEvent,
  Equity,
  EquityResearch,
  FilingRecord,
  FinancialPeriod,
  ResearchSection,
} from "./types";

const SEC_ROOT = "https://data.sec.gov";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const SEC_COMPANY_SEARCH = "https://www.sec.gov/edgar/browse/";
const USER_AGENT =
  process.env.SEC_USER_AGENT || "Henar/1.0 (https://henarapp.vercel.app)";

type FactUnit = {
  val?: number;
  start?: string;
  end?: string;
  filed?: string;
  form?: string;
  fy?: number;
  fp?: string;
  frame?: string;
  accn?: string;
};
type CompanyFacts = {
  facts?: Record<
    string,
    Record<string, { units?: Record<string, FactUnit[]> }>
  >;
};
type RecentFilings = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  form?: string[];
  primaryDocument?: string[];
};
type Submission = {
  cik?: string;
  name?: string;
  sicDescription?: string;
  website?: string;
  addresses?: {
    business?: {
      city?: string;
      stateOrCountryDescription?: string;
      stateOrCountry?: string;
    };
  };
  filings?: { recent?: RecentFilings };
};

function unavailable<T>(): ResearchSection<T> {
  return { status: "unavailable", data: null, asOf: null, sourceUrl: null };
}

function available<T>(
  data: T,
  sourceUrl: string,
  asOf = new Date().toISOString(),
): ResearchSection<T> {
  return { status: "available", data, sourceUrl, asOf };
}

// SEC latency varies from under a second to tens of seconds. A bounded request
// keeps a slow upstream from holding a streamed page response open.
const SEC_TIMEOUT_MS = 15_000;

async function secJson<T>(url: string, seconds: number): Promise<T> {
  // Company facts decode to several megabytes, past the Next fetch-cache limit,
  // so they are persisted by the parsed-result cache instead.
  const largeCompanyFacts = url.includes("/api/xbrl/companyfacts/");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(SEC_TIMEOUT_MS),
    ...(largeCompanyFacts
      ? { cache: "no-store" as const }
      : { next: { revalidate: seconds } }),
  });
  if (!response.ok) throw new Error(`SEC request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function normalizedCik(value: string | number) {
  return String(value).replace(/^0+/, "").padStart(10, "0");
}

export async function cikForTicker(ticker: string): Promise<string | null> {
  const rows = await secJson<
    Record<string, { cik_str?: number; ticker?: string }>
  >("https://www.sec.gov/files/company_tickers.json", 86_400);
  const match = Object.values(rows).find(
    (row) => row.ticker?.toUpperCase() === ticker.toUpperCase(),
  );
  return match?.cik_str === undefined ? null : normalizedCik(match.cik_str);
}

function taxonomy(facts: CompanyFacts) {
  return facts.facts?.["us-gaap"] ?? facts.facts?.["ifrs-full"] ?? {};
}

function unitsFor(
  facts: CompanyFacts,
  concepts: string[],
  units: string[],
): FactUnit[] {
  const entries = taxonomy(facts);
  for (const concept of concepts) {
    const conceptUnits = entries[concept]?.units;
    if (!conceptUnits) continue;
    for (const unit of units) {
      if (conceptUnits[unit]?.length) return conceptUnits[unit];
    }
  }
  return [];
}

function latestPeriods(units: FactUnit[]) {
  const byPeriod = new Map<string, FactUnit>();
  for (const item of units) {
    if (
      typeof item.val !== "number" ||
      !item.end ||
      !item.filed ||
      !["10-Q", "10-K", "20-F", "40-F"].includes(item.form ?? "")
    )
      continue;
    const period = `${item.end}:${item.fp ?? ""}`;
    const previous = byPeriod.get(period);
    const itemScore = item.frame ? 1 : 0;
    const previousScore = previous?.frame ? 1 : 0;
    if (
      !previous ||
      itemScore > previousScore ||
      (itemScore === previousScore && item.filed > (previous.filed ?? ""))
    )
      byPeriod.set(period, item);
  }
  return [...byPeriod.values()].sort((a, b) =>
    (b.end ?? "").localeCompare(a.end ?? ""),
  );
}

/** One row per reporting period; XBRL repeats a period across filings. */
function dedupeByPeriod(units: FactUnit[]) {
  const seen = new Map<string, FactUnit>();
  for (const item of units) {
    if (!item.end) continue;
    const key = `${item.end}:${item.fp ?? ""}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function valueForPeriod(units: FactUnit[], end: string, fp?: string) {
  return latestPeriods(units).find(
    (item) => item.end === end && (!fp || !item.fp || item.fp === fp),
  );
}

function formatFact(item: FactUnit | undefined) {
  return typeof item?.val === "number" ? String(item.val) : null;
}

export function parseSecResearch(
  cik: string,
  submission: Submission,
  facts: CompanyFacts,
): EquityResearch {
  const sourceUrl = `${SEC_COMPANY_SEARCH}?CIK=${cik}`;
  const address = submission.addresses?.business;
  const headquarters = [
    address?.city,
    address?.stateOrCountryDescription || address?.stateOrCountry,
  ]
    .filter(Boolean)
    .join(", ");
  const employees = latestPeriods(
    unitsFor(facts, ["EntityNumberOfEmployees"], ["number", "pure"]),
  )[0]?.val;
  const profile: CompanyProfile = {
    description: null,
    website: submission.website || null,
    headquarters: headquarters || null,
    employees: typeof employees === "number" ? employees : null,
    cik,
    industry: submission.sicDescription || null,
  };

  const revenue = latestPeriods(
    unitsFor(
      facts,
      [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "Revenue",
      ],
      ["USD"],
    ),
  );
  // Each statement line is resolved independently against the same period so a
  // company that omits one concept still reports the rest.
  const series = {
    netIncome: unitsFor(
      facts,
      [
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
      ],
      ["USD"],
    ),
    grossProfit: unitsFor(facts, ["GrossProfit"], ["USD"]),
    operatingIncome: unitsFor(
      facts,
      ["OperatingIncomeLoss", "IncomeLossFromContinuingOperations"],
      ["USD"],
    ),
    assets: unitsFor(facts, ["Assets"], ["USD"]),
    liabilities: unitsFor(facts, ["Liabilities"], ["USD"]),
    equity: unitsFor(
      facts,
      [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      ],
      ["USD"],
    ),
    cash: unitsFor(
      facts,
      [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      ],
      ["USD"],
    ),
    operatingCashFlow: unitsFor(
      facts,
      [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      ],
      ["USD"],
    ),
    investingCashFlow: unitsFor(
      facts,
      [
        "NetCashProvidedByUsedInInvestingActivities",
        "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations",
      ],
      ["USD"],
    ),
    financingCashFlow: unitsFor(
      facts,
      [
        "NetCashProvidedByUsedInFinancingActivities",
        "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
      ],
      ["USD"],
    ),
    capitalExpenditure: unitsFor(
      facts,
      [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
      ],
      ["USD"],
    ),
  };
  const epsSeries = unitsFor(
    facts,
    [
      "EarningsPerShareDiluted",
      "EarningsPerShareBasicAndDiluted",
      "BasicEarningsLossPerShare",
    ],
    ["USD/shares", "USD / shares", "USD-per-shares"],
  );
  const at = (units: FactUnit[], item: FactUnit) =>
    formatFact(valueForPeriod(units, item.end!, item.fp));

  // `fy` on an XBRL fact is the fiscal year of the report the fact appeared in,
  // not of the period it measures, so several periods in one filing share it.
  // The period end is the only reliable year for labelling a column.
  const financials: FinancialPeriod[] = dedupeByPeriod(revenue.slice(0, 24)).map((item) => ({
    periodEnd: item.end!,
    fiscalYear: Number(item.end!.slice(0, 4)),
    fiscalPeriod: item.fp ?? null,
    frame: item.fp === "FY" ? ("annual" as const) : ("quarterly" as const),
    revenue: formatFact(item),
    grossProfit: at(series.grossProfit, item),
    operatingIncome: at(series.operatingIncome, item),
    netIncome: at(series.netIncome, item),
    eps: at(epsSeries, item),
    assets: at(series.assets, item),
    liabilities: at(series.liabilities, item),
    equity: at(series.equity, item),
    cash: at(series.cash, item),
    operatingCashFlow: at(series.operatingCashFlow, item),
    investingCashFlow: at(series.investingCashFlow, item),
    financingCashFlow: at(series.financingCashFlow, item),
    capitalExpenditure: at(series.capitalExpenditure, item),
    currency: "USD",
  }));

  // `fy` is the filing's fiscal year, so a prior-year comparative in the same
  // filing carries the wrong label. The period end is authoritative.
  const earnings: EarningsEvent[] = latestPeriods(epsSeries)
    .slice(0, 12)
    .map((item) => ({
      reportedAt: item.filed!,
      fiscalPeriod: `${item.end!.slice(0, 4)} ${item.fp ?? ""}`.trim(),
      actualEps: formatFact(item),
      estimatedEps: null,
    }));

  const dividendUnits = unitsFor(
    facts,
    [
      "CommonStockDividendsPerShareDeclared",
      "CommonStockDividendsPerShareCashPaid",
    ],
    ["USD/shares", "USD / shares", "USD-per-shares"],
  );
  const dividends: DividendRecord[] = latestPeriods(dividendUnits)
    .slice(0, 12)
    .map((item) => ({
      periodEnd: item.end!,
      filedAt: item.filed!,
      amount: String(item.val),
      currency: "USD",
    }));

  const recent = submission.filings?.recent;
  const filings: FilingRecord[] = [];
  for (let index = 0; index < (recent?.form?.length ?? 0); index++) {
    const accession = recent?.accessionNumber?.[index];
    const document = recent?.primaryDocument?.[index];
    const filedAt = recent?.filingDate?.[index];
    const form = recent?.form?.[index];
    if (!accession || !document || !filedAt || !form) continue;
    if (!/^(10-[KQ]|8-K|20-F|40-F|6-K)(\/A)?$/.test(form)) continue;
    filings.push({
      accessionNumber: accession,
      form,
      filedAt,
      url: `${SEC_ARCHIVES}/${String(Number(cik))}/${accession.replaceAll("-", "")}/${document}`,
    });
    if (filings.length === 20) break;
  }

  return {
    profile: available(profile, sourceUrl),
    financials: financials.length ? available(financials, sourceUrl) : unavailable(),
    earnings: earnings.length ? available(earnings, sourceUrl) : unavailable(),
    dividends: dividends.length ? available(dividends, sourceUrl) : unavailable(),
    filings: filings.length ? available(filings, sourceUrl) : unavailable(),
    news: unavailable(),
  };
}

export async function secResearchForEquity(equity: Equity): Promise<EquityResearch> {
  try {
    const cik = equity.cik || (await cikForTicker(equity.ticker));
    if (!cik) throw new Error("CIK unavailable");
    const normalized = normalizedCik(cik);
    const [submission, facts] = await Promise.all([
      secJson<Submission>(`${SEC_ROOT}/submissions/CIK${normalized}.json`, 3_600),
      secJson<CompanyFacts>(
        `${SEC_ROOT}/api/xbrl/companyfacts/CIK${normalized}.json`,
        3_600,
      ),
    ]);
    return parseSecResearch(normalized, submission, facts);
  } catch {
    return {
      profile: unavailable(),
      financials: unavailable(),
      earnings: unavailable(),
      dividends: unavailable(),
      filings: unavailable(),
      news: unavailable(),
    };
  }
}
