import { Bot, FileCheck2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ACTIVITIES, dayLabel, getCompliance, type ComplianceStatus } from "@/lib/acceptance";
import { relativeTime } from "@/lib/utils";
import { CATEGORIES } from "@/lib/gate/rules";
import type { ClientProfile } from "@/lib/bot-analysis";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";

const STATUS: Record<ComplianceStatus, { label: string; tone: "ok" | "warn" | "danger"; text: string }> = {
  ativo: { label: "Ativo", tone: "ok", text: "Pode usar o WhatsApp e o Instagram normalmente." },
  em_revisao: { label: "Em revisão", tone: "warn", text: "Os canais funcionam normalmente, com a trava automática de itens proibidos e regulamentados ligada." },
  aguardando_revisao: { label: "Aguardando revisão para ativar", tone: "warn", text: "O WhatsApp só conecta depois da revisão da BoaVoz (o negócio marcou que vende acesso a um assistente de IA). O Instagram e o site funcionam." },
  bloqueado: { label: "Bloqueado", tone: "danger", text: "Este negócio não pode usar o WhatsApp nem o Instagram por aqui." },
};
const ANSWER: Record<string, string> = { nao: "Não", sim: "Sim", nao_sei: "Não sei" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram" };

/**
 * Aba Conformidade do cliente: estado do negócio, a resposta de atividades, a análise do BoaVoz e os
 * aceites registrados. Redesenho (23/10/2026): tudo em linhas; as respostas de atividades abrem num
 * modal só de leitura.
 */
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
  const analyzed = (bots ?? []).map((b) => ({ name: b.name as string, p: profile?.bots?.[b.id as string] }));
  const st = compliance ? STATUS[compliance.status] : null;
  const flagged = compliance ? ACTIVITIES.filter((a) => compliance.answers[a.id] && compliance.answers[a.id] !== "nao").length : 0;
  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <SettingGroup title="Negócio e conformidade">
        {compliance && st ? (
          <SettingRow
            icon={<ShieldCheck size={18} />}
            title="Situação do negócio"
            badge={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
            summary={`${st.text}${(compliance.status === "em_revisao" || compliance.status === "aguardando_revisao") && compliance.reviewDueAt ? ` Resposta até ${dayLabel(compliance.reviewDueAt)}.` : ""}${compliance.reviewNote ? ` Motivo: ${compliance.reviewNote}.` : ""}`}
            description={`Respondido ${relativeTime(compliance.answeredAt)}${compliance.answeredBy ? ` por ${compliance.answeredBy}` : ""}. A pergunta não se repete; para corrigir, fale com o suporte.`}
            dialogTitle="As atividades do negócio"
            footer="close"
          >
            <ul className="flex flex-col divide-y divide-line-2 text-sm">
              {ACTIVITIES.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-2">
                  <span className="text-ink-2">{a.label}</span>
                  <span className={`shrink-0 font-semibold ${compliance.answers[a.id] === "nao" ? "text-muted" : "text-amber-ink"}`}>{ANSWER[compliance.answers[a.id]] ?? "—"}</span>
                </li>
              ))}
            </ul>
            {flagged === 0 && <p className="text-xs text-muted">Nenhuma atividade marcada.</p>}
          </SettingRow>
        ) : (
          <SettingRow icon={<ShieldCheck size={18} />} title="Situação do negócio" summary={`${clientName} ainda não respondeu: a pergunta aparece na primeira conexão do WhatsApp ou do Instagram, junto com o aceite dos termos.`} />
        )}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <SettingGroup title="Análise do BoaVoz">
          {analyzed.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum chatbot ainda.</p>}
          {analyzed.map(({ name, p }) => (
            <SettingRow
              key={name}
              icon={<Bot size={18} />}
              title={name}
              badge={p ? <span className="text-[12px] text-muted">analisado {relativeTime(p.analisado_em)} · {p.fontes} fonte{p.fontes === 1 ? "" : "s"}</span> : undefined}
              summary={
                !p
                  ? "Ainda não analisado: a análise roda sozinha depois que o assistente tem fontes prontas"
                  : p.regulados.length || p.proibidos.length
                    ? [...p.regulados.map((x) => `${CATEGORIES[x.categoria]?.label ?? x.categoria} (18+)`), ...p.proibidos.map((x) => `${CATEGORIES[x.categoria]?.label ?? x.categoria} (fora das respostas)`)].join(", ")
                    : "Nenhum item com regras especiais"
              }
              summaryTone={p && (p.regulados.length || p.proibidos.length) ? "warn" : "muted"}
            />
          ))}
        </SettingGroup>
        <p className="px-1 text-xs text-muted">O BoaVoz analisa a base de cada assistente que atende pelo WhatsApp e pelo Instagram. É só para consulta: nada precisa ser feito. Bebida e remédio só aparecem para quem confirma ter 18 anos ou mais.</p>
      </section>

      <section className="flex flex-col gap-2">
        <SettingGroup title="Aceites registrados">
          {!acceptances?.length && <p className="px-4 py-5 text-sm text-muted">Nenhum aceite ainda.</p>}
          {(acceptances ?? []).map((a) => (
            <SettingRow
              key={a.id as number}
              icon={<FileCheck2 size={18} />}
              title={`${CHANNEL[a.channel as string] ?? a.channel} · versão ${a.version as string}`}
              summary={`${a.via === "link" ? "Pelo link" : "Pelo painel"} · ${(a.accepted_by_name as string | null) ? `${a.accepted_by_name} (${a.accepted_by_email})` : (a.accepted_by_email as string)}${a.meta_verified_name ? ` · conta ${a.meta_verified_name}` : ""}`}
              trailing={a.status === "pending" ? <StatusPill tone="warn">esperando a Meta</StatusPill> : <span className="shrink-0 text-xs text-muted">{relativeTime((a.confirmed_at as string | null) ?? (a.created_at as string))}</span>}
            />
          ))}
        </SettingGroup>
        <p className="px-1 text-xs text-muted">Termos do canal e Política de Uso Aceitável, aceitos pelo próprio negócio antes de conectar. Pelo link, o aceite só vale quando a Meta conclui a conexão.</p>
      </section>
    </div>
  );
}
