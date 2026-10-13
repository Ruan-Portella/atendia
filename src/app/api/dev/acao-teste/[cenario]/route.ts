import { createHash } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { botActionSecrets } from "@/lib/actions";

/*
 * Endpoint de exemplo para testar as ações na dev (C pública, parte 5a): faz o papel do sistema do
 * cliente. Não existe em produção (404). Só responde a chamada assinada com o segredo de ações do
 * chatbot (como um endpoint de verdade faria) e segue o contrato de repetição: o mesmo call_id
 * devolve o mesmo corpo. Cenários (o último pedaço da URL):
 *   cardapio        consulta: itens com id e nome (inclui uma cerveja, para o portão de pedidos)
 *   ok              executa: {data: {pedido, status}}; na prévia, confirmation {summary, items, total_cents}
 *   reply           executa: {reply} (texto exato, sem IA)
 *   vazio           executa: 200 sem corpo (sucesso)
 *   nao-encontrado  404 {"error": "item esgotado"}
 *   erro            500
 *   lento           a primeira tentativa demora 25 s (o BoaVoz desiste em 20 s: incerto); "Tentar de novo" responde ok
 *   em-andamento    409 {"error": "in_progress"} na primeira; depois, ok
 */

export const maxDuration = 60;

const CARDAPIO = [
  { id: "101", nome: "Pizza Calabresa", preco: "R$ 49,90" },
  { id: "102", nome: "Pizza Marguerita", preco: "R$ 45,90" },
  { id: "201", nome: "Coca-Cola 2L", preco: "R$ 12,00" },
  { id: "202", nome: "Cerveja Heineken 600ml", preco: "R$ 14,00" },
];

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function POST(req: Request, { params }: { params: Promise<{ cenario: string }> }) {
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 });
  const { cenario } = await params;
  const raw = await req.text();
  let body: { call_id?: string; mode?: string; params?: Record<string, unknown>; bot?: { id?: string } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json(400, { error: "corpo não é JSON" });
  }

  // a assinatura, como no endpoint de um cliente (segredo de ações do chatbot, até 5 minutos)
  const db = createAdminClient();
  const botId = String(body.bot?.id ?? "").replace(/^bot_/, "");
  const secrets = /^[0-9a-f-]{36}$/.test(botId) ? await botActionSecrets(db, botId) : [];
  const headers = Object.fromEntries(req.headers.entries());
  const signed = secrets.some((s) => {
    try {
      new Webhook(s).verify(raw, headers);
      return true;
    } catch {
      return false;
    }
  });
  if (!signed) return json(401, { error: "assinatura inválida ou fora do prazo de 5 minutos" });

  const callId = String(body.call_id ?? "");
  const order = `T-${createHash("sha256").update(callId).digest("hex").slice(0, 6).toUpperCase()}`;
  const items = (Array.isArray(body.params?.itens) ? body.params.itens : []).map((id) => CARDAPIO.find((c) => c.id === String(id))?.nome ?? `item ${String(id)}`);
  // já houve tentativa com este call_id (incerta): o "Tentar de novo" responde na hora
  const repeated = async () => Boolean((await db.from("action_calls").select("id").eq("call_id", callId).limit(1)).data?.length);

  if (cenario === "cardapio") return json(200, { data: { itens: CARDAPIO } });
  if (body.mode === "preview") return json(200, { confirmation: { summary: "Pedido de teste (prévia, nada foi criado)", items: items.length ? items : ["1x Pizza Calabresa"], total_cents: 4990 } });
  if (cenario === "reply") return json(200, { reply: `Pedido ${order} registrado! Chega em uns 40 minutos.` });
  if (cenario === "vazio") return new Response(null, { status: 200 });
  if (cenario === "nao-encontrado") return json(404, { error: "item esgotado" });
  if (cenario === "erro") return json(500, { error: "falha interna de teste" });
  if (cenario === "lento" && !(await repeated())) await new Promise((r) => setTimeout(r, 25_000));
  if (cenario === "em-andamento" && !(await repeated())) return json(409, { error: "in_progress" });
  return json(200, { data: { pedido: order, status: "registrado", itens: items } });
}
