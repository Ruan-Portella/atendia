import { createClient } from "@/lib/supabase/server";
import { ACTIVITIES, dayLabel, getCompliance, type ComplianceStatus } from "@/lib/acceptance";
import { relativeTime } from "@/lib/utils";
import { CATEGORIES } from "@/lib/gate/rules";
import type { ClientProfile } from "@/lib/bot-analysis";

const STATUS: Record<ComplianceStatus, { label: string; tone: string; text: string }> = {
  ativo: { label: "Ativo", tone: "bg-brand-soft text-brand", text: "Pode usar o WhatsApp e o Instagram normalmente." },
  em_revisao: { label: "Em revisão", tone: "bg-amber-soft text-amber-ink", text: "Os canais funcionam normalmente, com a trava automática de itens proibidos e regulamentados ligada." },
  aguardando_revisao: { label: "Aguardando revisão para ativar", tone: "bg-amber-soft text-amber-ink", text: "O WhatsApp só conecta depois da revisão da BoaVoz (o negócio marcou que vende acesso a um assistente de IA). O Instagram e o site funcionam." },
  bloqueado: { label: "Bloqueado", tone: "bg-danger-soft text-danger", text: "Este negócio não pode usar o WhatsApp nem o Instagram por aqui." },
};
const ANSWER: Record<string, string> = { nao: "Não", sim: "Sim", nao_sei: "Não sei" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

/** Aba Conformidade do cliente: estado do negócio, a resposta de atividades e os aceites registrados. */
export async function ClientCompliance({ clientId, clientName }: { clientId: string; clientName: string }) {
  const supabase = await createClient();
  const [compliance, { data: acceptances }, { data: client }, { data: bots }] = await Promise.all([
    getCompliance(supabase, clientId),
    supabase.from("business_acceptances").select("id, channel, version, via, status, accepted_by_name, accepted_by_email, meta_verified_name, created_at, confirmed_at").eq("client_id", clientId).order("id", { ascending: false }).limit(20),
    supabase.from("clients").select("profile").eq("id", clientId).maybeSingle(),
    supabase.from("bots").select("id, name").eq("client_id", clientId).eq("is_demo", false),
  ]);
  // análise do bot: só os itens achados na base, para consulta (sem selo nem rótulo de perfil)
  const profile = (client?.profile ?? null) as ClientProfile | null;
  const analyzed = (bots ?? []).map((b) => ({ name: b.name as string, p: profile?.bots?.[b.id as string] })).filter((x) => x.p);
  const st = compliance ? STATUS[compliance.status] : null;
  return (
    <div className="flex max-w-[720px] flex-col gap-5">
      <section className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold">Negócio e conformidade</h2>
          {st && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>}
        </div>
        {compliance && st ? (
          <>
            <p className="text-sm text-ink-2">
              {st.text}
              {(compliance.status === "em_revisao" || compliance.status === "aguardando_revisao") && compliance.reviewDueAt && ` Resposta até ${dayLabel(compliance.reviewDueAt)}.`}
              {compliance.reviewNote && ` Motivo: ${compliance.reviewNote}.`}
            </p>
            <div>
              <div className="text-sm font-semibold">Seu negócio faz alguma destas atividades?</div>
              <p className="text-xs text-muted">Respondido {relativeTime(compliance.answeredAt)}{compliance.answeredBy ? ` por ${compliance.answeredBy}` : ""}. A pergunta não se repete; para corrigir, fale com o suporte.</p>
              <ul className="mt-2 flex flex-col divide-y divide-line-2 text-sm">
                {ACTIVITIES.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-1.5">
                    <span className="text-ink-2">{a.label}</span>
                    <span className={`shrink-0 font-semibold ${compliance.answers[a.id] === "nao" ? "text-muted" : "text-amber-ink"}`}>{ANSWER[compliance.answers[a.id]] ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">{clientName} ainda não respondeu. A pergunta aparece na primeira conexão do WhatsApp ou do Instagram, junto com o aceite dos termos (no painel ou pelo link de conexão).</p>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Análise do BoaVoz</h2>
        <p className="text-xs text-muted">
          O BoaVoz analisa a base de conhecimento de cada assistente que atende pelo WhatsApp e pelo Instagram. Abaixo, os itens com regras especiais que achamos, só para consulta: nada precisa ser feito. No WhatsApp e no Instagram, bebida e remédio só aparecem para quem confirma ter 18 anos ou mais e a compra não fecha no chat; os itens proibidos ficam de fora das respostas.
        </p>
        {analyzed.length ? (
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {analyzed.map(({ name, p }) => (
              <li key={name} className="flex flex-col gap-1 py-2">
                <span className="font-semibold">{name}</span>
                <span className="text-xs text-muted">Analisado {relativeTime(p!.analisado_em)} · {p!.fontes} fonte{p!.fontes === 1 ? "" : "s"}</span>
                <span className="text-ink-2">
                  {p!.regulados.length || p!.proibidos.length
                    ? [...p!.regulados.map((x) => `${CATEGORIES[x.categoria]?.label ?? x.categoria} (18+)`), ...p!.proibidos.map((x) => `${CATEGORIES[x.categoria]?.label ?? x.categoria} (fora das respostas)`)].join(", ")
                    : "Nenhum item com regras especiais."}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Ainda não analisado. A análise roda sozinha depois que o assistente tem fontes prontas.</p>
        )}
      </section>

      <section className="card flex flex-col gap-2 p-5">
        <h2 className="text-base font-bold">Aceites registrados</h2>
        <p className="text-xs text-muted">Termos do canal e Política de Uso Aceitável, aceitos pelo próprio negócio antes de conectar. Pelo link, o aceite só vale quando a Meta conclui a conexão.</p>
        {acceptances?.length ? (
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {acceptances.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{CHANNEL[a.channel as string] ?? a.channel}</strong> · versão {a.version as string} · {a.via === "link" ? "pelo link" : "pelo painel"}
                  <span className="block text-xs text-muted">
                    {(a.accepted_by_name as string | null) ? `${a.accepted_by_name} <${a.accepted_by_email}>` : (a.accepted_by_email as string)}
                    {a.meta_verified_name ? ` · conta ${a.meta_verified_name}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted">{a.status === "pending" ? "pendente (esperando a Meta concluir)" : relativeTime((a.confirmed_at as string | null) ?? (a.created_at as string))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhum aceite ainda.</p>
        )}
      </section>
    </div>
  );
}
