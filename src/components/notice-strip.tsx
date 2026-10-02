import { AlertTriangle } from "lucide-react";

/**
 * Faixa de aviso do painel (plano, IA pausada, canal suspenso…): colada no topo da área de
 * conteúdo, de ponta a ponta, fora do espaçamento das páginas. Assim não empurra nem sobrepõe
 * telas que ocupam a largura toda (editor do chatbot, conversa).
 */
export function NoticeStrip({ tone = "danger", action, children }: { tone?: "danger" | "warn"; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6 lg:px-9 ${tone === "danger" ? "border-[#f0c9c9] bg-danger-soft text-danger" : "border-[#efd9a9] bg-amber-soft text-amber-ink"}`}>
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
