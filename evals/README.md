# Conjunto fixo de casos

`casos.jsonl` tem um caso por linha. Toda mudança de prompt, modelo ou temperatura roda o
conjunto inteiro antes de ir para produção:

```
https://dev.boavoz.com/api/eval?bot=ID_DO_BOT&casos=1
```

Opcionais: `&n=3` (rodadas por caso, até 5), `&categoria=escopo_fixo` (só uma categoria),
`&model=gpt-4.1-mini`, `&temp=0.3`. Só abre para quem está em `PLATFORM_ADMIN_EMAILS`, logado.
Cada rodada é uma resposta de IA de verdade (gasta centavos) e nada é gravado.

## Regras para escrever casos

- **Só texto genérico, escrito do zero.** Nunca copie uma conversa real de cliente.
- Os casos valem para **qualquer bot** (por isso nada de nome de empresa ou produto). Para
  testar o conteúdo de um bot específico, use a avaliação avulsa (`&q=`).
- Um caso só passa se acertar **em todas as rodadas**.

## Campos

| Campo | O que é |
|---|---|
| `id` | nome único, curto (`escopo-redacao`) |
| `categoria` | `escopo_fixo`, `escopo_flexivel`, `negocio`, `fatos`, `humano`, `seguranca` (as do portão de proibidos entram depois) |
| `canal` | `whatsapp` (padrão), `instagram` ou `widget` (no widget não há trava de escopo) |
| `historico` | conversa anterior, alternando contato e assistente, começando pelo contato |
| `pergunta` | a última mensagem do contato |
| `esperado` | `recusa` (trava de escopo), `nao_recusa`, `atendente` (chama alguém) ou `qualquer` |
| `sem_ferramenta` | `true` se não pode usar nenhuma ferramenta (ex.: saudação) |
| `sem_valor_inventado` | `true` para conferir que preço, prazo e % da resposta estão na base ou na pergunta |
| `deve_conter` / `nao_deve_conter` | expressão regular (sem diferença de maiúsculas) |
| `notas` | por que o caso existe |

Categorias obrigatórias (precisam de 100%): `escopo_fixo`, `humano`, `seguranca`, `fatos`.
