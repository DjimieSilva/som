# Som — instruções para a tua IA

> Para a pessoa: abre o Claude Code, o Codex ou outro agente de IA no teu computador, nesta pasta, e escreve:
> **«Lê o PARA-A-TUA-IA.md e monta a Som para mim, com o meu telemóvel.»**
> O resto é com ela. Este ficheiro é para a IA.

---

## O que é

A Som é um «Spotify caseiro»: um servidor pequeno (Node, sem dependências) que corre num computador da pessoa,
lê uma pasta de música e serve:

- uma **app web** (PWA) para o PC e o telemóvel: playlists, fila, aleatório, repetir, favoritas, letras sincronizadas,
  dia/noite, fundos, temporizador para dormir, transição suave;
- a **API Subsonic** em `/rest/*`, para apps nativas (Symfonium, Substreamer, Ultrasonic, Tempo…);
- uma **loja** em `/loja/` com as apps Android da casa (APK);
- opcional: letras automáticas (Whisper) e procura por sentido («Momento»), em Python.

Tudo fica na máquina da pessoa. O acesso de fora de casa é por **Tailscale** (rede privada), nunca porta aberta na internet.

## Regras para ti, IA

1. Faz o trabalho de ponta a ponta. A pessoa pode não ser técnica: pede-lhe só o que só ela pode fazer
   (instalar o Tailscale no telemóvel, tocar em «Instalar», ligar a Depuração USB).
2. Não descarregues música protegida por direitos de autor (YouTube, Spotify…). Usa a música que a pessoa já tem
   ou música livre (Creative Commons, com créditos).
3. Não abras portas no router nem ponhas o servidor na internet pública. `HOST` fica `127.0.0.1` e a ponte é o `tailscale serve`.
4. Não guardes senhas em ficheiros. Se a pessoa quiser senha na API Subsonic, usa a variável `SOM_SENHA`.

## Passos

### 1. Servidor
- Precisa de **Node 18+**. Verifica com `node -v`; se faltar, instala (Windows: `winget install OpenJS.NodeJS.LTS`; macOS: `brew install node`; Linux: gestor de pacotes).
- Copia esta pasta para um sítio estável (ex.: `~/som`). Põe a música em `musica/` (subpastas = álbuns).
  Nomes `Artista - Título.mp3` funcionam sem etiquetas. Etiquetas ID3 e capas embutidas são lidas.
- Arranca: `node server.js` → `http://localhost:4560`. Confirma: `curl http://localhost:4560/rest/ping?f=json` dá `"status":"ok"`.
- Arranque automático:
  - Windows: tarefa agendada no arranque (`Register-ScheduledTask`, gatilho `-AtStartup`, `LogonType S4U` para correr sem sessão iniciada, ação `node.exe server.js`, reiniciar em falha).
  - macOS: `launchd` (LaunchAgent com `KeepAlive`). Linux: serviço `systemd` com `Restart=always`.

### 2. Acesso do telemóvel (Tailscale)
- Instala o Tailscale no computador e no telemóvel, com a mesma conta (a pessoa faz o login nos dois).
- No computador: `tailscale serve --bg --https=4560 http://127.0.0.1:4560`.
- O endereço fica `https://<nome-do-pc>.<rede>.ts.net:4560` (vê-o com `tailscale serve status`). Testa-o a partir de outro aparelho da rede.

### 3. No telemóvel
Escolhe com a pessoa (recomenda a primeira):
- **App Android da Som (APK)**: ver o passo 4. Toca com o ecrã bloqueado e mostra os controlos na notificação.
- **App Subsonic pronta**: Symfonium (paga, a melhor) ou Substreamer (grátis). Servidor = endereço do passo 2, utilizador à escolha, qualquer senha (ou `SOM_SENHA`).
- **Só browser**: abrir o endereço no Chrome → ⋮ → «Adicionar ao ecrã principal». Em telemóveis Xiaomi/Huawei o sistema pode parar o som em segundo plano.

### 4. App Android (APK) e instalação pelo cabo
- O projeto Android está em `../som-android` (Capacitor, modo URL remoto: a app abre o endereço do passo 2). Instruções exatas em `../som-android/COMO-CONSTRUIR.md`.
- Muda o `server.url` em `capacitor.config.*` para o endereço da pessoa, constrói (`gradlew assembleDebug`) e:
  - **pelo cabo USB**: no telemóvel, Definições → Sobre → tocar 7× em «Versão» → Opções de programador → **Depuração USB**; ligar o cabo, aceitar a impressão digital do PC; depois `adb install -r app-debug.apk`;
  - **sem cabo**: copiar o APK para `public/loja/apps/` e atualizar `public/loja/apps/info.json`; a pessoa abre `<endereço>/loja/` no telemóvel e toca em «Instalar».
- Em Xiaomi: Definições → Apps → Som → Poupança de bateria → «Sem restrições», para a música não parar.

### 5. PC como app
No Chrome ou no Edge, abrir o endereço e usar o ícone «Instalar» da barra do endereço (ou Definições da Som → Apps).

### 6. Opcional: letras e «Momento»
Precisam de Python 3.10+ com `faster_whisper`, `onnxruntime`, `tokenizers`, `huggingface_hub`.
Em máquinas com pouca RAM (≤ 8 GB) ou sem GPU usa `SOM_CPU=1`, ou desliga com `SOM_SEM_LETRAS=1` e `SOM_SEM_MODELO=1`.
Detalhes no `LEIA-ME.md`.

## Ficheiros

| Ficheiro | O que faz |
|---|---|
| `server.js` | servidor: biblioteca, áudio com Range, capas geradas, API Subsonic, estado partilhado, loja |
| `public/index.html`, `app.js`, `estilo.css` | app web |
| `public/extras.js` | definições, fundos, temporizador, controlos de media (web e Android), easter egg |
| `public/icones.js` | ícones SVG |
| `public/loja/` | loja de apps (APK) |
| `letras.py`, `sentidos.py` | letras (Whisper) e procura por sentido (opcionais) |
| `dados/` | estado da pessoa (playlists, favoritas, letras). **Não partilhar.** |
| `musica/` | a música da pessoa. **Não partilhar.** |

## Personalizar
- Endereços da loja: `public/loja/index.html` (lista `APPS`).
- Cores e tipos de letra: variáveis no topo de `public/estilo.css`.
- Há um easter egg no logótipo. Não contes onde.

## Juntar músicas
- Na app: botão «+» no topo → do aparelho (ficheiros) ou por link direto. No PC, arrastar ficheiros para a janela.
- API: `POST /api/enviar?nome=Artista%20-%20Título.mp3` (corpo = o ficheiro) e `POST /api/link` com `{"url": "…"}`.
  Links de streaming (YouTube, Spotify, SoundCloud…) são recusados de propósito.
- Para o assistente da pessoa (Telegram, etc.): copia `skills/juntar-musica/` para a pasta de skills dele.

## Temas
12 temas em `public/temas.js` + `public/estilo.css` (secção «1.3 — temas»): suaves, profundos e minimalistas (preto e branco, sem vidro).
