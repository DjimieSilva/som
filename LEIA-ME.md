# Som — leia-me

A tua música caseira: app web (PC e telemóvel), API Subsonic para apps (Symfonium…), letras automáticas e «Momento».

## Arrancar

```
cd Desktop/Projetos/som
node server.js
```

Abre `http://localhost:4560`. Precisa de Node 18+. Para as letras e o mini modelo precisa de Python com
`faster_whisper`, `onnxruntime`, `tokenizers` e `huggingface_hub` (já estão neste PC).

Variáveis úteis: `PORT`, `HOST`, `MUSICA` (outra pasta), `SOM_PYTHON` (caminho do Python),
`SOM_WHISPER` (modelo; por defeito `large-v3-turbo` na GPU), `SOM_CPU=1` (sem GPU: usa o `small`),
`SOM_SEM_LETRAS=1`, `SOM_SEM_MODELO=1`.

## Acrescentar músicas

Põe o ficheiro em `musica/` (qualquer subpasta = álbum, se não tiver etiquetas). O servidor vê-o uns segundos
depois (e de 10 em 10 minutos por garantia) e escreve a letra em segundo plano, uma música de cada vez.

- **Letra escrita por nós:** ao lado do áudio, um ficheiro com o mesmo nome e `.letra.txt`
  (ex.: `Jingle Mercado.mp3` + `Jingle Mercado.letra.txt`; linhas `[Verse]`/`[Chorus]` são ignoradas).
  O texto fica o nosso; o Whisper só dá os tempos. Linhas que ele não apanha ficam com tempo estimado.
- **Sem letra:** guarda o que o Whisper ouviu. Sem voz → marcada como «instrumental».
- As letras ficam em `dados/letras/<id>.json` e não se geram outra vez. Para refazer uma, apaga o ficheiro dela e reinicia.
- `python importar_nossas.py` volta a copiar as nossas músicas (jingles Descomplicai, Aurora, jogos) para `musica/Nossas/`. Só copia.

## Na app

- **Letra:** no ecrã do leitor, botão «Letra». A linha atual acende; tocar numa linha salta para lá.
- **Momento:** separador «Momento». Escreve ou dita uma frase («dia de praia com os miúdos») e a app mostra
  as linhas das nossas músicas que encaixam. Tocar numa → toca a partir dessa linha.
  «Ligar o mini modelo neste aparelho» descarrega o modelo para o browser (~120 MB, uma vez) e procura por sentido sem sair do aparelho.

## API Momento (para o Mylo e outras IAs)

```
GET /api/momento?q=estamos a descascar bananas&n=8
```

Devolve uma lista JSON, da que encaixa melhor para a pior (no máximo 2 linhas por música):

```json
[{ "musica": "Canção da horta", "linha": "a terra guarda o que a gente lhe dá", "inicio": 44.36, "fim": 48.2,
   "pontuacao": 0.47, "id": "…", "artista": "Descomplicai", "audio": "/audio/…", "palavras": 0.58, "sentido": 0.3, "modo": "palavras + mini modelo" }]
```

- `palavras`: BM25 leve (sem acentos, radicais em português, grupos de sinónimos simples).
- `sentido`: mini modelo `paraphrase-multilingual-MiniLM-L12-v2` (ONNX) a correr neste PC (`sentidos.py`).
  Se o modelo não arrancar, a API continua só com `palavras` (`"modo": "palavras"`).
- Outras: `GET /api/letra/<id>` (letra com tempos), `GET /api/letras` (estado da fila + todas as linhas).
  As apps Subsonic recebem a letra sincronizada por `getLyricsBySongId`.

## Temas

Se o motor de temas da casa estiver a correr (`<mesmo host>:4600/tema.js`), o Som usa as cores dele
(`--t-fundo`, `--t-texto`, `--t-acao`…). Sem ele, fica exatamente igual.
