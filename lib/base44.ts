// lib/base44.ts
export async function callBase44(from: string, text: string): Promise<string> {
  const url = process.env.B44_FN_URL;
  if (!url) return "Service unavailable. Try again shortly.";

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (process.env.B44_FN_TOKEN) headers.Authorization = `Bearer ${process.env.B44_FN_TOKEN}`;
  if (process.env.B44_FN_VERSION) headers["Base44-Functions-Version"] = process.env.B44_FN_VERSION!;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ from, text }),
    });

    const raw = await r.text();
    // Log for debugging in Vercel
    console.log("[Base44]", r.status, raw.slice(0, 300));

    try {
      const j = JSON.parse(raw);
      const reply = (j?.reply ?? "").toString().trim();
      return reply || "Service unavailable. Try again shortly.";
    } catch {
      return "Service unavailable. Try again shortly.";
    }
  } catch (e: any) {
    console.error("[Base44] fetch error:", e?.message || e);
    return "Service unavailable. Try again shortly.";
  }
}
