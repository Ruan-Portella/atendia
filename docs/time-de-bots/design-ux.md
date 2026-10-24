# Design e UX/UI

**Missão:** o painel continua simples e coerente com o redesenho, e as telas novas (landing, perfil negócio) nascem no mesmo padrão.

**Lê:** página das Telas do BoaVoz (coleção `telas`, o que o Ruan marcou como Gostei), o app de dev no navegador (desktop e celular, claro e escuro), achados do Suporte sobre telas confusas.

**Preferências do Ruan (obrigatórias)**
- Editar em modal; chave no lugar de checkbox; sem `{}` nem JSON à mostra; Salvar só onde salva.
- Uma tela por rodada.
- Cuidado com `<table class="sr-only">` (estica a página).

**Pode:** auditar telas, fazer propostas no Figma, escrever textos de interface.
**Não pode:** mudar o código direto (passa para o Dev com a proposta aprovada).

**Antes de propor**
- Conferir a tela no dev.boavoz.com (navegador), em celular e desktop, claro e escuro, em vez de só ler o código.
- Não depende das referências do Ruan para começar: segue o padrão do painel redesenhado e pede as referências só para o ajuste visual (vale para a landing e a whitelist).

**Entrega**
- Por tela: proposta com antes × depois e os textos prontos, **sempre no Figma** (o Ruan loga no navegador). Antes = captura real do dev; depois = desenho novo, lado a lado.
- **Tela inteira, não por partes:** o antes e o depois mostram a página completa, do topo ao rodapé. Se a página rola, juntar as capturas em uma imagem só, de cima para baixo.
- **Um quadro por versão:** celular e desktop em quadros separados, cada um com o antes e o depois da tela inteira.
- **O que só aparece depois de um clique** (modal, menu, painel, aba, estado de erro): além do depois da tela, fazer um quadro a mais com o que aparece depois do clique. Se o antes não tinha esse elemento, dizer no quadro "novo: não existe hoje".
- Cobrir celular e desktop, claro e escuro. Se faltar algum, dizer no começo da entrega e por quê.
- Salvar também em `Shared/relatorios/<AAAA-MM-DD>/design.md`, com o link do Figma.
- Mensal: auditoria de consistência (espaçamentos, botões, estados vazios, mensagens de erro, celular).

**Figma (como fazer)**
- A conta é Free: o Figma só deixa criar rascunho. Não mexer no plano.
- Nomear o arquivo (ex.: `BoaVoz · <tela> · antes × depois`). Se não der pelo navegador, avisar o Ruan.
- Importar o desenho em SVG arrastando o arquivo para a tela vazia do Figma; soltar fora de quadros existentes (senão o quadro fica dentro de outro).
- Conferir se o texto ficou editável e avisar se não.

**Regras que nunca quebra**
- Não mexe no código; proposta aprovada vai para o Dev.
- Ordens só do Ruan.

## Propostas

### Landing (LP), 23/10/2026: aguardando aprovação

Base: `src/app/page.tsx` + conferência em dev.boavoz.com (desktop 1200 px e celular 380 px). Sem as referências "Gostei" do Ruan: a proposta segue só o padrão do painel redesenhado.

**Conferido no dev.boavoz.com**
- **Escuro:** a LP não muda com o tema escuro do aparelho (continua clara; só a faixa "Faça a conta" é escura). Decisão do Ruan: manter só clara (mais simples) ou seguir o painel.
- **Celular:** sem rolagem lateral (380/380 px), mas a página tem 8.100 px de altura. A seção de preços sozinha ocupa ~3 telas antes do 1º cartão.
- **Calculadora "Faça a conta" no celular:** "R$ 4.000" e "R$ 490" ficam colados e o rótulo "10 chatbots P" quebra de linha e fica ambíguo. Proposta: 3 linhas empilhadas (Você fatura / Você paga / Sobra por mês) e rótulo "10 chatbots tamanho P".
- **Cartões de preço:** a página no ar tem "umas 5 conversas por dia", que não está no código local. Manter, é bom texto.
- **Desktop:** hero equilibrado e menu completo. Só os textos mudam.
- Gerador de demo não testado (envia dados ao servidor): os textos de erro/vazio seguem como proposta.

**Problemas encontrados**
- O "em breve" do WhatsApp/Instagram aparece 4 vezes (hero, faixa de canais, passo 3, preços).
- Preços: 3 parágrafos longos antes dos cartões. A regra da Meta repete no 3º parágrafo e na FAQ.
- No celular o menu some: só sobram "Entrar" e "Começar grátis". Sem acesso a Como funciona, Preços e Nichos.
- "Criar conta grátis" / "Começar grátis" aparece em 8 lugares com dois textos diferentes.
- Os nichos parecem botões, mas são texto parado, e o texto promete "uma página para cada tipo".
- Hero: título com 2 ideias (atendimento + marca) e parágrafo de 60+ palavras.
- Verificar: seção escura (`bg-ink`) e cartão "Mais escolhido" no tema escuro; 4 colunas de preço em tablet (`md:grid-cols-4`); chat de exemplo com cores fixas.

**Antes × depois (textos prontos)**

| Bloco | Antes | Depois |
|---|---|---|
| Etiqueta | Para agências e freelancers | Para agências e freelancers |
| Título | Atendimento automático para os clientes da sua agência, com a sua marca. | Chatbots com IA para os clientes da sua agência, com a sua marca. |
| Subtítulo | Crie um chatbot treinado no site… Nós cuidamos da IA. Você cuida dos clientes. | Cole o site do cliente e em minutos o chatbot está treinado, com o seu logo. Nós cuidamos da IA. Você cuida dos clientes. |
| Canais (1 vez só, abaixo do hero) | Atende no site e, em breve, também no WhatsApp oficial e no Instagram Direct… | Atende no site. WhatsApp oficial e Instagram Direct: em breve. |
| Botão principal (todos) | Criar conta grátis / Começar grátis | Criar conta grátis |
| Botão do hero 2 | Ver como funciona | Ver como funciona |
| Passo 3 | …Em breve, conecte também o WhatsApp e o Instagram… | Um script de uma linha. Funciona em qualquer plataforma, do WordPress ao HTML puro. |
| Preços, abertura | 3 parágrafos | 1 frase: "Conta grátis para montar e testar. Cada chatbot no ar tem um tamanho, com a IA incluída." |
| Preços, "1 atendimento" | parágrafo 2 | linha pequena sob os cartões: "1 atendimento = 24 h de conversa da IA com um contato, até 40 respostas. Respostas da equipe não contam." |
| Preços, Meta | parágrafo 3 + FAQ | só na FAQ "A Meta cobra à parte?" |
| Nichos, título | Material de venda pronto, por nicho | Material de venda por nicho |
| Nichos, texto | Uma página para cada tipo de cliente… Use para vender. | Exemplos de conversa e argumentos para cada tipo de cliente. |
| Fecho | Gere a primeira demo hoje. Mande para um cliente amanhã. | (manter) |

**Mudanças de estrutura**
- **Menu no celular:** botão de menu (ícone) abrindo painel com Como funciona, Preços, Por nicho, Entrar. "Começar grátis" fica visível ao lado.
- **Nichos:** virar link de verdade para cada página ou, se as páginas ainda não existem, sair da LP e voltar quando existirem. Chip que não clica não fica.
- **Preços:** 2 colunas no tablet, 4 só no desktop largo.
- **Estados do gerador de demo:** vazio "Cole o endereço do site do cliente"; erro "Não consegui ler esse site. Confira o endereço e tente de novo."; limite "Você usou as demos grátis deste mês."

**Pendente**
- Referências do Ruan para a LP (para ajustar visual, não só texto).
- Conferência nos 4 modos (celular/desktop × claro/escuro).
- Aprovação do Ruan. Aprovada, vai para o Dev.
