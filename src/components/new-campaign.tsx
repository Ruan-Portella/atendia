"use client";

import { useState } from "react";
import { BellRing, Megaphone } from "lucide-react";
import { CampaignWizard, Step } from "@/components/campaign-wizard";
import { ReminderWizard } from "@/components/reminder-wizard";
import { cn } from "@/lib/utils";

interface BotOption {
  id: string;
  name: string;
  clientName: string;
}

const KINDS = [
  { id: "marketing", title: "Marketing", hint: "Promoções e novidades, só para quem aceitou receber.", icon: Megaphone },
  { id: "lembrete", title: "Lembrete de utilidade", hint: "Consulta, vencimento, revisão: uma planilha com a data e a hora de cada um.", icon: BellRing },
] as const;

/**
 * Nova campanha no painel lateral da lista de Campanhas (redesenho, etapa 5): o tipo em cartões e o
 * assistente do tipo escolhido (o mesmo da tela Nova campanha). Ao criar, abre o relatório.
 */
export function NewCampaignFlow({ bots }: { bots: BotOption[] }) {
  const [kind, setKind] = useState<"marketing" | "lembrete">("marketing");
  if (!bots.length)
    return <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">Nenhum chatbot com o WhatsApp conectado. As campanhas saem pelo número do chatbot: conecte o WhatsApp na página dele.</p>;
  return (
    <div className="flex flex-col gap-4">
      <Step n={1} title="Tipo">
        <div role="radiogroup" aria-label="Tipo da campanha" className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                onClick={() => setKind(k.id)}
                className={cn("flex items-start gap-3 rounded-[14px] border p-3 text-left transition-colors duration-[120ms]", kind === k.id ? "border-brand bg-brand-soft/60" : "border-line hover:border-line-strong")}
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", kind === k.id ? "bg-brand text-on-brand" : "bg-raised text-ink-2")}>
                  <Icon size={17} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{k.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{k.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Step>
      {kind === "lembrete" ? <ReminderWizard key="lembrete" bots={bots} /> : <CampaignWizard key="marketing" bots={bots} />}
    </div>
  );
}
