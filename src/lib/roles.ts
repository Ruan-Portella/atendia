/*
 * Papéis da equipe da agência (leva B1'), sem dependência de servidor: o menu do painel (cliente)
 * e as regras do servidor (team.ts) leem daqui.
 */

export type AgencyRole = "owner" | "admin" | "editor" | "agent";
export type InvitableRole = Exclude<AgencyRole, "owner">;
export type MemberScope = "all" | "selected";

export const ROLE_LABELS: Record<AgencyRole, string> = { owner: "Dono", admin: "Administrador", editor: "Editor", agent: "Atendente" };

export const ROLE_HINTS: Record<InvitableRole, string> = {
  admin: "Tudo, menos cobrança e afiliados: clientes, chatbots, equipe, marca e Segurança.",
  editor: "Configura os clientes e chatbots do escopo e atende as conversas deles.",
  agent: "Só as conversas dos clientes e chatbots do escopo.",
};

export const INVITABLE_ROLES: InvitableRole[] = ["admin", "editor", "agent"];
export const isInvitableRole = (v: unknown): v is InvitableRole => INVITABLE_ROLES.includes(v as InvitableRole);

/**
 * O que cada papel pode fazer no painel:
 *  - attend: conversas (assumir, responder, devolver), dentro do escopo
 *  - config: clientes, chatbots, base, canais e demos, dentro do escopo
 *  - team: equipe; security: Segurança, retenção e pedidos do titular; brand: marca e domínio;
 *    export: exportar conversas, contatos e leads
 *  - billing: cobrança, uso e custo, afiliados
 *  - integrations: Integrações (ações, webhooks, chaves de API); o editor só vê as ações (C pública)
 */
export type Permission = "attend" | "config" | "team" | "security" | "brand" | "export" | "billing" | "integrations";

const ALLOWED: Record<Permission, readonly AgencyRole[]> = {
  attend: ["owner", "admin", "editor", "agent"],
  config: ["owner", "admin", "editor"],
  team: ["owner", "admin"],
  security: ["owner", "admin"],
  brand: ["owner", "admin"],
  export: ["owner", "admin"],
  billing: ["owner"],
  integrations: ["owner", "admin"],
};

export const can = (role: AgencyRole, perm: Permission): boolean => ALLOWED[perm].includes(role);
