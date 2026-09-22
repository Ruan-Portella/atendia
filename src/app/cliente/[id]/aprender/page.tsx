import { requireMember } from "@/lib/member";
import { relativeTime } from "@/lib/utils";
import { UnansweredItem } from "@/components/unanswered-item";
import { TextSources, type TextSourceItem } from "@/components/text-sources";
import { memberAnswer, memberDeleteText, memberDismiss, memberSaveText } from "../../actions";

export const metadata = { title: { absolute: "Ensinar o assistente" }, robots: { index: false, follow: false } };

/** O cliente completa a base: responde o que o assistente não soube e mantém textos/FAQs. */
export default async function MemberKnowledgePage({ params }: PageProps<"/cliente/[id]/aprender">) {
  const { id } = await params;
  const { email, admin, botIds } = await requireMember(id, "knowledge");
  const ids = botIds.length ? botIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: bots }, { data: questions }, { data: sources }] = await Promise.all([
    admin.from("bots").select("id, name").in("id", ids).order("created_at"),
    admin.from("unanswered").select("id, bot_id, question, created_at").in("bot_id", ids).eq("resolved", false).order("created_at", { ascending: false }).limit(60),
    admin.from("sources").select("id, bot_id, kind, title, content, created_by, updated_at").in("bot_id", ids).in("kind", ["text", "faq"]).order("created_at"),
  ]);
  const who = (by: string | null) => (!by ? "" : by === email ? " por você" : by === "agência" ? " pela agência" : ` por ${by}`);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Ensinar o assistente</h1>
        <p className="text-sm text-muted">Responda o que ele não soube e mantenha as informações em dia. Tudo vale na próxima conversa. O site e os PDFs continuam com a agência.</p>
      </div>
      {(bots ?? []).length === 0 && <p className="text-sm text-muted">Ainda não há assistente configurado.</p>}
      {(bots ?? []).map((bot) => {
        const qs = (questions ?? []).filter((q) => q.bot_id === bot.id);
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
            {(bots ?? []).length > 1 && <h2 className="text-lg font-bold">{bot.name}</h2>}
            <div className={qs.length ? "flex flex-col gap-2.5 rounded-xl border border-[#efd9a9] bg-amber-soft px-[18px] py-4" : "rounded-xl border border-line bg-panel px-[18px] py-4"}>
              <div className={qs.length ? "text-sm font-semibold text-amber-ink" : "text-sm text-muted"}>
                {qs.length ? `${qs.length} pergunta${qs.length > 1 ? "s" : ""} que ${bot.name} não soube responder` : `Nenhuma pergunta sem resposta. ${bot.name} está dando conta!`}
              </div>
              {qs.map((q) => (
                <UnansweredItem key={q.id} question={q.question} answer={memberAnswer.bind(null, id, bot.id, q.id)} dismiss={memberDismiss.bind(null, id, bot.id, q.id)} />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Textos e perguntas frequentes</h3>
              <TextSources items={items} create={memberSaveText.bind(null, id, bot.id, null)} />
            </div>
          </section>
        );
      })}
    </>
  );
}
