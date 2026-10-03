import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/platform-admin";
import { getAgencies } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { relativeTime } from "@/lib/utils";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteAction, generateActionSecret, saveAction, testAction } from "../../../acoes";
import type { ActionRow } from "@/lib/actions";

export const metadata = { title: "Integrações (piloto)" };
// o Testar chama o endpoint (até 8 s) e salvar classifica a ação com IA
export const maxDuration = 30;

const EXAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "categoria": { "type": "string", "description": "categoria do cardápio, ex.: pizzas" }
  },
  "required": []
}`;

/** Segredo anterior ainda valendo (troca sem queda): até quando. */
function previousSecretNote(until: string | null): string {
  return until && Date.parse(until) > Date.now() ? ` O anterior vale até ${new Date(until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "";
}

const STATUS_TONE: Record<string, string> = { ok: "text-brand", not_found: "text-amber-ink", error: "text-danger", timeout: "text-danger", uncertain: "text-danger", blocked: "text-danger" };

/**
 * Integrações dos pilotos (P1), configuradas à mão pelo BoaVoz: segredo de ações por chatbot,
 * ações de consulta e o registro das chamadas. As telas para a agência chegam na C pública.
 */
export default async function AdminIntegrations({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/clientes/${id}/integracoes`);
  const agency = (await getAgencies()).find((a) => a.id === id);
  if (!agency) notFound();
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id, name, client_name, action_secret_enc, action_secret_prev_until").eq("agency_id", id).eq("is_demo", false).order("created_at");
  const botIds = (bots ?? []).map((b) => b.id as string);
  const { data: actionRows } = botIds.length ? await db.from("actions").select("*").in("bot_id", botIds).order("name") : { data: [] };
  const actions = (actionRows ?? []) as unknown as Array<ActionRow & { updated_at: string }>;
  const { data: calls } = actions.length
    ? await db.from("action_calls").select("id, action_id, call_id, attempt, mode, status, http_status, duration_ms, created_at").in("action_id", actions.map((a) => a.id)).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const actionName = new Map(actions.map((a) => [a.id, a.name]));

  return (
    <>
      <div>
        <Link href={`/admin/clientes/${id}`} className="text-xs font-semibold text-muted">← {agency.name}</Link>
        <h1 className="text-[26px] font-bold">Integrações (piloto)</h1>
        <p className="text-sm text-muted">
          Ações de consulta que a IA chama durante a conversa, configuradas à mão pela equipe BoaVoz (P1). Cada chamada é assinada no padrão Standard Webhooks com o segredo de ações do chatbot; prazo de 8 s e resposta até 32 KB. Ação que parece criar pedido, reserva ou cobrança fica desativada até a C pública.
        </p>
      </div>

      {(bots ?? []).map((b) => {
        const mine = actions.filter((a) => a.bot_id === b.id);
        return (
          <section key={b.id as string} className="card flex flex-col gap-4 p-5">
            <div>
              <h2 className="text-lg font-bold">{b.name as string}</h2>
              <p className="text-xs text-muted">{b.client_name as string} · bot_{b.id as string}</p>
            </div>

            <ResultForm action={generateActionSecret.bind(null, id, b.id as string)} copy className="rounded-lg border border-line-2 p-3">
              <div className="text-sm font-semibold">Segredo de ações</div>
              <p className="text-xs text-muted">
                {b.action_secret_enc ? "Configurado." : "Ainda não gerado: as ações deste chatbot não funcionam sem ele."}
                {previousSecretNote(b.action_secret_prev_until as string | null)} Mostrado uma vez; quem perder, gera outro.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton className="btn-ghost py-1.5" pendingLabel="Gerando…">{b.action_secret_enc ? "Trocar o segredo" : "Gerar segredo"}</SubmitButton>
                {Boolean(b.action_secret_enc) && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name="invalidate" /> invalidar o anterior agora (vazou)
                  </label>
                )}
              </div>
            </ResultForm>

            {mine.map((a) => (
              <details key={a.id} className="rounded-lg border border-line-2 p-3">
                <summary className="cursor-pointer text-sm">
                  <strong className="font-mono">{a.name}</strong>{" "}
                  <span className={a.active ? "text-brand" : "text-muted"}>{a.active ? "ativa" : "desativada"}</span>
                  {a.creates_order && <span className="text-danger"> · parece criar pedido (fica desativada até a C pública)</span>}
                  <span className="block truncate text-xs text-muted">{a.url}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  <ActionFields action={saveAction.bind(null, id, b.id as string, a.id)} a={a} label="Salvar" />
                  <ResultForm action={testAction.bind(null, id, a.id)} className="border-t border-line-2 pt-3">
                    <label className="label" htmlFor={`test-${a.id}`}>Testar (chama o endpoint de verdade, com test: true)</label>
                    <textarea id={`test-${a.id}`} name="params" rows={3} className="input font-mono text-xs" defaultValue="{}" />
                    <SubmitButton className="btn-ghost self-start py-1.5" pendingLabel="Chamando…">Testar</SubmitButton>
                  </ResultForm>
                  <ConfirmAction action={deleteAction.bind(null, id, a.id)} title={`Apagar a ação ${a.name}?`} description="A IA deixa de ter esta ação. O registro das chamadas é apagado junto." confirmLabel="Apagar" className="self-start text-xs font-semibold text-danger hover:underline">
                    Apagar ação
                  </ConfirmAction>
                </div>
              </details>
            ))}

            <details className="rounded-lg border border-dashed border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">+ Nova ação de consulta</summary>
              <div className="mt-3">
                <ActionFields action={saveAction.bind(null, id, b.id as string, null)} label="Criar ação" />
              </div>
            </details>
          </section>
        );
      })}

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Últimas chamadas</h2>
        {calls?.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Quando</th><th className="py-1 font-semibold">Ação</th><th className="py-1 font-semibold">Modo</th><th className="py-1 font-semibold">Resultado</th><th className="py-1 text-right font-semibold">Tempo</th></tr></thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id as number} className="border-t border-line-2">
                  <td className="py-1.5">{relativeTime(c.created_at as string)}</td>
                  <td className="py-1.5 font-mono">{actionName.get(c.action_id as string)}</td>
                  <td className="py-1.5">{c.mode as string}{(c.attempt as number) > 1 ? ` · tentativa ${c.attempt}` : ""}</td>
                  <td className={`py-1.5 font-semibold ${STATUS_TONE[c.status as string] ?? ""}`}>{c.status as string}{c.http_status ? ` · ${c.http_status}` : ""}</td>
                  <td className="py-1.5 text-right">{c.duration_ms as number} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Nenhuma chamada ainda.</p>
        )}
      </section>
    </>
  );
}

function ActionFields({ action, a, label }: { action: (fd: FormData) => Promise<import("@/lib/action-result").ActionResult>; a?: ActionRow; label: string }) {
  const p = a?.id ?? "nova";
  return (
    <ResultForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor={`name-${p}`}>Nome (snake_case)</label><input id={`name-${p}`} name="name" required defaultValue={a?.name ?? ""} className="input font-mono" placeholder="buscar_cardapio" /></div>
        <div><label className="label" htmlFor={`url-${p}`}>URL (HTTPS)</label><input id={`url-${p}`} name="url" required defaultValue={a?.url ?? ""} className="input" placeholder="https://api.loja.com/boavoz/cardapio" /></div>
      </div>
      <div><label className="label" htmlFor={`desc-${p}`}>Descrição (o que a IA lê para decidir quando chamar)</label><textarea id={`desc-${p}`} name="description" required rows={2} maxLength={500} defaultValue={a?.description ?? ""} className="input" placeholder="Use quando o cliente perguntar o que tem no cardápio, preços ou se um prato está disponível." /></div>
      <div><label className="label" htmlFor={`schema-${p}`}>Parâmetros (JSON Schema, até 10, tipos simples)</label><textarea id={`schema-${p}`} name="params_schema" rows={6} defaultValue={a ? JSON.stringify(a.params_schema, null, 2) : EXAMPLE_SCHEMA} className="input font-mono text-xs" /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`level-${p}`}>Nível mínimo do contato</label>
          <select id={`level-${p}`} name="min_level" defaultValue={a?.min_level ?? "anonimo"} className="input">
            <option value="anonimo">anônimo (qualquer contato)</option>
            <option value="canal">canal (telefone conhecido no WhatsApp)</option>
            <option value="usuario">usuário (identificado, P2)</option>
          </select>
        </div>
        <div><label className="label" htmlFor={`out-${p}`}>Resultados (opcional, separados por vírgula)</label><input id={`out-${p}`} name="outcomes" defaultValue={a?.outcomes?.join(", ") ?? ""} className="input font-mono" /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={a ? a.active : true} /> Ativa</label>
      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Salvando (classificando o efeito)…">{label}</SubmitButton>
    </ResultForm>
  );
}
