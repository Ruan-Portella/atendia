import { ClientConversation } from "@/components/client-conversation";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const { id, cid } = await params;
  return <ClientConversation clientId={id} convId={cid} />;
}
