import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O que um chatbot derivado (D', parte 2c) usa do modelo, só para leitura: as ações, os roteiros ou
 * a base comum, com o link para mudar no modelo.
 */
export async function InheritedList({ kind, templateId, configId, templateName }: { kind: "acoes" | "roteiros" | "fontes"; templateId: string; configId: string; templateName: string }) {
  const db = createAdminClient();
  const rows =
    kind === "acoes"
      ? (((await db.from("actions").select("name, description, active").eq("bot_id", configId).order("name")).data ?? []) as Array<{ name: string; description: string | null; active: boolean }>).map((a) => ({ title: a.name, text: a.description, off: !a.active }))
      : kind === "roteiros"
        ? (((await db.from("routines").select("name, when_to_use, active").eq("bot_id", configId).order("name")).data ?? []) as Array<{ name: string; when_to_use: string | null; active: boolean }>).map((r) => ({ title: r.name, text: r.when_to_use, off: !r.active }))
        : (((await db.from("sources").select("title, kind, status").eq("bot_id", templateId).is("context", null).order("created_at")).data ?? []) as Array<{ title: string; kind: string; status: string }>).map((s) => ({ title: s.title, text: null, off: s.status !== "ready" }));
  const what = kind === "acoes" ? "As ações" : kind === "roteiros" ? "Os roteiros" : "A base comum";
  const empty = kind === "acoes" ? "O modelo ainda não tem ações." : kind === "roteiros" ? "O modelo ainda não tem roteiros." : "O modelo ainda não tem fontes.";
  return (
    <section className="card flex max-w-[860px] flex-col gap-3 p-5">
      <div>
        <h3 className="text-base font-bold">{what} {kind === "fontes" ? "vem" : "vêm"} do modelo {templateName}</h3>
        <p className="text-sm text-muted">
          {kind === "fontes" ? "Vale" : "Valem"} para este chatbot como se {kind === "fontes" ? "fosse dele" : "fossem dele"}{kind === "fontes" ? "" : ", na versão publicada em uso,"} e {kind === "fontes" ? "muda" : "mudam"} só no modelo:{" "}
          <Link href={`/painel/bots/${templateId}?tab=${kind}`} className="font-semibold text-brand underline">
            abrir o modelo
          </Link>
          .
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.title} className="flex flex-col gap-0.5 border-b border-line-2 py-2 text-sm last:border-0">
              <span className={r.off ? "font-semibold text-muted" : "font-semibold"}>
                {r.title}
                {r.off ? " (desligado)" : ""}
              </span>
              {r.text && <span className="text-xs text-muted">{r.text}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
