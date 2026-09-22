"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export function PlanButtons({ plan, current, enabled, hasSubscription }: { plan: string; current: boolean; enabled: boolean; hasSubscription: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function go(path: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.url) {
        location.href = j.url;
        return;
      }
      toast.error(j.message ?? "Não foi possível abrir o pagamento. Tente de novo em instantes.");
    } catch {
      toast.error("Sem conexão com o servidor. Verifique sua internet e tente de novo.");
    }
    setBusy(false);
  }

  if (current) {
    return (
      <button type="button" disabled={!enabled || busy} onClick={() => go("/api/stripe/portal")} className="btn w-full bg-ground text-brand hover:bg-white">
        {busy && <Loader2 size={15} className="animate-spin" />}
        Gerenciar assinatura
      </button>
    );
  }
  return (
    <button type="button" disabled={!enabled || busy} onClick={() => go(hasSubscription ? "/api/stripe/portal" : "/api/stripe/checkout", { plan })} className="btn-primary w-full">
      {busy && <Loader2 size={15} className="animate-spin" />}
      {busy ? "Abrindo…" : hasSubscription ? "Trocar para este" : "Assinar"}
    </button>
  );
}
