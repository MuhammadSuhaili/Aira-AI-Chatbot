"""Adapters untuk provider cloud (streaming, format hasil disatukan ke {
   "message": {"content": <token string>}, "done": bool }
)."""

import json

import httpx

AIRA_PROMPT_FILE = None  # diisi dari main.py


def set_prompt_file(path):
    global AIRA_PROMPT_FILE
    AIRA_PROMPT_FILE = path


# Katalog model cloud (shortlist personal). Bisa ditambah/diubah manual.
CURATED = {
    "groq": {
        "base": "https://api.groq.com/openai/v1",
        "models": ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    },
    "gemini": {
        "base": "https://generativelanguage.googleapis.com/v1beta",
        "models": ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
    },
    "openai": {
        "base": "https://api.openai.com/v1",
        "models": ["gpt-4o-mini", "gpt-4o"],
    },
    "openrouter": {
        "base": "https://openrouter.ai/api/v1",
        "models": ["openrouter/auto"],
    },
    "9router": {
        "base": "http://localhost:20128/v1",
        "models": ["combo-1", "combo-2", "combo-3"],
    },
}

TEMP = 0.7


async def stream_chat_compat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int | None = None,
):
    """OpenAI-compatible chat completions (Groq, OpenAI, OpenRouter, 9Router, dsb)."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"model": model, "messages": messages, "stream": True, "temperature": TEMP}
    if max_tokens:
        payload["max_tokens"] = max_tokens

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as r:
                if r.status_code != 200:
                    err = (await r.aread()).decode("utf-8", "ignore")
                    yield {"error": f"{model} ({r.status_code}): {err[:400]}"}
                    return
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    delta = obj.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        yield {"message": {"content": content}}
    except httpx.HTTPError as e:
        yield {"error": f"Gagal terhubung ke {base_url}: {e}"}
        return
    yield {"done": True}


def _gemini_text(obj: dict) -> str:
    """Ekstrak teks dari event/tanggapan Gemini (abaikan blok thought)."""
    parts = ((obj.get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


async def stream_gemini(api_key: str, model: str, system: str, messages: list[dict]):
    """Gemini generative (alt=sse). Google kadang balas SSE, kadang JSON inline. Tangani dua-duanya."""
    url = f"{CURATED['gemini']['base']}/models/{model}:streamGenerateContent?alt=sse"
    contents = []
    for m in messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})

    payload = {"contents": contents}
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    headers = {"Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST", url, headers=headers, params={"key": api_key}, json=payload
            ) as r:
                if r.status_code != 200:
                    err = (await r.aread()).decode("utf-8", "ignore")
                    yield {"error": f"{model} ({r.status_code}): {err[:400]}"}
                    return

                ctype = (r.headers.get("content-type") or "").lower()
                if "event-stream" in ctype:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        s = line[5:].strip()
                        if not s:
                            continue
                        try:
                            obj = json.loads(s)
                        except json.JSONDecodeError:
                            continue
                        text = _gemini_text(obj)
                        if text:
                            yield {"message": {"content": text}}
                else:
                    body = (await r.aread()).decode("utf-8", "ignore").strip()
                    events = []
                    if body.startswith("["):
                        try:
                            events = json.loads(body)
                        except json.JSONDecodeError:
                            events = []
                    elif body.startswith("{"):
                        events = [json.loads(body)]
                    else:
                        for line in body.splitlines():
                            s = line[5:].strip() if line.startswith("data:") else line.strip()
                            if s:
                                try:
                                    events.append(json.loads(s))
                                except json.JSONDecodeError:
                                    continue
                    for obj in events:
                        text = _gemini_text(obj)
                        if text:
                            yield {"message": {"content": text}}
    except httpx.HTTPError as e:
        yield {"error": f"Gagal terhubung ke Gemini: {e}"}
        return
    yield {"done": True}