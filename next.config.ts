import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // foto ou PDF da equipe na conversa (até 4 MB): o pedido cabe no limite de 4,5 MB da Vercel
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // o conjunto fixo de casos é lido do disco pela rota de avaliação e pela tela dela no backoffice
  // o guia do painel (base do assistente da BoaVoz) é lido do disco pelo botão do backoffice, em Operação
  outputFileTracingIncludes: { "/api/eval": ["./evals/**/*"], "/admin/avaliacao": ["./evals/**/*"], "/admin/operacao": ["./docs/assistente/**/*"], "/ajuda": ["./docs/assistente/**/*"], "/ajuda/[slug]": ["./docs/assistente/**/*"] },
  // A casa do painel é a lista de clientes (chatbots e leads ficam dentro de cada cliente).
  // cabeçalhos de segurança (relatório de segurança de 23/10/2026, M7): as telas com sessão não abrem
  // dentro de outro site (clique sequestrado); o chat do site (/w) e as demos continuam embutíveis
  async headers() {
    const noFrame = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
      ...["/painel/:path*", "/cliente/:path*", "/admin/:path*", "/login", "/cadastro", "/comecar", "/convite/:path*", "/auth/:path*"].map((source) => ({ source, headers: noFrame })),
    ];
  },
  async redirects() {
    return [
      { source: "/painel", destination: "/painel/clientes", permanent: false },
      { source: "/painel/leads", destination: "/painel/clientes", permanent: false },
    ];
  },
};

export default nextConfig;
