import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/platform-admin";
import { getAgencies } from "@/lib/backoffice";
import { createAdminClient } from "@/lib/supabase/admin";
import { relativeTime } from "@/lib/utils";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CAMPAIGN_STATUS_LABEL, SEND_STATUS_LABEL, listCampaigns, templateProblem, tierLimit, type SendStatus } from "@/lib/campaigns";
import { listTemplates, loadTemplateChannel, templateBody, templateVariables, type Template } from "@/lib/whatsapp-templates";
import { messagingLimitTier } from "@/lib/whatsapp";
import { changeCampaignStatus, createTestCampaign, runCampaignsNow } from "../../../acoes";

export const metadata = { title: "Campanhas (teste)" };
// o Rodar agora envia por até 40 s
export const maxDuration = 60;

const KIND_LABEL = { marketing: "marketing", utility_reminder: "lembrete" } as const;
const STATUS_TONE: Record<string, string> = { sending: "text-brand", scheduled: "text-brand", paused: "text-amber-ink", canceled: "text-muted", finished: "text-ink-2" };

/**
 * Campanhas pelo backoffice (leva B3, parte 3a): cria uma campanha de teste com um modelo aprovado
 * e alguns números, roda o tique na hora e acompanha os envios. A tela das agências chega na parte 4.
 */
export default async function AdminCampaigns({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/clientes/${id}/campanhas`);
  const agency = (await getAgencies()).find((a) => a.id === id);
  if (!agency) notFound();
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id, name, client_name").eq("agency_id", id).eq("is_demo", false).order("created_at");
  const botIds = (bots ?? []).map((b) => b.id as string);
  const [campaigns, { data: lock }] = await Promise.all([listCampaigns(db, botIds, 30), db.from("cron_locks").select("last_run_at, last_ok_at").eq("name", "campanhas").maybeSingle()]);
  // cada chatbot com WhatsApp: os modelos que dá para usar e o nível do número na Meta
  const channels = await Promise.all(
    (bots ?? []).map(async (b) => {
      const ch = await loadTemplateChannel(db, b.id as string);
      if (!ch) return { bot: b, ch: null, templates: [] as Template[], tier: null, error: null };
      try {
        const [templates, tier] = await Promise.all([listTemplates(ch), messagingLimitTier(ch).catch(() => null)]);
        return { bot: b, ch, templates: templates.filter((t) => !templateProblem(t.category.toUpperCase() === "MARKETING" ? "marketing" : "utility_reminder", t)), tier, error: null };
      } catch (e) {
        return { bot: b, ch, templates: [] as Template[], tier: null, error: (e as Error).message };
      }
    }),
  );
  const botName = new Map((bots ?? []).map((b) => [b.id as string, b.name as string]));

  return (
    <>
      <div>
        <Link href={`/admin/clientes/${id}`} className="text-xs font-semibold text-muted">← {agency.name}</Link>
        <h1 className="text-[26px] font-bold">Campanhas (teste)</h1>
        <p className="text-sm text-muted">
          Motor de campanhas e lembretes do WhatsApp (B3). Cada envio confere na hora: quem respondeu SAIR, o aceite de novidades (modelo de marketing) e o 18+ (campanha de bebida ou remédio). O limite é o nível do número na Meta, em contatos únicos por 24 h, somando os chatbots da mesma conta do WhatsApp. Envio sem resposta da Meta vira incerto e não é reenviado.
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold">Tique</h2>
        <p className="text-sm text-ink-2">
          O Supabase chama o tique a cada minuto quando há campanha enviando ou agendada (pg_cron, migração 0082, com o endereço e o segredo no cofre).{" "}
          {lock?.last_run_at ? <>Último tique {relativeTime(lock.last_run_at as string)}{lock.last_ok_at && lock.last_ok_at !== lock.last_run_at ? `, último sem erro ${relativeTime(lock.last_ok_at as string)}` : ""}.</> : "Nenhum tique registrado ainda."}
        </p>
        <ResultForm action={runCampaignsNow.bind(null, id)}>
          <SubmitButton className="btn-ghost self-start py-1.5" pendingLabel="Enviando…">Rodar agora</SubmitButton>
        </ResultForm>
      </section>

      {channels.map(({ bot, ch, templates, tier, error }) => (
        <section key={bot.id as string} className="card flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-lg font-bold">{bot.name as string}</h2>
            <p className="text-xs text-muted">
              {bot.client_name as string}
              {ch ? ` · nível na Meta: ${tier ?? "desconhecido"} (${Number.isFinite(tierLimit(tier)) ? `${tierLimit(tier).toLocaleString("pt-BR")} contatos por 24 h` : "sem limite"})` : " · sem WhatsApp conectado"}
            </p>
          </div>
          {error && <p className="text-sm text-danger">A Meta não listou os modelos: {error}</p>}
          {ch && !error && (
            templates.length ? (
              <details className="rounded-lg border border-dashed border-line p-3">
                <summary className="cursor-pointer text-sm font-semibold">+ Campanha de teste</summary>
                <ResultForm action={createTestCampaign.bind(null, id)} className="mt-3">
                  <input type="hidden" name="bot" value={bot.id as string} />
                  <div><label className="label" htmlFor={`name-${bot.id}`}>Nome</label><input id={`name-${bot.id}`} name="name" maxLength={120} className="input" placeholder="Teste de envio" /></div>
                  <div>
                    <label className="label" htmlFor={`tpl-${bot.id}`}>Modelo aprovado</label>
                    <select id={`tpl-${bot.id}`} name="template" required className="input">
                      {templates.map((t) => {
                        const vars = templateVariables(templateBody(t)).length;
                        return <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} · {t.category === "MARKETING" ? "marketing" : "utilidade"} · {vars} variáve{vars === 1 ? "l" : "is"}</option>;
                      })}
                    </select>
                  </div>
                  <div><label className="label" htmlFor={`vars-${bot.id}`}>Variáveis ({"{{1}}"}, {"{{2}}"}…), uma por linha, iguais para todos</label><textarea id={`vars-${bot.id}`} name="variables" rows={2} className="input" /></div>
                  <div><label className="label" htmlFor={`phones-${bot.id}`}>WhatsApps, um por linha (até 50)</label><textarea id={`phones-${bot.id}`} name="phones" rows={3} required className="input font-mono text-xs" placeholder="21 99999-0000" /></div>
                  <div className="flex flex-wrap items-end gap-4">
                    <div><label className="label" htmlFor={`when-${bot.id}`}>Enviar em (horário de Brasília; vazio = agora)</label><input id={`when-${bot.id}`} name="scheduled_at" type="datetime-local" className="input w-auto" /></div>
                    <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="regulated" /> oferece bebida ou remédio (só para quem confirmou 18+)</label>
                  </div>
                  <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Criando…">Criar campanha</SubmitButton>
                </ResultForm>
              </details>
            ) : (
              <p className="text-sm text-muted">Nenhum modelo aprovado que o BoaVoz consiga enviar nesta conta.</p>
            )
          )}
        </section>
      ))}

      <section className="card overflow-x-auto">
        <h2 className="px-5 pt-4 text-lg font-bold">Campanhas</h2>
        <table className="mt-2 w-full min-w-[720px] text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr><th className="px-5 py-2 font-semibold">Campanha</th><th className="px-3 py-2 font-semibold">Situação</th><th className="px-3 py-2 font-semibold">Envios</th><th className="px-5 py-2 font-semibold" /></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const totals = Object.entries(c.totals ?? {}).filter(([, n]) => n > 0);
              return (
                <tr key={c.id} className="border-b border-line-2 align-top last:border-0">
                  <td className="px-5 py-2.5">
                    <span className="font-semibold">{c.name}</span>
                    <div className="text-xs text-muted">{botName.get(c.bot_id) ?? "?"} · {KIND_LABEL[c.kind]} · <span className="font-mono">{c.template_name}</span> · criada {relativeTime(c.created_at)}{c.scheduled_at ? ` · agendada para ${new Date(c.scheduled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={STATUS_TONE[c.status] ?? ""}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
                    {c.pause_reason && <div className="text-xs text-amber-ink">{c.pause_reason}</div>}
                    {c.finished_at && <div className="text-xs text-muted">terminou {relativeTime(c.finished_at)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{totals.length ? totals.map(([k, n]) => <div key={k}>{SEND_STATUS_LABEL[k as SendStatus] ?? k}: {n}</div>) : <span className="text-muted">{c.estimated_contacts ?? 0} na fila (totais no próximo tique)</span>}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-col items-end gap-1.5">
                      {(c.status === "sending" || c.status === "scheduled") && (
                        <ConfirmAction action={changeCampaignStatus.bind(null, id, c.id, "paused")} title={`Pausar ${c.name}?`} description="O que já saiu continua valendo; o resto espera retomar." confirmLabel="Pausar" danger={false} className="text-xs font-semibold text-amber-ink hover:underline">Pausar</ConfirmAction>
                      )}
                      {c.status === "paused" && (
                        <ConfirmAction action={changeCampaignStatus.bind(null, id, c.id, "sending")} title={`Retomar ${c.name}?`} description="Os envios que faltam saem a partir do próximo tique, com as mesmas conferências." confirmLabel="Retomar" danger={false} className="text-xs font-semibold text-brand hover:underline">Retomar</ConfirmAction>
                      )}
                      {["sending", "scheduled", "paused"].includes(c.status) && (
                        <ConfirmAction action={changeCampaignStatus.bind(null, id, c.id, "canceled")} title={`Cancelar ${c.name}?`} description="O que faltava enviar não sai mais. Não dá para desfazer." confirmLabel="Cancelar campanha" className="text-xs font-semibold text-danger hover:underline">Cancelar</ConfirmAction>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!campaigns.length && <tr><td colSpan={4} className="px-5 py-5 text-center text-muted">Nenhuma campanha.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
