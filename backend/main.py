import json
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import providers
import rag

OLLAMA_URL = "http://localhost:11434"
BASE_DIR = Path(__file__).resolve().parent
PROMPT_FILE = BASE_DIR / "aira_prompt.txt"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DOC_DIR = BASE_DIR.parent / "documents"
CONFIG_FILE = BASE_DIR / "config.json"
STREAM = True

_DEFAULT_CONFIG = {
    "gemini_api_key": "",
    "groq_api_key": "",
    "openai_api_key": "",
    "openai_base_url": "https://api.openai.com/v1",
    "openrouter_api_key": "",
    "nine_router_api_key": "",
    "nine_router_base_url": "http://localhost:20128/v1",
    "rag_enabled": False,
}

providers.set_prompt_file(PROMPT_FILE)
rag.init(DOC_DIR, BASE_DIR / "rag_index.json")

app = FastAPI(title="Aira Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Config helpers ──────────────────────────────────
def _load_config() -> dict:
    cfg = dict(_DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            cfg.update({k: v for k, v in json.loads(CONFIG_FILE.read_text(encoding="utf-8")).items() if k in cfg})
        except Exception:
            pass
    return cfg


rag._state["enabled"] = _load_config()["rag_enabled"]


def _sync_rag_key(cfg: dict = None):
    """Embedding RAG pakai Gemini sebagai cadangan saat Ollama tidak ada (mis. Render)."""
    cfg = cfg or _load_config()
    rag.set_embed_key(cfg.get("gemini_api_key") or "")


_sync_rag_key()


def _save_config(cfg: dict):
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _configured_providers(cfg: dict) -> list[str]:
    out = []
    if cfg.get("groq_api_key"):
        out.append("groq")
    if cfg.get("openai_api_key"):
        out.append("openai")
    if cfg.get("openrouter_api_key"):
        out.append("openrouter")
    if cfg.get("gemini_api_key"):
        out.append("gemini")
    return out


async def _nine_router_models(cfg: dict) -> list[str] | None:
    """Ambil daftar model chat dari 9Router (None jika tidak terjangkau)."""
    base = cfg.get("nine_router_base_url") or providers.CURATED["9router"]["base"]
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get(base.rstrip("/") + "/models")
            r.raise_for_status()
            ids, bad = [], ("/tts", "-image", "image-", "/stt", "-speech", "/embed", "-rerank")
            for m in r.json().get("data", []):
                mid = str(m.get("id", ""))
                if mid and not any(b in mid.lower() for b in bad):
                    ids.append(mid)
            return ids[:80] or None
    except httpx.HTTPError:
        return None


def _system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


_EMBED_HINTS = ("embed", "bge", "minilm", "snowflake", "mxbai", "text-embedding", "grande", "gte", "jina")


def _chat_models(names: list[str]) -> list[str]:
    """Hanya model chat — buang model embedding/rerank dari list Ollama."""
    return [n for n in names if not any(h in n.lower() for h in _EMBED_HINTS)]


# ── Models ──────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str | None = None
    provider: str | None = None


# ── Endpoints ───────────────────────────────────────
@app.get("/api/health")
async def health():
    local_ok = False
    local_models = []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            local_models = _chat_models([m["name"] for m in r.json().get("models", [])])
            local_ok = True
    except httpx.HTTPError:
        pass

    cfg = _load_config()
    providers_t = {p: True for p in _configured_providers(cfg)}
    if await _nine_router_models(cfg):
        providers_t["9router"] = True
    rag_status = rag.status()
    return {
        "ok": local_ok or bool(providers_t),
        "local": local_ok,
        "providers": providers_t,
        "models": local_models,
        "rag": {**rag_status, "enabled": bool(cfg.get("rag_enabled")) and rag_status["enabled"]},
    }


@app.get("/api/models")
async def models():
    local = []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            local = _chat_models([m["name"] for m in r.json().get("models", [])])
    except httpx.HTTPError:
        pass
    cfg = _load_config()
    nine_models = await _nine_router_models(cfg)
    return {
        "local": local,
        "groq": providers.CURATED["groq"]["models"],
        "gemini": providers.CURATED["gemini"]["models"],
        "openai": providers.CURATED["openai"]["models"],
        "openrouter": providers.CURATED["openrouter"]["models"],
        "9router": nine_models or [],
    }


@app.get("/api/settings")
async def get_settings():
    cfg = _load_config()
    return {
        "gemini_key_set": bool(cfg["gemini_api_key"]),
        "groq_key_set": bool(cfg["groq_api_key"]),
        "openai_key_set": bool(cfg["openai_api_key"]),
        "openai_base_url": cfg["openai_base_url"],
        "openrouter_key_set": bool(cfg["openrouter_api_key"]),
        "nine_router_key_set": bool(cfg["nine_router_api_key"]),
        "nine_router_base_url": cfg["nine_router_base_url"],
        "rag_enabled": bool(cfg["rag_enabled"]),
    }


@app.post("/api/settings")
async def post_settings(body: dict):
    cfg = _load_config()
    for key in (
        "gemini_api_key",
        "groq_api_key",
        "openai_api_key",
        "openrouter_api_key",
        "nine_router_api_key",
    ):
        if body.get(key):
            cfg[key] = str(body[key]).strip()
    if body.get("openai_base_url"):
        cfg["openai_base_url"] = str(body["openai_base_url"]).strip().rstrip("/")
    if body.get("nine_router_base_url"):
        cfg["nine_router_base_url"] = str(body["nine_router_base_url"]).strip().rstrip("/")
    if isinstance(body.get("rag_enabled"), bool):
        cfg["rag_enabled"] = body["rag_enabled"]
    _save_config(cfg)

    rag._state["enabled"] = cfg["rag_enabled"]
    _sync_rag_key(cfg)
    return await get_settings()


@app.get("/api/rag/status")
async def rag_status():
    st = rag.status()
    st["enabled"] = bool(_load_config().get("rag_enabled"))
    return st


@app.post("/api/rag/reindex")
async def rag_reindex():
    result = await rag.reindex()
    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result.get("error", "Index gagal"))
    return result


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="Pesan tidak boleh kosong")

    cfg = _load_config()
    provider = req.provider or _infer_provider(req.model)
    model = req.model or ""

    msg_list = [{"role": "system", "content": _system_prompt()}] + [
        m.model_dump() for m in req.messages
    ]

    # RAG — sisipkan konteks dokumen terbaru jika aktif & relevan
    if cfg.get("rag_enabled"):
        last_user = next(
            (m["content"] for m in reversed(msg_list) if m["role"] == "user"), ""
        )
        ctx = await rag.context(last_user)
        if ctx:
            msg_list.insert(
                len(msg_list) - 1,
                {
                    "role": "system",
                    "content": "Gunakan konteks dokumen pengguna berikut sebagai rujukan "
                    "utama jika relevan dengan pertanyaan:\n\n" + ctx,
                },
            )

    async def event_stream():
        stream = None
        if provider == "gemini" and cfg.get("gemini_api_key"):
            stream = providers.stream_gemini(
                cfg["gemini_api_key"], model, _system_prompt(), msg_list[1:]
            )
        elif provider in ("groq", "openai", "openrouter", "9router"):
            if provider == "openai":
                base = cfg.get("openai_base_url") or None
                key = cfg.get("openai_api_key")
            elif provider == "9router":
                base = cfg.get("nine_router_base_url") or None
                key = cfg.get("nine_router_api_key")
            else:
                base = None
                key = cfg.get(f"{provider}_api_key")
            if provider != "9router" and not key:
                yield _sse({"error": f"API key {provider} belum diisi. Buka Pengaturan."})
                return
            base = base or providers.CURATED[provider]["base"]
            max_tokens = 800 if provider == "groq" else None
            stream = providers.stream_chat_compat(base, key, model, msg_list, max_tokens)
        elif provider == "local":
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_URL}/api/chat",
                        json={"model": model, "messages": msg_list, "stream": STREAM},
                    ) as r:
                        if r.status_code != 200:
                            err = (await r.aread()).decode("utf-8", "ignore")
                            yield _sse({"error": f"Ollama ({r.status_code}): {err[:300]}"})
                            return
                        async for line in r.aiter_lines():
                            if line.strip():
                                yield _sse(line)
            except httpx.HTTPError as e:
                yield _sse({"error": f"Gagal terhubung ke Ollama: {e}"})
            return
        else:
            yield _sse({"error": f"Provider tidak dikenal: {provider}"})
            return

        async for chunk in stream:
            yield _sse(chunk)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _infer_provider(model: str | None) -> str:
    if not model:
        return "local"
    for prov, cur in providers.CURATED.items():
        if model in cur["models"]:
            return prov
    return "local"


def _sse(data) -> str:
    if isinstance(data, dict):
        data = json.dumps(data, ensure_ascii=False)
    return f"data: {data}\n\n"


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", 8000)),
        reload=True,
    )