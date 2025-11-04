import type { NextApiRequest, NextApiResponse } from "next";

function ymd(d: Date){ return d.toISOString().slice(0,10); }
function windowFor(scope: string){
  const now = new Date(); const start = new Date(now); const end = new Date(now);
  if (scope==="last"){ start.setDate(now.getDate()-3); }
  else if (scope==="today"){ end.setDate(now.getDate()+1); }
  else { end.setDate(now.getDate()+7); } // next
  return { d1: ymd(start), d2: ymd(end) };
}
function regionsForSymbol(sym?: string){
  if (!sym) return ["United States","Euro Area"];
  const s = sym.toUpperCase();
  if (s.includes("USD") && !/(XAU|XAG|XTI|XBR)/.test(s)) return ["United States"];
  if (s.includes("EUR")) return ["Euro Area"];
  if (s.includes("GBP")) return ["United Kingdom"];
  if (s.includes("JPY")) return ["Japan"];
  if (s.includes("AUD")) return ["Australia"];
  if (s.includes("NZD")) return ["New Zealand"];
  if (s.includes("CAD")) return ["Canada"];
  return ["United States","Euro Area"];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  try{
    const scope = String((req.query.scope ?? "next")).toLowerCase(); // next|today|last
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const countries =
      typeof req.query.region === "string"
        ? req.query.region.split(",").map(s=>s.trim()).filter(Boolean)
        : regionsForSymbol(symbol);

    const { d1, d2 } = windowFor(scope);
    const c = process.env.TE_API_KEY!;
    const url = `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(countries.join(","))}/${d1}/${d2}?c=${encodeURIComponent(c)}&importance=3&f=json`;

    const r = await fetch(url, { headers: { "Accept":"application/json" }});
    if (!r.ok) throw new Error(`te_${r.status}`);
    const data:any[] = await r.json();

    const items = (Array.isArray(data) ? data : [])
      .filter(x => x?.Date && x?.Event)
      .sort((a,b)=> new Date(a.Date).getTime() - new Date(b.Date).getTime())
      .slice(0,3)
      .map(x => ({
        date: String(x.Date).slice(0,10),
        title: `${x.Event}${x.Reference ? " " + x.Reference : ""}`,
        expected_effect: "High impact",
        topic: x.Category || ""
      }));

    const lines = items.map(it => `${it.date} — ${it.title} — ${it.expected_effect}`);
    res.status(200).json({ items, lines });
  }catch(e:any){
    res.status(500).json({ error: e?.message || "news_failed" });
  }
}
