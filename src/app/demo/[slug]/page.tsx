import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChatWindow } from "@/components/chat-window";
import { initials } from "@/lib/utils";
import { brl } from "@/lib/plans";

export async function generateMetadata({ params }: PageProps<"/demo/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("client_name, agency_id").eq("demo_slug", slug).maybeSingle();
  if (!bot) return { title: "Demonstração" };
  const { data: agency } = await db.from("agencies").select("name").eq("id", bot.agency_id).single();
  return { title: `Assistente de IA para ${bot.client_name}`, description: `Demonstração preparada por ${agency?.name ?? ""}.`, robots: { index: false } };
}

/** Página pública que a agência manda para o prospect. White-label: só a marca da agência aparece. */
export default async function DemoPage({ params }: PageProps<"/demo/[slug]">) {
  const { slug } = await params;
  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("demo_slug", slug).eq("is_demo", true).maybeSingle();
  if (!bot) notFound();
  const { data: agency } = await db.from("agencies").select("name, logo_url, brand_color, support_whatsapp").eq("id", bot.agency_id).single();
  await db.rpc("increment_demo_views", { p_slug: slug });

  const color = bot.appearance?.color ?? agency?.brand_color ?? "#1f4e3d";
  const wa = agency?.support_whatsapp ? `https://wa.me/${agency.support_whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Oi! Vi a demo do assistente para ${bot.client_name} e quero saber mais.`)}` : null;
  const price = bot.price_cents ? brl(bot.price_cents / 100) : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-6 py-4 md:px-12">
        <div className="flex items-center gap-2.5">
          {agency?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agency.logo_url} alt="" className="h-8 w-8 rounded-lg object-contain" />
          ) : (
            <span className="display flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold text-ink" style={{ background: "#e9a23b" }}>{initials(agency?.name ?? "A")}</span>
          )}
          <span className="display text-lg font-bold">{agency?.name}</span>
        </div>
        {wa && <a href={wa} className="btn-primary">Falar com a {agency?.name} no WhatsApp</a>}
      </header>

      <main className="grid flex-1 gap-10 px-6 py-10 md:grid-cols-[minmax(0,1fr)_440px] md:px-12">
        <div className="flex flex-col gap-5">
          <span className="self-start rounded-full bg-amber-soft px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-amber-ink">Demonstração preparada para {bot.client_name}</span>
          <h1 className="text-3xl font-bold leading-[1.08] md:text-[44px]" style={{ textWrap: "balance" }}>Um assistente que responde seus clientes 24 horas, treinado no seu próprio site.</h1>
          <p className="max-w-[600px] text-[17px] leading-relaxed text-ink-2">
            Montamos este assistente lendo o site {bot.client_site?.replace(/^https?:\/\//, "") ?? "da empresa"}. Ele já sabe o que vocês oferecem, horários, valores e como chegar. Teste ao lado com qualquer pergunta que um cliente faria.
          </p>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Stat value="62%" text="das mensagens de clientes chegam fora do horário comercial" />
            <Stat value="< 3 s" text="para responder qualquer pergunta sobre a empresa" />
            <Stat value={price ?? "R$ —"} text={price ? `por mês, instalado e mantido pela ${agency?.name}` : `instalado e mantido pela ${agency?.name}`} />
          </div>
          <div className="card flex flex-col gap-2.5 px-5 py-4">
            <span className="kpi-label">O que está incluso</span>
            <div className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
              <span>Assistente no site</span><span>Pedidos de contato no seu WhatsApp</span><span>Atualização automática com o site</span><span>Relatório mensal de perguntas</span>
            </div>
          </div>
          {wa && (
            <div className="mt-auto flex flex-wrap items-center gap-3.5">
              <a href={wa} className="btn-primary px-5 py-3.5 text-[15px]">Quero no meu site</a>
              <span className="text-[13px] text-muted">Sem fidelidade. Fica no ar em 24 horas.</span>
            </div>
          )}
        </div>
        <div className="h-[600px] overflow-hidden rounded-2xl shadow-[0_16px_40px_rgba(27,31,29,0.12)]">
          <ChatWindow
            channel="demo"
            bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: bot.appearance?.avatar_text ?? initials(bot.client_name), welcome: bot.persona?.welcome ?? `Olá! Sou o assistente de ${bot.client_name}. Como posso ajudar?`, suggestedQuestions: bot.appearance?.suggested_questions ?? [], poweredBy: agency?.name ?? null }}
          />
        </div>
      </main>
    </div>
  );
}

function Stat({ value, text }: { value: string; text: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="display text-[28px] font-bold leading-tight">{value}</span>
      <span className="text-[13px] leading-snug text-ink-2">{text}</span>
    </div>
  );
}
