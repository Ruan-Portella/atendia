import { PriceInput } from "@/components/ui/price-input";

/** Campos do cliente (usado aqui e na aba "Dados" do painel do cliente). No negócio, sem o "quanto você cobra". */
export function ClientFields({ name, site, priceCents, business = false }: { name?: string; site?: string | null; priceCents?: number | null; business?: boolean }) {
  return (
    <>
      <div>
        <label htmlFor="cl-name" className="label">{business ? "Nome do seu negócio" : "Nome do cliente (empresa)"}</label>
        <input id="cl-name" name="name" required minLength={2} maxLength={80} defaultValue={name} className="input" placeholder="Clínica Sorriso" />
      </div>
      <div>
        <label htmlFor="cl-site" className="label">Site (opcional)</label>
        <input id="cl-site" name="site" maxLength={200} defaultValue={site ?? ""} className="input" placeholder="clinicasorriso.com.br" />
      </div>
      {!business && (
        <div>
          <label htmlFor="cl-price" className="label">Quanto você cobra por mês (só para o seu controle)</label>
          <PriceInput id="cl-price" name="price" defaultCents={priceCents} className="max-w-[220px]" />
          <p className="mt-1 text-xs text-muted">Qualquer valor, com vírgula para centavos (ex.: 55 ou 189,90).</p>
        </div>
      )}
    </>
  );
}
