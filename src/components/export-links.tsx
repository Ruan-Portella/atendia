import { Download } from "lucide-react";

const SETS = [
  { kind: "conversas", label: "Conversas", hint: "uma linha por mensagem" },
  { kind: "contatos", label: "Contatos", hint: "telefone, Instagram, nome e datas" },
  { kind: "leads", label: "Leads", hint: "nome, contato e interesse" },
] as const;

/** Exportar os dados do negócio (conversas, contatos e leads) em CSV ou JSON. */
export function ExportLinks({ clientId, description }: { clientId: string; description: string }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-base font-bold">Exportar dados</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {SETS.map((s) => (
          <li key={s.kind} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{s.label}</strong> <span className="text-xs text-muted">· {s.hint}</span>
            </span>
            <span className="flex gap-2">
              <a href={`/api/exportar?cliente=${clientId}&dados=${s.kind}&formato=csv`} className="btn-ghost py-1.5 text-xs"><Download size={13} />CSV</a>
              <a href={`/api/exportar?cliente=${clientId}&dados=${s.kind}&formato=json`} className="btn-ghost py-1.5 text-xs"><Download size={13} />JSON</a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
