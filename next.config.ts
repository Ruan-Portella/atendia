import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // o conjunto fixo de casos é lido do disco pela rota de avaliação
  outputFileTracingIncludes: { "/api/eval": ["./evals/**/*"] },
  // A casa do painel é a lista de clientes (chatbots e leads ficam dentro de cada cliente).
  async redirects() {
    return [
      { source: "/painel", destination: "/painel/clientes", permanent: false },
      { source: "/painel/leads", destination: "/painel/clientes", permanent: false },
    ];
  },
};

export default nextConfig;
