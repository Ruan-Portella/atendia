"use client";

import { useState } from "react";

/**
 * Regra do preço de post do Instagram (E1, parte 1; spec Peça 9), na Base de conhecimento de quem
 * tem a fonte do Instagram: o post mostra o preço do dia em que foi publicado, e a loja escolhe o que
 * o assistente faz com ele. Só as opções: o modal da linha tem o formulário e o Salvar.
 */
export function PostPriceFields({ rule, maxDays }: { rule: string; maxDays: number }) {
  const [choice, setChoice] = useState(rule);
  return (
    <>
      <fieldset className="flex flex-col gap-2.5 text-sm">
        <legend className="sr-only">O que o assistente faz com o preço de um post</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="post_price_rule" value="citar" checked={choice === "citar"} onChange={() => setChoice("citar")} className="mt-1" />
          <span>
            <span className="font-medium text-ink">Citar a data do post e confirmar a disponibilidade (recomendado)</span>
            <span className="block text-xs text-muted">Ex.: “No post de 12/08 estava R$ 89. Vou confirmar com a equipe se ainda tem.”</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="post_price_rule" value="limite" checked={choice === "limite"} onChange={() => setChoice("limite")} className="mt-1" />
          <span>
            <span className="font-medium text-ink">
              Não informar preço de post com mais de{" "}
              <input type="number" name="post_price_max_days" min={1} max={365} defaultValue={maxDays} disabled={choice !== "limite"} aria-label="Dias" className="input inline-block h-8 w-20 px-2 py-0 align-middle" /> dias
            </span>
            <span className="block text-xs text-muted">Nos posts mais velhos, o assistente nem vê o preço: diz que confirma o valor com a equipe.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="post_price_rule" value="sempre" checked={choice === "sempre"} onChange={() => setChoice("sempre")} className="mt-1" />
          <span>
            <span className="font-medium text-ink">Sempre informar o preço do post</span>
            <span className="block text-xs text-muted">Para quem mantém os preços dos posts em dia. O assistente cita a data do post.</span>
          </span>
        </label>
      </fieldset>
    </>
  );
}
