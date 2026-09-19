"""Refresh issuer-owned Solana catalogs and download referenced logo assets.
Run with python3 scripts/import-stock-catalog.py. Review catalog diff before release.
No DEX ticker search is used to establish a mint address.
"""
import concurrent.futures, datetime, hashlib, html, json, pathlib, re, subprocess, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCES={
 'xstocks':'https://xstocks.com/products',
 'ondo-mints':'https://raw.githubusercontent.com/ondoprotocol/gm-solana-simulator/main/constants.rs',
 'ondo-metadata':'https://raw.githubusercontent.com/ondoprotocol/ondo-global-markets-token-list/main/tokenlist.json',
 'backpack':'https://api.backpack.exchange/api/v1/assets',
}
def fetch(url):
 result=subprocess.run(['curl','--fail','-Ls','--max-time','30','--retry','1',url],capture_output=True,check=True)
 return result.stdout
raw={}
with concurrent.futures.ThreadPoolExecutor(4) as pool:
 for key,data in zip(SOURCES,pool.map(fetch,SOURCES.values())):raw[key]=data
x=json.loads(re.search(rb'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',raw['xstocks'])[1])['props']['pageProps']['products']
o={t['symbol']:t for t in json.loads(raw['ondo-metadata'])['tokens']}
b=json.loads(raw['backpack'])
# Only the documented mainnet token constant; never test fixture addresses.
const=raw['ondo-mints'].decode().split('pub const GM_TOKENS:')[1].split('];')[0]
omints=re.findall(r'\("([^"]+)", "([1-9A-HJ-NP-Za-km-z]+)"\)',const)
base_meta={t['symbol'][:-2].upper():t for t in o.values() if t['symbol'].endswith('on')}
base_x={t['symbol'][:-1].upper():t for t in x if t['symbol'].endswith('x')}
leverage=re.compile(r'\b(?:[2345]\s*x|ultra\w*|inverse|bear|bull|short|leveraged|daily target)\b',re.I)
etf=re.compile(r'\b(?:ETF|ETN|ETC|iShares|Vanguard|SPDR|Invesco|ProShares|WisdomTree|Schwab|PIMCO|Global X|Fund|Treasury|S&P|Nasdaq.?100|Russell|Index|Bond|Covered Call)\b',re.I)
rows=[];excluded=[]
def add(provider,ticker,name,mint,logo,source,kind_hint=''):
 alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
 try:
  value=0
  for char in mint:value=value*58+alphabet.index(char)
  size=(value.bit_length()+7)//8+len(mint)-len(mint.lstrip('1'))
  if size!=32:raise ValueError('Invalid mint length')
 except ValueError:
  excluded.append({'provider':provider,'ticker':ticker,'reason':'Invalid Solana public key'});return
 base=ticker[:-1] if provider=='xStocks' else ticker[:-2] if provider=='Ondo' else ticker
 hint=base_meta.get(base.upper(),{}).get('name','')
 if leverage.search(name+' '+hint):excluded.append({'provider':provider,'ticker':ticker,'reason':'Leveraged or inverse product'});return
 kind='ETF' if etf.search(name+' '+hint+' '+kind_hint) else 'Stock'
 category='Funds' if kind=='ETF' else 'Stocks'
 if base in ['NVDA','AMD','MU','PLTR','ARM','MRVL','SMCI','TSM','NBIS']:category='AI'
 elif base in ['AAPL','MSFT','GOOGL','GOOG','META','TSLA','SNDK','DELL','IBM','INTC','ORCL','SHOP']:category='Tech'
 elif base in ['SPCX','RKLB','ASTS','LMT','BA']:category='Space'
 elif base in ['COIN','MSTR','CRCL','MARA','RIOT']:category='Crypto'
 rows.append({'provider':provider,'ticker':ticker,'name':name,'mint':mint,'category':category,'instrument':kind,'source':source,'logoSource':logo,'logo':'','underlying':base})
for p in x:
 if p['addresses'].get('solana'):add('xStocks',p['symbol'],re.sub(r' xStock$','',p['name']),p['addresses']['solana'],p.get('iconUrl'),'https://xstocks.com/products/'+p['slug'])
for symbol,mint in omints:
 metadata=o.get(symbol)
 if not metadata:excluded.append({'provider':'Ondo','ticker':symbol,'reason':'Issuer metadata missing'});continue
 name=re.sub(r'\s*\(Ondo Tokenized(?: Stock)?\)\s*','',metadata['name']).strip()
 add('Ondo',symbol,name,mint,metadata.get('logoURI'),'https://github.com/ondoprotocol/gm-solana-simulator/blob/main/constants.rs')
for p in b:
 if not p['symbol'].endswith('.US'):continue
 # A canonical issuer-published mint is a valid representation even while
 # Backpack deposits and withdrawals are disabled. Availability is resolved
 # separately from the existence of the representation and live execution is
 # still required before Henar offers a route.
 token=next((t for t in p.get('tokens',[]) if t.get('blockchain')=='Solana' and t.get('contractAddress')),None)
 if not token:continue
 symbol=p['symbol'][:-3];xm=base_x.get(symbol,{});om=base_meta.get(symbol,{})
 name=p['displayName']
 if name==p['symbol']:name=re.sub(r' xStock$','',xm.get('name',symbol))
 add('Backpack',symbol,name,token['contractAddress'],f'https://stock-logos.madlads.com/stocks/logos/{symbol}/72.webp','https://api.backpack.exchange/api/v1/assets')
# Logos are presentation only; mint provenance always comes from the issuer catalog.
logos=ROOT/'public/logos';logos.mkdir(parents=True,exist_ok=True)
urls=sorted({r['logoSource'] for r in rows if r['logoSource']})
def download(url):
 ext=pathlib.PurePosixPath(urllib.parse.urlparse(url).path).suffix.lower()
 if ext not in ['.png','.svg','.webp','.jpg','.jpeg']:return url,None
 filename=hashlib.sha256(url.encode()).hexdigest()[:18]+ext
 target=logos/filename
 try:
  if not target.exists():
   data=fetch(url)
   if len(data)>2_000_000:raise ValueError('Logo too large')
   if ext=='.svg' and (b'<svg' not in data or re.search(rb'<script|<!ENTITY',data,re.I)):raise ValueError('Invalid SVG')
   if ext=='.png' and not data.startswith(b'\x89PNG'):raise ValueError('Invalid PNG')
   if ext=='.webp' and not (data.startswith(b'RIFF') and data[8:12]==b'WEBP'):raise ValueError('Invalid WebP')
   target.write_bytes(data)
  return url,'/logos/'+filename
 except Exception:return url,None
results={}
with concurrent.futures.ThreadPoolExecutor(12) as pool:
 for i,(url,path) in enumerate(pool.map(download,urls)):
  results[url]=path
  if (i+1)%100==0:print(f'Checked {i+1}/{len(urls)} logos',flush=True)
for r in rows:r['logo']=results.get(r['logoSource']) or ''
# Reuse another issuer's logo only for the exact same underlying ticker.
by_underlying={r['underlying']:r for r in rows if r['logo']}
for r in rows:
 if not r['logo'] and r['underlying'] in by_underlying:
  other=by_underlying[r['underlying']];r['logo']=other['logo'];r['logoSource']=other['logoSource']
# A few issuer logo endpoints can lag a newly published asset. Keep those
# assets visible with a local ticker monogram instead of dropping the verified
# representation or relying on a remote image at runtime.
for r in rows:
 if r['logo']:continue
 label=re.sub(r'[^A-Z0-9]','',r['underlying'].upper())[:4] or 'EQ'
 filename=hashlib.sha256(('henar-equity-fallback:'+label).encode()).hexdigest()[:18]+'.svg'
 target=logos/filename
 target.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="36" fill="#202226"/><text x="36" y="40" text-anchor="middle" fill="#c8cad0" font-family="sans-serif" font-size="18" font-weight="700">{html.escape(label)}</text></svg>')
 r['logo']='/logos/'+filename
rows.sort(key=lambda r:(0 if r['ticker']=='NVDAx' else 1,r['name'].lower(),r['provider']))
assert len({r['mint'] for r in rows})==len(rows),'Duplicate mint in issuer catalogs'
assert len(rows)>500,'Unexpected source truncation'
# logoSource is how a logo was fetched, not something any page reads. It is the
# single largest field in the catalog — 187 KB of 843 KB — and stocks.json is
# imported by client components, so every byte of it shipped to the browser on
# /trade, /portfolio and /packs. Dropped after the logos are resolved.
for r in rows: r.pop('logoSource', None)
(ROOT/'src/data/stocks.json').write_text(json.dumps(rows,indent=2)+'\n')
report={'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':{k:{'url':v,'sha256':hashlib.sha256(raw[k]).hexdigest()} for k,v in SOURCES.items()},'counts':{p:sum(r['provider']==p for r in rows) for p in ['xStocks','Ondo','Backpack']},'total':len(rows),'logos':sum(bool(r['logo']) for r in rows),'missingLogos':[{'provider':r['provider'],'ticker':r['ticker']} for r in rows if not r['logo']],'excluded':excluded,'policy':'Issuer-published Solana addresses are canonical representations even when issuer deposits or withdrawals are disabled. Leveraged/inverse products excluded. Live execution is always verified separately.'}
(ROOT/'src/data/catalog-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['counts','total','logos','missingLogos']},indent=2))
