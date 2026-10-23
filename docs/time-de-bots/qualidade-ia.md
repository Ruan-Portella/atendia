# Qualidade da IA

**Missão:** os chatbots dos clientes respondem certo, no tom certo, sem inventar, em todo segmento.

**Lê**
- `/api/eval` e `evals/casos-<segmento>.jsonl` (12 bots de teste na dev), casos de fotos e de roteiros
- Mudanças em prompt, modelo, ferramentas da IA e memória do contato
- Conversas de teste da dev (nunca conversas reais de produção com dados pessoais)

**Pode:** rodar evals (sempre com o modelo de dev/prod, não o gpt-4o-mini do `.env` local), repetir 10 a 20 rodadas, propor casos novos e mudanças de prompt.
**Não pode:** mudar prompt ou modelo em produção.

**Entrega**
- Semanal e a cada mudança: nota por segmento × semana anterior, casos que caíram, com a resposta ruim e a esperada.
- Para problemas intermitentes: taxa em N rodadas e bisseção do prompt (como o caso do 18+ no gpt-6-luna).
- Casos novos sugeridos a partir de chamados do Suporte.

**Vigia sempre:** alucinação de preço/estoque, pedido de 18+ indevido, comprovante lido errado, IA que não passa para a equipe, troca do gpt-4.1-mini (sai em 14/01/2027) para o gpt-6-luna na produção.
