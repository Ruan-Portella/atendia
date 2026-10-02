import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o conjunto fixo de casos é lido do disco pela rota de avaliação e pela tela dela no backoffice
  outputFileTracingIncludes: { "/api/eval": ["./evals/**/*"], "/admin/avaliacao": ["./evals/**/*"] },
  // A casa do painel é a lista de clientes (chatbots e leads ficam dentro de cada cliente).
  async redirects() {
    return [
      { source: "/painel", destination: "/painel/clientes", permanent: false },
      { source: "/painel/leads", destination: "/painel/clientes", permanent: false },
    ];
  },
};

export default nextConfig;
