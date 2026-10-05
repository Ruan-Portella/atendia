import { createClient } from "@/lib/supabase/server";
import { MfaReset } from "@/components/mfa-reset";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Segundo fator: o app autenticador cadastrado e onde ele é pedido. */
export async function MfaSection() {
  const { data } = await (await createClient()).auth.mfa.listFactors();
  const factors = (data?.totp ?? []).filter((f) => f.status === "verified");
  return (
    <section className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-bold">Segundo fator</h2>
        <p className="text-sm text-muted">
          Código do app autenticador (Google Authenticator, Authy, 1Password…), pedido uma vez por sessão em: Segurança, exportação de dados (conversas, contatos, leads e auditoria) e conversas de chatbot em modo dados sensíveis. O resto do painel não pede o código.
        </p>
      </div>
      {factors.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {factors.map((f) => (
            <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span><strong>{f.friendly_name || "App autenticador"}</strong> · ativo</span>
              <span className="text-xs text-muted">cadastrado em {when(f.created_at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nenhum app cadastrado.</p>
      )}
      {factors.length > 0 && <MfaReset factorIds={factors.map((f) => f.id)} />}
    </section>
  );
}
