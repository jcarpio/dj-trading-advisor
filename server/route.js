/**
 * API Route — proxy a IBKR Bridge local
 * La app llama a /api/ibkr?endpoint=price
 * Esta route llama a http://localhost:3001/price en el Mac del usuario
 *
 * IMPORTANTE: el IBKR Bridge debe estar corriendo en el mismo ordenador
 * que el navegador (localhost:3001). Esta route NO se usa en Vercel —
 * la llamada al bridge se hace directamente desde el navegador.
 */

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") || "price";

  try {
    const res  = await fetch(`http://localhost:3001/${endpoint}`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
