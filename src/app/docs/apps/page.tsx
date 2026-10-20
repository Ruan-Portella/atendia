import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Chat dentro de apps" };

const PAGE = `
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0">
  <script>
    window.ChatWidgetConfig = {
      mode: "fullscreen",                 // já aberto, na tela toda, sem o botão
      // o mesmo token do site, pedido ao SEU servidor com a sessão que o app passou
      getToken: async () => {
        const r = await fetch("https://api.seuapp.com/chat-token", {
          headers: { Authorization: "Bearer " + window.APP_SESSION },
        });
        return r.text();
      },
      // o X do chat: avise o app para fechar a tela
      onClose: () => window.ReactNativeWebView?.postMessage("fechar"),
    };
  </script>
  <script src="https://SEU-DOMINIO/widget.js" data-key="CHAVE_DO_WIDGET" async></script>
</body>
</html>
`;

const RN = `
// React Native (react-native-webview)
import { WebView } from "react-native-webview";

export function Atendimento({ sessao, fechar }) {
  return (
    <WebView
      source={{ uri: "https://seuapp.com/chat-app.html" }}
      // a sessão do app entra antes da página carregar (getToken usa)
      injectedJavaScriptBeforeContentLoaded={\`window.APP_SESSION = \${JSON.stringify(sessao)}; true;\`}
      onMessage={(e) => e.nativeEvent.data === "fechar" && fechar()}
      // fotos e áudios: o seletor de arquivos do sistema
      allowFileAccess
      mediaPlaybackRequiresUserAction={false}
    />
  );
}
`;

const FLUTTER = `
// Flutter (webview_flutter 4)
final controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..addJavaScriptChannel("App", onMessageReceived: (m) {
    if (m.message == "fechar") Navigator.of(context).pop();
  })
  ..setNavigationDelegate(NavigationDelegate(
    onPageStarted: (_) => controller.runJavaScript(
      "window.APP_SESSION = \${jsonEncode(sessao)};"),
  ))
  ..loadRequest(Uri.parse("https://seuapp.com/chat-app.html"));
// na página, troque o onClose por: () => App.postMessage("fechar")
`;

/** /docs/apps: o chat do site dentro de um app (webview), com a pessoa identificada (D', parte 8). */
export default function AppsDocs() {
  return (
    <DocPage
      title="Chat dentro de apps"
      intro="O mesmo chat do site abre dentro do seu app, numa webview, já com a pessoa identificada: as ações recebem quem ela é e a conta ativa, como no site. O app só precisa de uma página com o widget em tela cheia e de um jeito de pedir o token ao seu servidor."
    >
      <H2 id="como">Como funciona</H2>
      <ol>
        <li>
          Seu servidor assina o token da pessoa com o segredo de identidade, como no site (veja <Link href="/docs/identificar-usuarios">Identificar usuários</Link>). O token vale 1 hora e o widget pede outro 5 minutos antes de vencer.
        </li>
        <li>
          Uma página sua (por exemplo <code>https://seuapp.com/chat-app.html</code>) carrega o <code>widget.js</code> com <code>mode: &quot;fullscreen&quot;</code>: o chat já abre, ocupando a tela toda, sem o botão flutuante.
        </li>
        <li>
          O app abre essa página numa webview e passa a sessão dele antes de a página carregar. O <code>getToken</code> da página usa essa sessão para pedir o token ao seu servidor.
        </li>
        <li>
          O X do chat chama o <code>onClose</code> da página, que avisa o app para fechar a tela.
        </li>
      </ol>
      <Note>O segredo de identidade fica só no seu servidor. Nem a página nem o app guardam o segredo: eles só repassam o token pronto.</Note>

      <H2 id="pagina">A página do chat</H2>
      <Code lang="html" code={PAGE} />
      <Table
        head={["Opção", "O que faz"]}
        rows={[
          [<code key="1">mode: &quot;fullscreen&quot;</code>, <>Também como <code>data-mode=&quot;fullscreen&quot;</code> no <code>&lt;script&gt;</code>. O chat abre na hora, na tela toda, sem o botão, a prévia e o contador.</>],
          [<code key="2">getToken</code>, "O mesmo do site: chamado ao abrir e 5 minutos antes de o token vencer. Sem ele, a conversa é anônima."],
          [<code key="3">onClose</code>, "Chamado quando a pessoa toca no X do chat. No modo tela cheia, o chat não some sozinho: quem fecha é o app."],
        ]}
      />

      <H2 id="exemplos">No app</H2>
      <H3 id="react-native">React Native</H3>
      <Code lang="tsx" code={RN} />
      <H3 id="flutter">Flutter</H3>
      <Code lang="dart" code={FLUTTER} />
      <p>
        No Android nativo, o caminho é o mesmo com <code>addJavascriptInterface</code> (a ponte para o <code>onClose</code>) e <code>evaluateJavascript</code> (a sessão); no iOS, com <code>WKUserScript</code> no início do documento e um <code>WKScriptMessageHandler</code>.
      </p>

      <H2 id="detalhes">Detalhes</H2>
      <ul>
        <li>
          <strong>Sair da conta:</strong> chame <code>ChatWidget.logout()</code> antes de fechar a webview, ou limpe os dados dela. A conversa de nível usuário já é presa ao token: outra pessoa no mesmo aparelho nunca vê a conversa da anterior.
        </li>
        <li>
          <strong>Trocar de conta (workspace):</strong> <code>ChatWidget.setContext(novoToken)</code> abre uma conversa nova, no contexto novo, como no site.
        </li>
        <li>
          <strong>Fotos e arquivos:</strong> o botão de anexo usa o seletor de arquivos do sistema; libere o acesso a fotos e câmera na webview do seu app.
        </li>
        <li>
          <strong>Domínio:</strong> o <code>widget.js</code> pode vir do domínio próprio da agência; a página do chat é sua e pode ficar em qualquer lugar.
        </li>
      </ul>

      <NextSteps
        items={[
          { href: "/docs/identificar-usuarios", title: "Identificar usuários", text: "O token, o contexto e o que as ações recebem." },
          { href: "/docs/acoes", title: "Ações", text: "As consultas da IA ao seu sistema, já com a pessoa." },
          { href: "/docs/api/fontes", title: "Fontes", text: "Os documentos de cada conta, com o contexto." },
        ]}
      />
    </DocPage>
  );
}
