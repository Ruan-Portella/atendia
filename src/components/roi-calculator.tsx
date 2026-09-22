"use client";

import { useState } from "react";
import { brl } from "@/lib/plans";

export function RoiCalculator() {
  const [clients, setClients] = useState(10);
  const [price, setPrice] = useState(400);
  const plan = clients <= 3 ? 99 : clients <= 15 ? 249 : 599;
  const revenue = clients * price;
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-[#3a423e] bg-[#262c29] p-6">
      <div>
        <label htmlFor="calc-clientes" className="text-sm text-[#b9c2bd]">Clientes com chatbot</label>
        <div className="mt-2 flex items-center gap-3.5">
          <input id="calc-clientes" type="range" min={1} max={30} value={clients} onChange={(e) => setClients(Number(e.target.value))} className="flex-1 accent-[#9fd3bf]" />
          <span className="display w-12 text-right text-2xl font-bold tabular">{clients}</span>
        </div>
      </div>
      <div>
        <label htmlFor="calc-preco" className="text-sm text-[#b9c2bd]">Quanto você cobra por cliente</label>
        <div className="mt-2 flex items-center gap-3.5">
          <input id="calc-preco" type="range" min={100} max={1000} step={50} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="flex-1 accent-[#9fd3bf]" />
          <span className="display w-24 text-right text-2xl font-bold tabular">{brl(price)}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-[#3a423e] pt-4">
        <div><div className="text-xs text-[#b9c2bd]">Você fatura</div><div className="display text-2xl font-bold tabular">{brl(revenue)}</div></div>
        <div><div className="text-xs text-[#b9c2bd]">Plano {plan === 99 ? "Freelancer" : plan === 249 ? "Agência" : "Escala"}</div><div className="display text-2xl font-bold tabular">{brl(plan)}</div></div>
        <div><div className="text-xs text-[#9fd3bf]">Sobra por mês</div><div className="display text-2xl font-bold tabular text-[#9fd3bf]">{brl(revenue - plan)}</div></div>
      </div>
    </div>
  );
}
