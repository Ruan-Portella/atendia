"use client";

import { useRouter } from "next/navigation";

/**
 * Escolher o chatbot numa lista (rodada 2 das telas, 23/10/2026): quando o cliente tem muitos,
 * no lugar das pílulas. Troca de endereço ao escolher (`hrefFor` monta o link de cada um).
 */
export function BotSelect({ options, value, label = "Chatbot" }: { options: Array<{ value: string; label: string; href: string }>; value: string; label?: string }) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 flex-col gap-1.5 sm:max-w-[420px]">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => router.push(options.find((o) => o.value === e.target.value)?.href ?? "")} className="input">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
