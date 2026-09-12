import { writeFile, mkdir } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { unpackMint, getExtensionTypes, ExtensionType } from "@solana/spl-token";
import { z } from "zod";
import catalog from "../src/data/stocks.json";
import { assertMainnet } from "../src/lib/solana";
const feeds=z.array(z.object({id:z.string().regex(/^[0-9a-f]{64}$/),attributes:z.object({symbol:z.string(),quote_currency:z.string(),asset_type:z.string()})}));
async function main(){
  const c=new Connection(process.env.SOLANA_RPC_URL??"https://api.mainnet-beta.solana.com","confirmed");await assertMainnet(c);
  const response=await fetch("https://hermes.pyth.network/v2/price_feeds?asset_type=equity",{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error("Could not verify Pyth feeds.");const prices=feeds.parse(await response.json());
  const candidates=catalog.filter(s=>s.provider==="Backpack"&&s.instrument==="Stock");const infos=await c.getMultipleAccountsInfo(candidates.map(s=>new PublicKey(s.mint)));
  const stocks=[],excluded=[];
  for(let i=0;i<candidates.length;i++){const stock=candidates[i],info=infos[i];if(!info)throw new Error(`Missing mint: ${stock.ticker}`);const mint=unpackMint(new PublicKey(stock.mint),info,info.owner);const matches=prices.filter(p=>p.attributes.symbol===`Equity.US.${stock.underlying}/USD`&&p.attributes.quote_currency==="USD");if(matches.length!==1){excluded.push({ticker:stock.ticker,mint:stock.mint,reason:"No unambiguous public Pyth USD equity feed"});continue;}
    stocks.push({ticker:stock.ticker,mint:stock.mint,tokenProgram:info.owner.toBase58(),decimals:mint.decimals,feed:matches[0].id,ratioNumerator:"1",ratioDenominator:"1",packEligible:true,extensions:getExtensionTypes(mint.tlvData).map(e=>ExtensionType[e]),source:stock.source,oracleSymbol:matches[0].attributes.symbol});}
  await mkdir("config",{recursive:true});await writeFile("config/mainnet-manifest.json",JSON.stringify({version:"1",generatedAt:new Date().toISOString(),cluster:"mainnet-beta",issuer:"Backpack",ratioSource:"https://learn.backpack.exchange/blog/tokenized-spacex-spcx",ratioMeaning:"One UI token per underlying share; onchain ScaledUiAmount multiplier is applied separately.",usdcFeed:"eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",stocks,excluded},null,2)+"\n");
  console.log(JSON.stringify({eligible:stocks.length,excluded,output:"config/mainnet-manifest.json"},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Manifest preparation failed");process.exitCode=1;});
