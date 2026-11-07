---
name: juntar-musica
description: Junta uma música à Som (a app de música caseira que corre neste PC) a partir de um ficheiro de áudio ou de um link direto que a pessoa mande — por exemplo no Telegram ("mete esta na Som", "junta isto à música", um .mp3 anexado, um link do Drive/Dropbox/archive.org). Usa sempre que a mensagem traga um ficheiro de áudio ou um link para juntar à biblioteca de música. Não serve para descarregar de YouTube, Spotify, SoundCloud ou outros sites de streaming.
model: sonnet
---

# Juntar música à Som

A Som corre neste PC em `http://127.0.0.1:4560`. O endereço para o telemóvel é o do `tailscale serve status` (porta 4560).
As músicas novas ficam na pasta `musica/Recebidas/` da Som e aparecem logo na app e nas apps Subsonic.

## 1. Ficheiro de áudio anexado (mp3, m4a, flac, ogg, opus, wav)

Guarda o anexo e envia-o (o nome conta: `Artista - Título.mp3` dá artista e título certos):

```powershell
$f = 'C:\caminho\para\o\anexo.mp3'
$nome = [uri]::EscapeDataString('Artista - Título.mp3')
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4560/api/enviar?nome=$nome" -InFile $f -ContentType 'audio/mpeg'
```

Se o nome do anexo for genérico (`audio_2026-11-07.mp3`), pergunta ao Jaime o artista e o título numa frase curta, ou usa o que ele escreveu na mensagem.

## 2. Link

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4560/api/link' -ContentType 'application/json' -Body (@{ url = 'https://…' } | ConvertTo-Json)
```

Funciona com links **diretos** para ficheiros de áudio: Google Drive (partilha "qualquer pessoa com o link"), Dropbox, archive.org, Free Music Archive, compras do Bandcamp, um `.mp3` num site.

A resposta traz `faixa.titulo` e `faixa.artista`. Se der erro, o campo `erro` já vem em português: passa-o à pessoa tal como está.

## 3. Links de streaming (YouTube, Spotify, SoundCloud, Apple Music, TikTok, Instagram…)

Não descarregues, nem com yt-dlp nem com outra ferramenta: são músicas com direitos e esses sites não deixam. A Som também os recusa. Responde à pessoa, curto e sem sermão, com uma alternativa:
- se for da pessoa (um vídeo ou áudio que ele fez), pede o ficheiro original;
- se for de um artista, sugere comprar no Bandcamp ou na iTunes (dá o ficheiro) e mandar-te esse ficheiro;
- se só quiser ouvir, a app do próprio serviço é o caminho.

## 4. Depois de juntar

Responde numa linha: `Juntei «Título» (Artista) à Som, na pasta Recebidas.` e o endereço da Som para o telemóvel.
Se a Som não responder em `127.0.0.1:4560`, a tarefa agendada «Som» está parada: `schtasks /run /tn Som` e tenta outra vez passados 10 s.
