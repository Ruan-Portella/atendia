import type { ApiPermission } from "./api-keys";

/*
 * Integrações por plano (spec "Limites por plano"): Freelancer não tem; o teste grátis segue o
 * Agência, com ações só de consulta e chaves só de leitura e pausa (enviar mensagens e campanhas
 * pela API fica nos planos pagos). Puro: o painel e as ações do servidor usam.
 */

/** Permissões de chave de API liberadas no teste grátis. */
export const TRIAL_KEY_PERMISSIONS: readonly ApiPermission[] = ["conversations", "contacts", "pairing"];
