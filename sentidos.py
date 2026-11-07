# Som — mini modelo de sentido (embeddings) a correr neste PC, para o «Momento».
# Modelo: paraphrase-multilingual-MiniLM-L12-v2 (o mesmo que a app usa no browser), versão ONNX quantizada
# da Xenova (~120 MB, descarrega uma vez para a cache do Hugging Face). Corre no CPU com onnxruntime.
# Protocolo: o servidor escreve uma linha JSON {"id": 1, "textos": [...]} e recebe {"id": 1, "vetores": [[...], ...]}.
import json, sys

REPO = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'


def carregar():
    import numpy as np, onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer
    def baixar(f):   # usa a cópia já descarregada; só vai à internet na 1.ª vez
        try:
            return hf_hub_download(REPO, f, local_files_only=True)
        except Exception:
            return hf_hub_download(REPO, f)
    tok = Tokenizer.from_file(baixar('tokenizer.json'))
    tok.enable_truncation(128)
    tok.enable_padding(pad_id=1, pad_token='<pad>')
    sess = ort.InferenceSession(baixar('onnx/model_quantized.onnx'), providers=['CPUExecutionProvider'])
    nomes = {i.name for i in sess.get_inputs()}

    def vetores(textos):
        enc = tok.encode_batch(textos)
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        ent = {'input_ids': ids, 'attention_mask': mask}
        if 'token_type_ids' in nomes:
            ent['token_type_ids'] = np.zeros_like(ids)
        h = sess.run(None, ent)[0]                                 # [n, tokens, 384]
        m = mask[..., None].astype(np.float32)
        v = (h * m).sum(1) / np.clip(m.sum(1), 1e-9, None)         # média das palavras
        v /= np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-9, None)
        return v.round(5).tolist()
    return vetores


def main():
    try:
        vetores = carregar()
    except Exception as e:
        print(json.dumps({'erro': f'não consegui carregar o modelo: {e}'}), flush=True)
        return
    print(json.dumps({'pronto': True, 'modelo': REPO}), flush=True)
    for linha in sys.stdin:
        p = None
        try:
            p = json.loads(linha)
            out = []
            for i in range(0, len(p['textos']), 64):
                out += vetores(p['textos'][i:i + 64])
            print(json.dumps({'id': p.get('id'), 'vetores': out}), flush=True)
        except Exception as e:
            print(json.dumps({'id': p.get('id') if isinstance(p, dict) else None, 'erro': str(e)}), flush=True)


if __name__ == '__main__':
    main()
