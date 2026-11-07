# Som

A home-made music app: your own music, on your own computer, on your PC and your phone.

- Web app (PWA) with playlists, queue, shuffle, repeat, favourites, synced lyrics, day/night, glass UI.
- Subsonic API (`/rest/*`), so native apps like Symfonium, Substreamer or Ultrasonic work with it.
- An Android app (Capacitor shell) and a tiny app store page at `/loja/`.
- Zero npm dependencies: `node server.js` and that is it.
- Private by default: listens on `127.0.0.1`, reached from your phone through Tailscale.

**Setting it up with an AI agent:** open Claude Code, Codex or a similar agent in this folder and say
*"Read PARA-A-TUA-IA.md and set up Som for me, with my phone."* The guide is written for the agent
(in Portuguese; agents handle that fine).

Bring your own music. Do not use this to download copyrighted music.

Licence: MIT. Example music in the original setup: Kevin MacLeod (incompetech.com), CC BY 4.0 — not included in this repository.
