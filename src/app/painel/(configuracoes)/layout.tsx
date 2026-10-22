import { requireAgency } from "@/lib/agency";
import { settingsFor } from "@/lib/nav";
import { SettingsNav } from "@/components/settings-nav";

/**
 * Configurações numa tela só (redesenho, etapa 1): marca, equipe, segurança, cobrança,
 * integrações, modelos e demos ficam lado a lado, com o menu de ajustes. Os endereços não mudam.
 */
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const { role, packs } = await requireAgency();
  const groups = settingsFor(role, packs).map((g) => ({ group: g.group, items: g.items.map(({ href, label }) => ({ href, label })) }));
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className="flex flex-col gap-3 lg:sticky lg:top-7">
        <div className="eyebrow">Configurações</div>
        <SettingsNav groups={groups} />
      </div>
      <div className="flex min-w-0 flex-col gap-5 md:gap-6">{children}</div>
    </div>
  );
}
