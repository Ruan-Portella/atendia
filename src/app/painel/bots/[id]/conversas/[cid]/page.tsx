import { AgencyConversation } from "@/components/agency-conversation";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: PageProps<"/painel/bots/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  return <AgencyConversation botId={id} convId={cid} />;
}
