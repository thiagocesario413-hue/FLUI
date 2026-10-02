# FLUI (versão web / PWA), versão 1.12.1

Este pacote é o FLUI pronto para ser publicado como site instalável (PWA). Ele funciona 100% no aparelho, sem conta e sem enviar dados para lugar nenhum.

## O que tem na pasta

- `index.html`: o aplicativo inteiro.
- `sw.js`: service worker (faz o app abrir sem internet).
- `manifest.webmanifest` e `icons/`: dados de instalação e ícones.
- `fonts/`: fontes locais (o app não usa nenhum serviço externo).
- `_headers`: cabeçalhos recomendados (Netlify e Cloudflare Pages usam automaticamente).

## Como publicar (escolha UMA hospedagem)

Requisito: a hospedagem precisa ser **HTTPS** (todas as abaixo são). Publique o **conteúdo desta pasta** na raiz do site.

1. **Cloudflare Pages** ou **Netlify:** crie um site novo e arraste esta pasta (ou o `.zip`) para a área de upload. Ambos são gratuitos para este uso.
2. **GitHub Pages:** envie o conteúdo da pasta para um repositório e ative o Pages. O app também funciona em subpasta (por exemplo `usuario.github.io/flui/`).
3. **Firebase Hosting:** use apenas como hospedagem de arquivos estáticos.

## Como instalar no celular

- **iPhone/iPad:** abra o endereço no **Safari**, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- **Android (Chrome):** menu de três pontos e **Instalar aplicativo**.

Depois de aberto uma vez com internet, o app abre também sem internet.

## Cuidados importantes

1. **Não troque o endereço (domínio) do site depois que as pessoas começarem a usar.** Os dados ficam guardados no navegador *daquele endereço*. Outro endereço significa um armazenamento vazio (a recuperação é feita por backup e restauração).
2. **Backup:** oriente o uso regular de Configurações, Backup e restauração. No iPhone o sistema pode limpar dados de sites e apps web pouco usados, e o backup é a proteção.
3. **Atualizar o app:** publique a nova pasta gerada pelo script `publicar-web.ps1`. O app instalado atualiza sozinho na próxima vez que abrir com internet (o service worker troca o cache). Os dados não são apagados.
4. **Privacidade:** o app não envia dados. A hospedagem, como qualquer site, pode registrar o acesso ao endereço (por exemplo o IP), nunca o conteúdo do app.
5. **Notificações** (avisos de vencimento de parcela e de competência aberta) são exclusivas do app Android. Na web e no iPhone elas não existem, e o botão "Notificações" nem aparece em Configurações.

## Limitações conhecidas

- **Não foi testado em iPhone real** (apenas no Edge/Chromium). Confirme a instalação, o botão de exportar (usa a folha de compartilhamento do iOS) e o modo offline no seu aparelho antes de divulgar.
- Exportar PDF no iPhone instalado pode cair no download comum, porque o iOS exige o gesto de toque no momento do compartilhamento.
- Com o app instalado, a barra de status do iOS fica preta.

