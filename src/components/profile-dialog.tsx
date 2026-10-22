"use client";

import { useState } from "react";
import { Code2, Store, Users } from "lucide-react";
import { saveAccountProfile } from "@/app/comecar/actions";
import { ACCOUNT_PROFILES, PROFILE_ORDER, type AccountProfile } from "@/lib/first-access";
import { company } from "@/lib/company";
import { DialogButton } from "@/components/ui/setting-row";
import { cn } from "@/lib/utils";

const ICON: Record<AccountProfile, typeof Users> = { agency: Users, business: Store, developer: Code2 };

/** As três respostas em cartões (o campo "profile"). */
function ProfileChoice({ current }: { current: AccountProfile }) {
  const [on, setOn] = useState(current);
  return (
    <div role="radiogroup" aria-label={`Como você usa o ${company.brand}`} className="flex flex-col gap-2">
      {PROFILE_ORDER.map((k) => {
        const Icon = ICON[k];
        return (
          <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 transition-colors duration-[120ms]", on === k ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}>
            <input type="radio" name="profile" value={k} checked={on === k} onChange={() => setOn(k)} className="sr-only" />
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", on === k ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>
              <Icon size={17} />
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">{ACCOUNT_PROFILES[k].label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{ACCOUNT_PROFILES[k].hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * O "Mudar" do perfil da conta num modal (redesenho, etapa 5, a pedido do usuário em 22/10), em Marca
 * e domínio e nos primeiros passos. Só o dono da conta vê.
 */
export function ProfileButton({ current, label = "Mudar", className }: { current: AccountProfile; label?: string; className?: string }) {
  return (
    <DialogButton label={label} className={className} title={`Como você usa o ${company.brand}`} description="Os primeiros passos do painel mudam conforme a resposta." action={saveAccountProfile}>
      <ProfileChoice current={current} />
    </DialogButton>
  );
}
