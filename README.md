# Fear & Hunger 2: Termina — Android (APK)

APK leve (alguns KB) que roda o jogo (RPG Maker MV / NW.js) num WebView, com:
- servidor local interno (127.0.0.1) com suporte a Range (áudio/vídeo), keep-alive e cache
- camada de compatibilidade NW.js (`require('fs'|'path'|'nw.gui')`, `process`) — o carregador de plugins
  externos (EPL), os saves em `www/save` e todos os plugins funcionam sem alterar o jogo
- controles de toque (joystick flutuante, A, B, Correr, Menu, PgUp/PgDn) + painel ⚙ de ajustes
- gamepad Bluetooth/USB (D-pad/analógico, A=OK, B/Y/Start=Cancelar/Menu, X/L2/R2/L3/R3=Correr, L1/R1=PgUp/PgDn)
- tela cheia imersiva, 60 Hz fixo, tela sempre ligada, áudio pausa ao sair do app

O jogo NÃO vai dentro do APK: ele lê a sua pasta do jogo (e grava os saves nela).

## 1) Gerar o APK (pelo celular, sem PC)
1. Crie um repositório no GitHub e envie TODO o conteúdo desta pasta (inclusive `.github`).
2. Aba **Actions → Build APK → Run workflow** (ou basta dar push).
3. Quando terminar, baixe o artefato **FearAndHunger2-Termina-APK** (zip com o `.apk`) e instale.

Alternativa: abra a pasta no Android Studio → Build → Build APK(s).

## 2) Onde colocar o jogo
A pasta que contém `index.html` e `js/rpg_core.js` (a pasta `www`, com `img`, `audio`, `data`, `js`...).
O app procura automaticamente em:
- `/sdcard/MTool/Games/Fear and Hunger 2 - Termina/`  (onde você já tem)
- `/sdcard/FearAndHunger2/`
- `Android/data/com.fh2.termina/files/game/`

Na primeira abertura conceda "Acesso a todos os arquivos" (necessário para ler a pasta e gravar saves).
O OST (`OST/`) fica na pasta principal do jogo, como você já organizou — o jogo em si não depende dele.

## Dicas
- Dá para apagar `www/__MACOSX`, `www/img/Python` e os `.DS_Store` (lixo dos zips).
- Para depurar: crie um arquivo vazio `android_debug.txt` dentro da pasta `www` e use `chrome://inspect` no PC.
- Tocar na tela para andar vem DESLIGADO (conflita com movimento por pixel); ligue em ⚙ se quiser.
- Erros: envie a mensagem que aparecer na tela do jogo (ou o logcat).
