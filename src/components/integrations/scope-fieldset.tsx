/** Escopo de chave de API ou webhook: chatbots escolhidos, todos de um cliente ou todos da agência. */
export function ScopeFieldset({
  bots,
  clients,
  allLabel = "Todos os chatbots da agência (inclusive os futuros)",
  value,
}: {
  bots: Array<{ id: string; name: string; clientName: string }>;
  clients: Array<{ id: string; name: string }>;
  allLabel?: string;
  /** escopo já gravado (edição) */
  value?: { type: string; botIds: string[]; clientId: string | null };
}) {
  const type = value?.type ?? "bots";
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="label">Escopo</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value="bots" defaultChecked={type === "bots"} /> Estes chatbots:
      </label>
      <div className="ml-6 flex flex-col gap-1">
        {bots.map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="bot" value={b.id} defaultChecked={value?.botIds.includes(b.id)} /> {b.name} <span className="text-muted">({b.clientName})</span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value="client" defaultChecked={type === "client"} /> Todos os chatbots do cliente (inclusive os futuros):
      </label>
      <select name="client_id" className="input ml-6 w-auto text-xs" defaultValue={value?.clientId ?? ""} aria-label="Cliente">
        <option value="">escolha…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="scope_type" value="all" defaultChecked={type === "all"} /> {allLabel}
      </label>
    </fieldset>
  );
}
