import { AgencyConversation } from "@/components/agency-conversation";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params, searchParams }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const [{ id, cid }, sp] = await Promise.all([params, searchParams]);
  // ?ant=N: as N conversas anteriores da pessoa em cima desta
  return <AgencyConversation botId={id} convId={cid} earlier={Math.min(50, Number(sp.ant) || 0)} from={typeof sp.de === "string" ? sp.de : null} />;
}
