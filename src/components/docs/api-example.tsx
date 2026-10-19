"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";

/**
 * Exemplo de uma rota da API na documentação: abas cURL e JavaScript com o botão de copiar, e a
 * resposta. Os textos vêm prontos do servidor (docs-examples.ts, da mesma fonte do Postman).
 */
export function ApiExample({ title, curl, js, status, response }: { title: string; curl: string; js: string; status: number; response: string }) {
  const [tab, setTab] = useState<"curl" | "js">("curl");
  const code = tab === "curl" ? curl : js;
  const tabClass = (on: boolean) => `px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] ${on ? "border-b-2 border-[#9fd3bf] text-[#e6efeb]" : "text-[#9fd3bf]/70 hover:text-[#e6efeb]"}`;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
      <div className="overflow-hidden rounded-xl border border-line bg-[#13241d]">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pr-2">
          <div role="tablist" aria-label={`Exemplo: ${title}`} className="flex">
            <button type="button" role="tab" aria-selected={tab === "curl"} onClick={() => setTab("curl")} className={tabClass(tab === "curl")}>
              cURL
            </button>
            <button type="button" role="tab" aria-selected={tab === "js"} onClick={() => setTab("js")} className={tabClass(tab === "js")}>
              JavaScript
            </button>
          </div>
          <CopyButton text={code} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#9fd3bf] hover:bg-white/10" />
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-[#e6efeb]">
          <code>{code}</code>
        </pre>
        <div className="border-t border-white/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#9fd3bf]">Resposta · {status}</div>
        <pre className="max-h-80 overflow-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-[#cfe0d8]">
          <code>{response}</code>
        </pre>
      </div>
    </figure>
  );
}
