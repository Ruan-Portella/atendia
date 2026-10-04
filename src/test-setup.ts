import { setCipherIdentityForTests, setScopeResolver } from "./lib/field-cipher";

/*
 * Testes: a cifra por campo fica transparente (os testes olham os valores gravados) e o escopo
 * é o da plataforma, sem banco. O teste da cifra (cipher.test.ts) liga a cifra de verdade.
 */
setCipherIdentityForTests(true);
setScopeResolver({ bot: async () => ({ clientId: null }), conversation: async () => ({ clientId: null }) });
