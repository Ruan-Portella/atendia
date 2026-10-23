import { requireMember } from "@/lib/member";
import { relativeTime } from "@/lib/utils";
import { listUnanswered } from "@/lib/unanswered";
import { UnansweredItem } from "@/components/unanswered-item";
import { TextSources, type TextSourceItem } from "@/components/text-sources";
import { memberAnswer, memberClearMomentNotice, memberDeleteText, memberDismiss, memberSaveMomentNotice, memberSaveText } from "../../actions";
import { MomentNoticeCard } from "@/components/moment-notice-card";
import { activeMomentNotice, defaultUntilInput } from "@/lib/moment-notice";
import { FileText, Megaphone } from "lucide-react";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { BotSelect } from "@/components/bot-select";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const metadata = { title: { absolute: "Ensinar o assistente" }, robots: { index: false, follow: false } };

/**
 * O cliente completa a base: responde o que o assistente não soube e mantém textos/FAQs. Com mais
 * de um chatbot, um de cada vez (rodada 2 das telas, 23/10/2026: "muito scroll com muitos
 * chatbots"): pílulas até 6, uma lista acima disso; abre no que tem mais perguntas sem resposta.
 */
export default async function MemberKnowledgePage({ params, searchParams }: PageProps<"/cliente/[id]/aprender">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { email, admin, botIds } = await requireMember(id, "knowledge");
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: bots }, questions, { data: sources }] = await Promise.all([
    admin.from("bots").select("id, name, moment_notice, moment_notice_until, moment_notice_by").in("id", ids).order("created_at"),
    listUnanswered(admin, { botIds: ids, limit: 60 }),
    admin.from("sources").select("id, bot_id, kind, title, content, created_by, updated_at").in("bot_id", ids).in("kind", ["text", "faq"]).order("created_at"),
  ]);
  const pending = (botId: string) => questions.filter((q) => q.bot_id === botId).length;
  const all = bots ?? [];
  const busiest = [...all].sort((a, b) => pending(b.id) - pending(a.id))[0];
  const chosen = all.find((b) => b.id === sp.bot) ?? busiest;
  const hrefOf = (botId: string) => `/cliente/${id}/aprender?bot=${botId}`;
  const label = (b: { id: string; name: string }) => `${b.name}${pending(b.id) ? ` · ${pending(b.id)} sem resposta` : ""}`;
  const who = (by: string | null) => (!by ? "" : by === email ? " por você" : by === "agência" ? " pela agência" : ` por ${by}`);

  return (
    <>
      <div>
        <h1 className="text-2xl font-normal">Ensinar o assistente</h1>
        <p className="text-sm text-muted">Responda o que ele não soube e mantenha as informações em dia. Tudo vale na próxima conversa. O site e os PDFs continuam com a agência.</p>
      </div>
      {all.length === 0 && <p className="text-sm text-muted">Ainda não há assistente configurado.</p>}
      {all.length > 1 && all.length <= 6 && (
        <nav aria-label="Chatbot" className="flex flex-wrap gap-1.5">
          {all.map((b) => (
            <Link key={b.id} href={hrefOf(b.id)} aria-current={b.id === chosen?.id ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors duration-[120ms]", b.id === chosen?.id ? "bg-ink font-medium text-ground" : "bg-raised/70 text-ink-2 hover:bg-raised hover:text-ink")}>
              {b.name}
              {pending(b.id) > 0 && <span className={cn("rounded-full px-1.5 font-mono text-[11px] font-medium", b.id === chosen?.id ? "bg-amber text-ground" : "bg-amber-soft text-amber-ink")}>{pending(b.id)}</span>}
            </Link>
          ))}
        </nav>
      )}
      {all.length > 6 && chosen && <BotSelect value={chosen.id} options={all.map((b) => ({ value: b.id, label: label(b), href: hrefOf(b.id) }))} />}
      {(chosen ? [chosen] : []).map((bot) => {
        const qs = questions.filter((q) => q.bot_id === bot.id);
        const items: TextSourceItem[] = (sources ?? [])
          .filter((s) => s.bot_id === bot.id)
          .map((s) => ({
            id: s.id,
            kind: s.kind,
            title: s.title,
            content: s.content ?? "",
            meta: `${s.kind === "faq" ? "Perguntas e respostas" : "Texto"} · editado ${relativeTime(s.updated_at)}${who(s.created_by)}`,
            save: memberSaveText.bind(null, id, bot.id, s.id),
            remove: memberDeleteText.bind(null, id, bot.id, s.id),
          }));
        return (
          <section key={bot.id} className="flex flex-col gap-4">
            <div className={qs.length ? "flex flex-col gap-2.5 rounded-xl border border-amber-line bg-amber-soft px-[18px] py-4" : "rounded-xl border border-line bg-panel px-[18px] py-4"}>
              <div className={qs.length ? "text-sm font-semibold text-amber-ink" : "text-sm text-muted"}>
                {qs.length ? `${qs.length} pergunta${qs.length > 1 ? "s" : ""} que ${bot.name} não soube responder` : `Nenhuma pergunta sem resposta. ${bot.name} está dando conta!`}
              </div>
              {qs.map((q) => (
                <UnansweredItem key={q.id} question={q.question} answer={memberAnswer.bind(null, id, bot.id, q.id)} dismiss={memberDismiss.bind(null, id, bot.id, q.id)} suggestion={q.suggestion} suggestedBy={q.suggestedBy} />
              ))}
            </div>
            {/* redesenho (23/10/2026): o aviso do momento e os textos em linhas que abrem um modal */}
            <SettingGroup title="Informações do assistente">
              <SettingRow icon={<Megaphone size={18} />} title="Aviso do momento" summary={activeMomentNotice(bot) ? `No ar: ${activeMomentNotice(bot)!.text}` : "Nenhum aviso agora"} summaryTone={activeMomentNotice(bot) ? "ok" : "muted"} description="Um recado com prazo que o assistente passa a dar (feriado, falta de produto, horário especial)." footer="close">
                <MomentNoticeCard
                  notice={activeMomentNotice(bot)}
                  lastUntil={bot.moment_notice_until}
                  author={who(bot.moment_notice_by).trim() || null}
                  defaultUntil={defaultUntilInput()}
                  save={memberSaveMomentNotice.bind(null, id, bot.id)}
                  clear={memberClearMomentNotice.bind(null, id, bot.id)}
                />
              </SettingRow>
              <SettingRow icon={<FileText size={18} />} title="Textos e perguntas frequentes" summary={items.length ? `${items.length} ${items.length === 1 ? "texto" : "textos"}: ${items.slice(0, 2).map((i) => i.title).join(" · ")}` : "Nenhum texto ainda"} size="lg" footer="close">
                <TextSources items={items} create={memberSaveText.bind(null, id, bot.id, null)} />
              </SettingRow>
            </SettingGroup>
          </section>
        );
      })}
    </>
  );
}
