"""RAG — index dokumen lokal (chunking + embedding via Ollama) & retrieval."""

import hashlib
import json
from pathlib import Path

import httpx

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
GEMINI_EMBED_MODEL = "gemini-embedding-001"
DEFAULT_DOC_DIR = None
INDEX_CACHE_FILE = None
TOP_K = 4
CHUNK_SIZE = 600
CHUNK_OVERLAP = 120

_state = {"enabled": False, "index": None}
_EMBED_KEY = ""
_EMBED_SOURCE = "ollama"


def init(doc_dir: Path, cache_file: Path):
    global DEFAULT_DOC_DIR, INDEX_CACHE_FILE
    DEFAULT_DOC_DIR = doc_dir
    INDEX_CACHE_FILE = cache_file
    doc_dir.mkdir(parents=True, exist_ok=True)


def set_embed_key(key: str):
    """API key Gemini untuk embedding cadangan (saat Ollama tidak tersedia)."""
    global _EMBED_KEY
    _EMBED_KEY = key or ""


def _load_config():
    c = {}
    if INDEX_CACHE_FILE.exists():
        try:
            c = json.loads(INDEX_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            c = {}
    c.setdefault("files", {})
    return c


def _save_config(c):
    INDEX_CACHE_FILE.write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")


async def _ensure_embed_model() -> bool:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            names = [m["name"] for m in r.json().get("models", [])]
            if any(n.startswith(EMBED_MODEL) for n in names):
                return True
            # pull otomatis model embedding
            await client.post(f"{OLLAMA_URL}/api/pull", json={"model": EMBED_MODEL, "stream": False})
            return True
    except httpx.HTTPError:
        return False


async def _embed_ollama(texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=None) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/embed", json={"model": EMBED_MODEL, "input": texts}
        )
        r.raise_for_status()
        return r.json().get("embeddings", [])


async def _embed_gemini(texts: list[str]) -> list[list[float]]:
    """Embedding via Gemini (tanpa Ollama)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_EMBED_MODEL}:embedContent"
    vecs = []
    async with httpx.AsyncClient(timeout=None) as client:
        for t in texts:
            r = await client.post(
                url,
                params={"key": _EMBED_KEY},
                json={
                    "model": f"models/{GEMINI_EMBED_MODEL}",
                    "content": {"parts": [{"text": t}]},
                },
            )
            r.raise_for_status()
            vecs.append(r.json()["embedding"]["values"])
    return vecs


async def _embed(texts: list[str]) -> list[list[float]]:
    """Prioritas Ollama; fallback Gemini kalau Ollama mati & key tersedia."""
    global _EMBED_SOURCE
    try:
        vecs = await _embed_ollama(texts)
        _EMBED_SOURCE = "ollama"
        return vecs
    except httpx.HTTPError:
        pass
    if not _EMBED_KEY:
        raise httpx.HTTPError("Embedding tidak tersedia (Ollama mati dan tanpa key Gemini)")
    vecs = await _embed_gemini(texts)
    _EMBED_SOURCE = "gemini"
    return vecs


def _file_hash(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def chunk_text(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    cur = ""
    for p in paragraphs:
        if not cur:
            cur = p
        elif len(cur) + len(p) + 1 <= CHUNK_SIZE:
            cur = cur + "\n\n" + p
        else:
            chunks.append(cur)
            tail = cur[-CHUNK_OVERLAP:] if len(cur) > CHUNK_OVERLAP else cur
            cur = tail + "\n\n" + p
    if cur:
        chunks.append(cur)
    return chunks


def _cosine(a, b) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


async def reindex() -> dict:
    ollama_ok = await _ensure_embed_model()
    if not ollama_ok and not _EMBED_KEY:
        return {"ok": False, "error": "Embedding tidak tersedia: Ollama mati dan no key Gemini."}

    files = sorted(DEFAULT_DOC_DIR.glob("*.txt")) + sorted(
        DEFAULT_DOC_DIR.glob("*.md")
    ) + sorted(DEFAULT_DOC_DIR.glob("*.csv"))
    if not files:
        _state["index"] = {"files": {}}
        _save_config(_state["index"])
        return {"ok": True, "files": [], "chunks": 0}

    index = {"files": {}}
    for path in files:
        texts = chunk_text(path.read_text(encoding="utf-8", errors="ignore"))
        if not texts:
            continue
        try:
            vecs = await _embed(texts)
        except httpx.HTTPError:
            return {"ok": False, "error": f"Embedding gagal untuk {path.name}"}
        index["files"][path.name] = {
            "hash": _file_hash(path),
            "texts": texts,
            "vecs": vecs,
        }

    _state["index"] = index
    _save_config(index)
    total = sum(len(f["texts"]) for f in index["files"].values())
    return {"ok": True, "files": list(index["files"].keys()), "chunks": total}


def _load_index():
    if _state["index"] is None:
        _state["index"] = _load_config()
    return _state["index"]


async def search(query: str, k: int = TOP_K) -> list[dict]:
    index = _load_index()
    if not index.get("files"):
        return []
    try:
        qvec = (await _embed([query]))[0]
    except Exception:
        return []

    scored = []
    for fname, f in index["files"].items():
        for i, vec in enumerate(f["vecs"]):
            scored.append((_cosine(qvec, vec), fname, i))
    scored.sort(key=lambda x: -x[0])
    hits = []
    for score, fname, i in scored[:k]:
        if score > 0.25:
            hits.append({"file": fname, "text": f["texts"][i], "score": round(score, 3)})
    return hits


async def context(query: str) -> str:
    hits = await search(query)
    if not hits:
        return ""
    parts = [
        f"[Dokumen: {h['file']}]\n{h['text']}" for h in hits
    ]
    return "\n\n---\n\n".join(parts)


def status() -> dict:
    index = _load_index()
    files = []
    total = 0
    for fname, f in index.get("files", {}).items():
        n = len(f["texts"])
        total += n
        files.append({"name": fname, "chunks": n})
    return {
        "enabled": _state["enabled"],
        "model": EMBED_MODEL,
        "embed_source": _EMBED_SOURCE,
        "files": sorted(files, key=lambda x: x["name"]),
        "chunks": total,
    }