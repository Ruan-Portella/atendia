"use client";

import { useState } from "react";

export function PlanButtons({ plan, current, enabled, hasSubscription }: { plan: string; current: boolean; enabled: boolean; hasSubscription: boolean }) {
  const [busy, setBusy] = useState(false);
  async function go(path: string, body?: object) {
    setBusy(true);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    if (j.url) location.href = j.url;
    else {
      alert(j.message ?? "Não deu certo.");
      setBusy(false);
    }
  }
  if (current) return <button type="button" disabled={!enabled || busy} onClick={() => go("/api/stripe/portal")} className="btn w-full bg-ground text-brand hover:bg-white">Gerenciar assinatura</button>;
  return (
    <button type="button" disabled={!enabled || busy} onClick={() => go(hasSubscription ? "/api/stripe/portal" : "/api/stripe/checkout", { plan })} className="btn-primary w-full">
      {busy ? "Aguarde…" : hasSubscription ? "Trocar para este" : "Assinar"}
    </button>
  );
}
