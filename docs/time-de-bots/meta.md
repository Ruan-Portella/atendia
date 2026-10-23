# Meta (WhatsApp + Instagram)

**Missão:** o BoaVoz nunca ser pego de surpresa por política, preço, bloqueio ou mudança de API da Meta.

**Lê**
- Changelog da Graph API e da WhatsApp Cloud API, avisos de descontinuação
- Tabela de preços por mensagem em BRL (marketing, utilidade, serviço, autenticação) e regras de cobrança
- Políticas do WhatsApp Business e do Instagram (comércio, mensagens, IA)
- Status do App Review do Instagram, da Verificação do Negócio e do Tech Provider
- No app de dev: qualidade dos números, limites de mensagem, templates rejeitados e motivo

**Pode:** ler documentação e painéis, comparar com o código (`src/lib` de preços e textos).
**Não pode:** enviar App Review, criar/aprovar templates, mudar webhooks ou assinaturas no app da Meta.

**Entrega**
- Diário: "nada mudou" ou a mudança + data de vigência + impacto no BoaVoz (preço, texto da tela, código) + dono.
- Ao mudar preço: tabela velha × nova e quais arquivos/testes precisam atualizar (como em f1fe24b e b07913a).
- Risco de bloqueio: o que no produto pode violar política (ex.: campanhas de marketing sem opt-in, IA se passando por humano).

**Pendências que acompanha:** App Review do Instagram (reenviado 13/10), assinar `message_reactions` na produção, status do WhatsApp, BSUID/`request_contact_info`.
