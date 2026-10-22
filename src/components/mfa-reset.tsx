"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConfirmModal } from "@/components/ui/modal";

/**
 * Trocar de app autenticador: remove o fator atual (evento grave: e-mail e faixa no painel) e leva
 * ao cadastro de um novo. Painel e portal: cada um passa onde registrar e para onde ir.
 */
export function MfaReset({ factorIds, onRemoved, verifyHref }: { factorIds: string[]; onRemoved: () => Promise<void>; verifyHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function reset() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    for (const factorId of factorIds) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        setBusy(false);
        return setError("Não foi possível remover. Faça a verificação de novo e tente outra vez.");
      }
    }
    await onRemoved().catch(() => undefined);
    // a sessão perde o nível de duas etapas: o cadastro do novo vem em seguida
    await supabase.auth.refreshSession().catch(() => undefined);
    router.push(verifyHref);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setAsking(true)} disabled={busy} className="btn-ghost self-start text-xs">
        {busy ? "Removendo…" : "Trocar de app autenticador"}
      </button>
      <ConfirmModal
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void reset();
        }}
        title="Remover o app autenticador atual?"
        description="Você cadastra um novo em seguida (celular novo, app perdido…)."
        confirmLabel="Remover e cadastrar outro"
        danger
      />
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
