import { ClientConversation } from "@/components/client-conversation";

export const metadata = { title: { absolute: "Conversa" }, robots: { index: false, follow: false } };

export default async function MemberConversationPage({ params, searchParams }: PageProps<"/cliente/[id]/conversas/[cid]">) {
  const [{ id, cid }, sp] = await Promise.all([params, searchParams]);
  // ?ant=N: as N conversas anteriores da pessoa em cima desta
  return <ClientConversation clientId={id} convId={cid} earlier={Math.min(50, Number(sp.ant) || 0)} />;
}
