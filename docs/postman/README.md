# Testar a API e os webhooks do BoaVoz

## API: coleção do Postman

Arquivos desta pasta:

- `boavoz-api.postman_collection.json`: todas as rotas da API v1, em pastas, com testes automáticos;
- `boavoz-dev.postman_environment.json`: o ambiente do dev.boavoz.com, com as variáveis;
- `gerar_colecao.py`: gera os dois arquivos de novo quando a API ganhar rotas (`python docs/postman/gerar_colecao.py`, na raiz do repositório).

### Importar

1. No Postman, **Import** e arraste os dois arquivos `.json`. O ambiente se importa **uma vez só**: nas próximas versões, reimporte só a coleção (os valores-padrão do resto, como as URLs de exemplo e o idioma do modelo, ficam dentro dela, e o seu ambiente não é tocado).
2. No canto superior direito, escolha o ambiente **BoaVoz dev**.
3. Abra o ambiente e preencha:
   - `api_key`: a chave criada em Integrações, Chaves de API (com as permissões que for testar);
   - `vercel_bypass`: o segredo de bypass da proteção da Vercel (só o dev.boavoz.com pede);
   - `bot_id`: o id do chatbot de teste, com o prefixo `bot_`;
   - `phone`: o seu WhatsApp com 55 e DDD, só números.

   As duas primeiras são secretas: não exporte nem compartilhe o ambiente com elas preenchidas, e nunca as coloque nos arquivos desta pasta (ficam no Git). Para os testes de erro, preencha também `phone_sem_idade`, `phone_fora_da_janela` e `phone_para_apagar` (números completos, com 55 e DDD).

### Usar

- Rode **1. Conversas, Listar conversas** primeiro: ela guarda no ambiente os ids da conversa mais recente de cada canal, que as outras requisições usam.
- **4. Modelos, Modelos do bot** guarda o primeiro modelo enviável em `template_name`.
- Os ids que uma resposta devolve (mensagem, vínculo, próxima página) também ficam no ambiente.
- Cada requisição confere o resultado (aba **Test Results**). Os erros da API aparecem no **Console** (embaixo, à esquerda) com o código e os detalhes.
- Para rodar uma pasta inteira de uma vez: clique nos três pontos da pasta, **Run folder**. A pasta 3 manda mensagens de verdade para o seu WhatsApp.

## Webhooks: onde receber os eventos

Para testar, use o [Svix Play](https://www.svix.com/play/): é grátis, não pede cadastro e é da empresa que criou o padrão de assinatura dos webhooks do BoaVoz (Standard Webhooks). Ele mostra cada evento com os cabeçalhos (`webhook-id`, `webhook-timestamp`, `webhook-signature`), o corpo e a hora.

1. Abra o Svix Play e copie a URL única que ele mostra.
2. No painel, em **Integrações, Webhooks**, crie (ou edite) o webhook com essa URL e marque os eventos.
3. **Enviar teste** no painel e veja o `webhook.test` chegar.

Testar as novas tentativas e a desativação: o Svix Play responde com erro de propósito pela URL da API pública dele, `https://api.play.svix.com/api/v1/in/<token>/`, onde `<token>` é o pedaço `e_…` da sua URL.

- `…/in/<token>/?force_status_code=500`: sempre erro; as novas tentativas aparecem nos **Logs** do painel (1 min, 5 min, 30 min…);
- `…/in/<token>/?force_status_code=410`: o BoaVoz desativa o webhook na hora (410 Gone), e o painel mostra o motivo;
- `…/in/<token>/?random_failure_rate=50`: metade das entregas falha.

O lado de quem envia fica no próprio painel: **Integrações, Logs** mostra cada entrega com o corpo, o status, a resposta recebida e o botão Reenviar.

Alternativa: o [Hookdeck Console](https://console.hookdeck.com) também é grátis, com reenvio do evento capturado e a opção de repassar para um servidor local.
