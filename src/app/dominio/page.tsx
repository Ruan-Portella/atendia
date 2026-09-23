import Link from "next/link";
import { LogIn, MessageCircle } from "lucide-react";
import { hostAgency } from "@/lib/domain-server";
import { initials } from "@/lib/utils";
import { NEUTRAL_ICONS } from "@/lib/white-label";

export const metadata = { title: { absolute: "Atendimento" }, robots: { index: false, follow: false }, icons: NEUTRAL_ICONS };

/**
 * O que aparece em qualquer endereço do domínio próprio da agência que não seja demo,
 * portal ou widget (ex.: a raiz). Neutro, com a marca dela: nada do nosso produto.
 */
export default async function AgencyDomainPage() {
  const agency = await hostAgency();
  const name = agency?.name ?? "Atendimento";
  const wa = agency?.support_whatsapp ? `https://wa.me/${agency.support_whatsapp.replace(/\D/g, "")}` : null;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ground px-6 text-center">
      {agency?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={agency.logo_url} alt="" className="h-14 w-14 rounded-xl object-contain" />
      ) : (
        <span className="display flex h-14 w-14 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: agency?.brand_color ?? "#1f4e3d" }}>{initials(name)}</span>
      )}
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="max-w-sm text-sm text-muted">Este endereço hospeda os assistentes virtuais e relatórios de {agency ? name : "uma agência"}. Se você recebeu um link, confira se ele está completo.</p>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {/* clientes da agência entram por aqui (link mágico, sem senha) */}
        <Link href="/cliente/entrar" className={wa ? "btn-ghost" : "btn-primary"} style={wa ? undefined : { background: agency?.brand_color }}><LogIn size={15} />Área do cliente</Link>
        {wa && <a href={wa} target="_blank" rel="noopener" className="btn-primary" style={{ background: agency?.brand_color }}><MessageCircle size={15} />Falar com {name}</a>}
      </div>
    </main>
  );
}
