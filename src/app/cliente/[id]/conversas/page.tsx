import { requireMember } from "@/lib/member";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConversationsBrowser } from "@/components/conversations-browser";
import { ClientConversation } from "@/components/client-conversation";
import { isConversationFilter } from "@/lib/conversation-list";
import type { InboxBot } from "@/lib/inbox";

export const metadata = { title: { absolute: "Conversas" }, robots: { index: false, follow: false } };

/**
 * Conversas do cliente. Redesenho (23/10/2026): no jeito da Caixa de entrada, a lista à esquerda e a
 * conversa ao lado, com os filtros (o mesmo do painel). A service role com os chatbots da pessoa.
 */
export default async function MemberConversationsPage({ params, searchParams }: PageProps<"/cliente/[id]/conversas">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { member, admin, botIds } = await requireMember(id);
  const { data: bots } = botIds.length ? await admin.from("bots").select("id, name, client_name, client_id, appearance, face, sensitive_mode").in("id", botIds) : { data: [] };
  return (
    <>
      {member.allowHandoff && <AutoRefresh ms={15000} />}
      <div>
        <h1 className="text-2xl font-normal">{member.allowHandoff ? "Atendimento" : "Conversas"}</h1>
        <p className="text-sm text-muted">
          {member.allowHandoff
            ? "Todas as conversas do assistente. Quando um visitante pede para falar com alguém, a conversa fica em “Com a equipe”: abra, assuma e responda."
            : "As conversas do assistente com os visitantes e os contatos, da mais recente para a mais antiga."}
        </p>
      </div>
      <ConversationsBrowser
        db={admin}
        bots={(bots ?? []) as InboxBot[]}
        filter={isConversationFilter(sp.f) ? sp.f : "todas"}
        limit={Math.min(400, Math.max(40, Number(sp.n) || 40))}
        selectedId={typeof sp.c === "string" && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null}
        earlier={Math.min(50, Number(sp.ant) || 0)}
        showBot={(bots ?? []).length > 1}
        heightClass="h-[calc(100dvh-240px)] min-h-[460px] lg:h-[calc(100dvh-180px)]"
        hrefFor={(o) => `/cliente/${id}/conversas?${[o.filter && o.filter !== "todas" ? `f=${o.filter}` : "", o.limit && o.limit > 40 ? `n=${o.limit}` : "", o.conversationId ? `c=${o.conversationId}` : "", o.earlier ? `ant=${o.earlier}` : ""].filter(Boolean).join("&")}`}
        renderConversation={(o) => <ClientConversation clientId={id} convId={o.convId} embedded back={o.back} mobileBack={o.mobileBack} earlier={o.earlier} earlierHref={o.earlierHref} />}
      />
    </>
  );
}
