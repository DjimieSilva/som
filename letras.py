# Som — escreve a letra de uma música, com tempos por linha, usando o Whisper (faster_whisper) neste PC.
# Uso: python letras.py <audio> <saida.json> [--letra letra.txt] [--titulo "..."] [--modelo medium]
# - Com --letra (a letra que nós escrevemos): o texto é o nosso; o Whisper só dá os tempos.
# - Sem letra: guarda o que o Whisper ouviu.
# - Sem voz (ou quase): marca como instrumental, sem linhas.
# O servidor chama isto como processo filho, uma música de cada vez.
import argparse, difflib, json, os, re, sys, time, unicodedata

# frases que o Whisper inventa em música sem voz (aprendido com as do Kevin MacLeod)
FRASES_FEITAS = {'thank you', 'thank you very much', 'thanks', 'we ll be right back', 'we ll see you next time', 'see you next time',
                 'let s get started', 'amen', 'amem', 'obrigado', 'obrigada', 'you', 'bye', 'oh', 'music', 'musica'}
ALUCINACOES = ('transcription by', 'castingwords', 'legenda',  'amara.org', 'obrigado por assistir', 'subscreva', 'inscreva-se',
               'subtitles by', 'thanks for watching', 'thank you for watching', 'legendado por', 'www.', '.com')


def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.replace('-', '')                       # «Descompli-cai», «Au-ro-ra»
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()


def ler_letra(p):
    linhas = []
    for l in open(p, encoding='utf-8').read().splitlines():
        l = l.strip()
        if not l or (l.startswith('[') and l.endswith(']')):
            continue
        linhas.append(l)
    return linhas


def adivinhar_idioma(linhas):
    pal = norm(' '.join(linhas)).split()
    pt = sum(w in {'a', 'o', 'e', 'de', 'da', 'do', 'que', 'na', 'no', 'um', 'uma', 'com', 'nao', 'em', 'os', 'as', 'para', 'ai'} for w in pal)
    en = sum(w in {'the', 'and', 'a', 'my', 'in', 'to', 'of', 'i', 'is', 'me', 'your', 'on', 'from', 'not', 'it'} for w in pal)
    return 'en' if en > pt else 'pt'


def carregar_modelo(nome):
    from faster_whisper import WhisperModel
    # «large-v3-turbo» na GPU: nos jingles o «medium» saltava a 1.ª estrofe inteira; o turbo apanha-a
    # e é mais rápido. Se não houver GPU (ou o modelo), cai para o «medium» e depois para o CPU.
    if os.environ.get('SOM_CPU') != '1':
        for n in dict.fromkeys([nome, 'medium']):
            try:
                return WhisperModel(n, device='cuda', compute_type='float16'), f'{n}, GPU'
            except Exception as e:
                print(f'«{n}» na GPU não deu:', e, file=sys.stderr)
    # no CPU o «small» é muito mais rápido e chega para músicas
    return WhisperModel('small', device='cpu', compute_type='int8'), 'small, CPU'


def transcrever(modelo, audio, idioma, prompt, vad=True):
    segs, info = modelo.transcribe(
        audio, language=idioma, vad_filter=vad, word_timestamps=True, beam_size=5,
        condition_on_previous_text=False, initial_prompt=prompt, no_speech_threshold=None,
        vad_parameters=dict(threshold=0.35, min_silence_duration_ms=600) if vad else None)
    bons = []
    for s in segs:
        t = s.text.strip()
        if not t or any(a in t.lower() for a in ALUCINACOES) or norm(t) in FRASES_FEITAS or re.search(r'[\[\]()🎵♪]', t):
            continue
        if s.no_speech_prob > 0.6 and s.avg_logprob < -1.0:
            continue
        if s.compression_ratio > 2.6:       # «la la la la la…» repetido sem fim
            continue
        palavras = [(w.word.strip(), w.start, w.end, w.probability) for w in (s.words or []) if w.word.strip()]
        if not palavras:
            continue
        bons.append({'texto': t, 'inicio': s.start, 'fim': s.end, 'palavras': palavras,
                     'no_speech': s.no_speech_prob, 'logprob': s.avg_logprob})
    return bons, info


def tem_voz(segs):
    """Instrumental ou voz? Nas músicas sem voz o Whisper inventa 2 ou 3 frases com pouca certeza
    («Thank you», «🎵»); com voz há dezenas de palavras com probabilidade alta."""
    ps = [w[3] for s in segs for w in s['palavras']]
    diferentes = {norm(w[0]) for s in segs for w in s['palavras']} - {''}
    return len(ps) >= 15 and sum(ps) / len(ps) >= 0.55 and len(diferentes) >= 12


def casar_com_letra(segs, letra):
    """Cada segmento do Whisper é trocado pela(s) linha(s) da nossa letra que mais se parecem com ele.
    Assim os refrões repetidos também ganham tempos. Devolve (linhas, quantos segmentos casaram)."""
    alvos = []  # (texto normalizado, [índices das linhas])
    for i in range(len(letra)):
        for k in range(1, 5):
            if i + k <= len(letra):
                alvos.append((norm(' '.join(letra[i:i + k])), list(range(i, i + k))))
    out, casados = [], 0
    for s in segs:
        n = norm(s['texto'])
        if not n:
            continue
        melhor, idx = 0, None
        for txt, ids in alvos:
            r = difflib.SequenceMatcher(None, n, txt).ratio()
            if r > melhor:
                melhor, idx = r, ids
        pal = s['palavras']
        if melhor >= 0.5 and idx:
            casados += 1
            # divide as palavras do segmento pelas linhas, na proporção do tamanho de cada linha
            tamanhos = [max(1, len(norm(letra[i]).split())) for i in idx]
            total, acum, ini = sum(tamanhos), 0, 0
            for j, i in enumerate(idx):
                acum += tamanhos[j]
                fim = len(pal) if j == len(idx) - 1 else max(ini + 1, min(len(pal) - 1, round(len(pal) * acum / total)))
                bocado = pal[ini:fim] or pal[-1:]
                out.append({'inicio': round(bocado[0][1], 2), 'fim': round(bocado[-1][2], 2), 'texto': letra[i], 'fonte': 'letra', 'n': i})
                ini = fim
        # o que não se parece com nenhuma linha nossa («Obrigado.», «oh oh oh», legendas inventadas) fica de fora
    return out, casados


def completar(linhas, letra, dur):
    """Linhas da nossa letra que o Whisper não apanhou na 1.ª passagem: ganham um tempo estimado
    entre as vizinhas que ele apanhou (ex.: apanhou a 1.ª e a 6.ª linha → a 2.ª–5.ª ficam espalhadas no meio)."""
    linhas.sort(key=lambda l: l['inicio'])
    vistas = {l['n'] for l in linhas}
    novas = []
    ancoras = [l for l in linhas]
    for k, a in enumerate(ancoras):
        b = ancoras[k + 1] if k + 1 < len(ancoras) else None
        alvo = b['n'] if b else len(letra)
        if alvo <= a['n'] + 1:
            continue
        falta = [i for i in range(a['n'] + 1, alvo) if i not in vistas]
        if not falta:
            continue
        t0 = a['fim']
        t1 = b['inicio'] if b else min(dur, t0 + 4 * len(falta))
        passo = (t1 - t0) / len(falta)
        if passo < 0.8:
            continue
        for j, i in enumerate(falta):
            novas.append({'inicio': round(t0 + j * passo, 2), 'fim': round(t0 + (j + 1) * passo, 2), 'texto': letra[i], 'fonte': 'letra (tempo estimado)', 'n': i})
            vistas.add(i)
    # linhas antes da 1.ª que o Whisper apanhou
    if linhas and linhas[0]['n'] > 0:
        primeira = linhas[0]
        falta = [i for i in range(primeira['n']) if i not in vistas]
        passo = min(3.5, primeira['inicio'] / max(1, len(falta)))
        if falta and passo >= 0.8:
            for j, i in enumerate(falta):
                ini = primeira['inicio'] - (len(falta) - j) * passo
                novas.append({'inicio': round(ini, 2), 'fim': round(ini + passo, 2), 'texto': letra[i], 'fonte': 'letra (tempo estimado)', 'n': i})
    return sorted(linhas + novas, key=lambda l: l['inicio'])


def partir_longas(segs):
    """Sem letra nossa: segmentos longos do Whisper partem-se em linhas de ~8 palavras."""
    out = []
    for s in segs:
        pal = s['palavras']
        if len(pal) <= 12:
            out.append({'inicio': round(s['inicio'], 2), 'fim': round(s['fim'], 2), 'texto': s['texto'], 'fonte': 'whisper'})
            continue
        n = -(-len(pal) // 8)
        por = -(-len(pal) // n)
        for k in range(0, len(pal), por):
            b = pal[k:k + por]
            out.append({'inicio': round(b[0][1], 2), 'fim': round(b[-1][2], 2), 'texto': ' '.join(w for w, *_ in b), 'fonte': 'whisper'})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio'); ap.add_argument('saida')
    ap.add_argument('--letra'); ap.add_argument('--titulo', default='')
    ap.add_argument('--modelo', default=os.environ.get('SOM_WHISPER', 'large-v3-turbo'))
    a = ap.parse_args()
    t0 = time.time()
    letra = ler_letra(a.letra) if a.letra and os.path.exists(a.letra) else []
    idioma = adivinhar_idioma(letra) if letra else None
    modelo, onde = carregar_modelo(a.modelo)
    # 1.º com VAD (filtro de voz). Nas músicas o VAD costuma cortar a voz cantada, por isso,
    # se ouvir pouco, repete sem VAD e fica com o melhor. (Sem «initial_prompt»: com a letra no
    # prompt o Whisper salta a estrofe.)
    segs, info = transcrever(modelo, a.audio, idioma, None, vad=True)
    if letra:
        _, c1 = casar_com_letra(segs, letra)
        if c1 < len(letra):
            s2, i2 = transcrever(modelo, a.audio, idioma, None, vad=False)
            if casar_com_letra(s2, letra)[1] > c1:
                segs, info = s2, i2
    elif not tem_voz(segs):
        segs, info = transcrever(modelo, a.audio, None, None, vad=False)
    res = {
        'titulo': a.titulo, 'ficheiro': os.path.basename(a.audio), 'idioma': idioma or info.language,
        'modelo': f'faster-whisper ({onde})', 'gerada': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'segundos': round(time.time() - t0, 1), 'instrumental': False, 'letraNossa': bool(letra), 'linhas': [],
    }
    if letra:
        linhas, casados = casar_com_letra(segs, letra)
        if casados == 0:
            # não deu para casar: a letra fica, com tempos espalhados pela música
            dur = info.duration or 60
            passo = dur * 0.8 / len(letra)
            linhas = [{'inicio': round(dur * 0.1 + i * passo, 2), 'fim': round(dur * 0.1 + (i + 1) * passo, 2), 'texto': l, 'fonte': 'letra'} for i, l in enumerate(letra)]
            res['fonte'] = 'letra nossa (tempos aproximados: o Whisper não a reconheceu)'
        else:
            linhas = completar(linhas, letra, info.duration or 0)
            estimadas = sum(l['fonte'] != 'letra' for l in linhas)
            res['fonte'] = 'letra nossa + tempos do Whisper' + (f' ({estimadas} linhas com tempo estimado)' if estimadas else '')
        for l in linhas:
            l.pop('n', None)
        res['linhas'] = linhas
    elif not tem_voz(segs):
        res['instrumental'] = True
        res['fonte'] = 'instrumental (o Whisper não ouviu voz)'
    else:
        res['linhas'] = partir_longas(segs)
        res['fonte'] = 'Whisper (transcrição automática)'
    res['linhas'].sort(key=lambda l: l['inicio'])
    tmp = a.saida + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    os.replace(tmp, a.saida)
    print(f"{res['fonte']} · {len(res['linhas'])} linhas · {res['segundos']} s")


if __name__ == '__main__':
    main()
    sys.stdout.flush()
    os._exit(0)   # o CTranslate2 com CUDA às vezes rebenta ao fechar no Windows; o ficheiro já está gravado
