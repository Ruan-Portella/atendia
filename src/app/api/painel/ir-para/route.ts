import { createClient } from "@/lib/supabase/server";
import { goToContacts } from "@/lib/contacts";
import { relativeTime } from "@/lib/utils";
import type { GoToGroup, GoToItem } from "@/lib/go-to";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Chat do site" };

type BotRow = { id: string; name: string; client_name: string | null; appearance: { color?: string } | null; face: unknown; status: string; is_demo: boolean };
type ClientRow = { id: string; name: string; bots: Array<{ appearance: { color?: string } | null; face: unknown; is_demo: boolean; created_at: string }> | null };

/**
 * Busca do Ir para (Ctrl K): contatos, a conversa mais recente de cada um, clientes e chatbots.
 * POST porque o termo pode ser o nome de alguém: não vai para a URL nem para os registros. Com o
 * cliente da pessoa logada, a RLS limita ao escopo dela.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ groups: [] }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { q?: unknown } | null;
  const term = typeof body?.q === "string" ? body.q.trim().slice(0, 80) : "";
  const clean = term.replace(/[%_*,()\\]/g, " ").trim();
  if (clean.length < 2) return Response.json({ groups: [] });
  const like = `%${clean}%`;

  const [contacts, clientRes, botRes] = await Promise.all([
    goToContacts(supabase, term).catch(() => []),
    supabase.from("clients").select("id, name, bots(appearance, face, is_demo, created_at)").ilike("name", like).order("name").limit(5),
    supabase.from("bots").select("id, name, client_name, appearance, face, status, is_demo").ilike("name", like).order("name").limit(5),
  ]);

  const ids = contacts.map((c) => c.id);
  const { data: convRows } = ids.length
    ? await supabase.from("conversations").select("id, bot_id, contact_id, last_message_at").in("contact_id", ids).order("last_message_at", { ascending: false, nullsFirst: false }).limit(30)
    : { data: [] as Array<Record<string, unknown>> };
  const latest = new Map<string, Record<string, unknown>>();
  for (const c of convRows ?? []) if (!latest.has(c.contact_id as string)) latest.set(c.contact_id as string, c);

  const contactItems: GoToItem[] = contacts.map((c) => ({
    id: `contato-${c.id}`,
    kind: "contact",
    title: c.name || "Contato sem nome",
    sub: [c.bot.client_name, CHANNEL[c.channel] ?? c.channel].filter(Boolean).join(" · "),
    href: c.bot.client_id ? `/painel/clientes/${c.bot.client_id}/contatos/${c.id}` : undefined,
  }));
  const conversationItems: GoToItem[] = contacts.flatMap((c) => {
    const conv = latest.get(c.id);
    if (!conv) return [];
    const when = conv.last_message_at ? relativeTime(conv.last_message_at as string) : null;
    return [{ id: `conversa-${conv.id as string}`, kind: "conversation" as const, title: `Conversa com ${c.name || "o contato"}`, sub: [c.bot.name, when].filter(Boolean).join(" · "), href: `/painel/bots/${conv.bot_id as string}/conversas/${conv.id as string}` }];
  });
  const clientItems: GoToItem[] = ((clientRes.data ?? []) as ClientRow[]).map((c) => {
    const first = (c.bots ?? []).filter((b) => !b.is_demo).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return { id: c.id, kind: "client", title: c.name, sub: "Cliente", href: `/painel/clientes/${c.id}`, color: first?.appearance?.color ?? null, face: first?.face ?? null };
  });
  const botItems: GoToItem[] = ((botRes.data ?? []) as BotRow[]).map((b) => ({
    id: `bot-${b.id}`,
    kind: "bot",
    title: b.name,
    sub: [b.is_demo ? "Demo" : b.client_name, b.status === "live" ? "no ar" : null].filter(Boolean).join(" · "),
    href: `/painel/bots/${b.id}`,
    color: b.appearance?.color ?? null,
    face: b.face ?? null,
  }));

  const groups: GoToGroup[] = [
    { title: "Contatos", items: contactItems.filter((i) => i.href) },
    { title: "Conversas", items: conversationItems },
    { title: "Clientes", items: clientItems },
    { title: "Chatbots", items: botItems },
  ];
  return Response.json({ groups: groups.filter((g) => g.items.length) }, { headers: { "Cache-Control": "no-store" } });
}
