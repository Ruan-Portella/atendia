import { memberForAction } from "@/lib/member";
import { getPendingHandoffs } from "@/lib/panel";
import { handoffStatus } from "@/lib/handoff-status";

/** Visitantes esperando atendente, para o aviso da área do cliente (só quem pode atender). */
export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  const ctx = /^[0-9a-f-]{36}$/i.test(clientId) ? await memberForAction(clientId, "handoff") : null;
  if (!ctx) return Response.json({ items: [] }, { status: 401 });
  const pending = await getPendingHandoffs(ctx.admin, ctx.botIds);
  const items = pending
    // pediu atendente, ou assumida e sem resposta há mais de 1 hora
    .filter((h) => handoffStatus(h)?.waiting)
    .map((h) => ({ id: h.id, href: `/cliente/${clientId}/conversas/${h.id}`, title: h.bots?.name ?? "Chat do site" }));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
