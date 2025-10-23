import { fetchOhlc } from "../../src/tools/ohlc";
import { normalise } from "../../src/symbols";
import type { TF } from "../../src/signal";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = typeof body?.symbol === "string" ? body.symbol : "";
    const interval = body?.interval as TF | undefined;
    const { ohlcSymbol } = normalise(symbol);
    if (!ohlcSymbol) return Response.json({ ok: false, error: "symbol_missing" }, { status: 400 });
    if (!interval) return Response.json({ ok: false, error: "interval_required" }, { status: 400 });
    const result = await fetchOhlc(ohlcSymbol, interval);
    if (!result.ok) return Response.json(result, { status: 502 });
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ ok: false, error: "ohlc_invalid_body" }, { status: 400 });
  }
}
