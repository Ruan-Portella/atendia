import { Download, MessagesSquare, UserPlus, Users } from "lucide-react";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";

const SETS = [
  { kind: "conversas", label: "Conversas", hint: "Uma linha por mensagem", icon: MessagesSquare },
  { kind: "contatos", label: "Contatos", hint: "Telefone, Instagram, nome e datas", icon: Users },
  { kind: "leads", label: "Leads", hint: "Nome, contato e interesse", icon: UserPlus },
] as const;

/**
 * Exportar os dados do negócio (conversas, contatos e leads) em CSV ou JSON. Redesenho (23/10/2026):
 * uma linha por conjunto, com os dois formatos no canto.
 */
export function ExportLinks({ clientId, description }: { clientId: string; description: string }) {
  return (
    <section className="flex flex-col gap-2">
      <SettingGroup title="Exportar dados">
        {SETS.map((s) => {
          const Icon = s.icon;
          return (
            <SettingRow
              key={s.kind}
              icon={<Icon size={18} />}
              title={s.label}
              summary={s.hint}
              trailing={
                <span className="flex shrink-0 gap-1.5">
                  <a href={`/api/exportar?cliente=${clientId}&dados=${s.kind}&formato=csv`} className="btn-ghost py-1.5 text-xs">
                    <Download size={13} />
                    CSV
                  </a>
                  <a href={`/api/exportar?cliente=${clientId}&dados=${s.kind}&formato=json`} className="btn-ghost py-1.5 text-xs">
                    <Download size={13} />
                    JSON
                  </a>
                </span>
              }
            />
          );
        })}
      </SettingGroup>
      <p className="px-1 text-xs text-muted">{description}</p>
    </section>
  );
}
