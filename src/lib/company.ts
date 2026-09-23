const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

/**
 * Quem opera a plataforma, como aparece nos termos, na privacidade e no rodapé.
 * A Meta confere razão social, CNPJ e contato no site durante a verificação da empresa:
 * precisam bater com o cartão CNPJ. Campo vazio simplesmente não aparece.
 */
export const company = {
  brand,
  legalName: process.env.COMPANY_LEGAL_NAME || null,
  cnpj: process.env.COMPANY_CNPJ || null,
  address: process.env.COMPANY_ADDRESS || null,
  email: process.env.COMPANY_EMAIL || "contato@boavoz.com",
};

/** "Razão Social Ltda., CNPJ 00.000.000/0001-00", ou null enquanto os dados não estão preenchidos. */
export function companyIdentity() {
  const parts = [company.legalName, company.cnpj && `CNPJ ${company.cnpj}`].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const LEGAL_UPDATED_AT = "23 de setembro de 2026";
