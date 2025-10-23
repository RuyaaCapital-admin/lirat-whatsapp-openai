import { fetchLatestPrice } from "../../src/tools/price";
import { normalise } from "../../src/symbols";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = typeof body?.symbol === "string" ? body.symbol : "";
    const { pricePair } = normalise(symbol);
    if (!pricePair.includes("/")) {
      return Response.json({ ok: false, error: "symbol_missing_slash" }, { status: 400 });
    }
    const result = await fetchLatestPrice(pricePair);
    if (!result.ok) {
      return Response.json(result, { status: 502 });
    }
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ ok: false, error: "price_invalid_body" }, { status: 400 });
  }
}
