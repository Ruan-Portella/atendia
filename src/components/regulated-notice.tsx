/**
 * Faixa da conversa que chegou por bebida ou remédio (regulamentados, L1): a venda não fecha pelo
 * canal da Meta. Na coexistência, a equipe responde pelo painel (o portão não vê o que sai pelo celular).
 */
export function RegulatedNotice({ channel, coexistence }: { channel: string; coexistence: boolean }) {
  const name = channel === "instagram" ? "Instagram" : "WhatsApp";
  return (
    <p className="rounded-lg border border-[#efd9a9] bg-amber-soft px-3 py-2 text-sm text-amber-ink">
      <strong>Conversa com bebida ou remédio:</strong> não feche esta venda pelo {name} nem mande Pix ou link de pagamento; ofereça o site, telefone para ligação, retirada ou o chat do site.
      {coexistence && <> <strong>Responda pelo painel, não pelo celular.</strong></>}
    </p>
  );
}
