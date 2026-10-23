"use client";

import Link from "next/link";
import { useState } from "react";
import { Code2, Store, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ACCOUNT_PROFILES, PROFILE_ORDER, type AccountProfile } from "@/lib/first-access";
import { saveFirstAccess } from "@/app/comecar/actions";

const ICON: Record<AccountProfile, typeof Users> = { agency: Users, business: Store, developer: Code2 };

/**
 * O formulário do primeiro acesso: o perfil (muda o rótulo do nome da conta), o nome da conta, o
 * da pessoa e, com o assistente da BoaVoz pronto, o WhatsApp dos avisos com o aceite ao lado.
 */
export function FirstAccessForm({ brand, profile: answered, accountName, displayName, askPhone, consent }: {
  brand: string;
  /** O perfil já respondido (null no primeiro acesso; com valor, a página está mudando o perfil). */
  profile: AccountProfile | null;
  accountName: string;
  displayName: string;
  askPhone: boolean;
  consent: string;
}) {
  const [profile, setProfile] = useState<AccountProfile | null>(answered);
  const editing = answered !== null;
  const chosen = profile ? ACCOUNT_PROFILES[profile] : null;

  return (
    <div className="card w-full max-w-[520px] p-7">
      <h1 className="text-2xl font-normal">{editing ? `Como você usa o ${brand}` : `Boas-vindas ao ${brand}`}</h1>
      <p className="mt-1 text-sm text-muted">{editing ? "Os primeiros passos do painel mudam conforme a resposta." : "Umas respostas rápidas e o painel já começa pelo que importa para você."}</p>

      <ActionForm action={saveFirstAccess} className="mt-6 flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="label">Como você vai usar o {brand}?</legend>
          {/* redesenho (23/10/2026): os perfis em cartões com ícone */}
          {PROFILE_ORDER.map((k) => {
            const Icon = ICON[k];
            return (
              <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-[14px] border p-3 text-sm transition-colors duration-[120ms]", profile === k ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}>
                <input type="radio" name="profile" value={k} required checked={profile === k} onChange={() => setProfile(k)} className="sr-only" />
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", profile === k ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{ACCOUNT_PROFILES[k].label}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{ACCOUNT_PROFILES[k].hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div>
          <label htmlFor="account_name" className="label">{chosen?.nameLabel ?? "Nome da agência ou do negócio"}</label>
          <input id="account_name" name="account_name" required minLength={2} maxLength={80} defaultValue={accountName} className="input" placeholder={chosen?.namePlaceholder ?? "Norte Marketing"} />
        </div>
        <div>
          <label htmlFor="display_name" className="label">Seu nome</label>
          <input id="display_name" name="display_name" required minLength={2} maxLength={40} autoComplete="name" defaultValue={displayName} className="input" placeholder="Ana Souza" />
          <p className="mt-1 text-xs text-muted">É como a sua equipe e o assistente do {brand} chamam você. Dá para trocar em Meu perfil.</p>
        </div>
        {askPhone && (
          <div>
            <label htmlFor="phone" className="label">Seu WhatsApp (opcional)</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className="input" placeholder="(41) 99999-0000" />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{consent}</p>
          </div>
        )}
        <SubmitButton pendingLabel="Salvando…" className="btn-primary w-full py-3">
          {editing ? "Salvar" : "Começar"}
        </SubmitButton>
        {editing && (
          <Link href="/painel/clientes" className="text-center text-sm font-semibold text-muted hover:text-ink">
            Voltar ao painel
          </Link>
        )}
      </ActionForm>
    </div>
  );
}
