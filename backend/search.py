"""Pencarian web — referensi info terkini tanpa API key (Google News, Bing, + fallback)."""

import asyncio
import re
import urllib.parse
import xml.etree.ElementTree as ET

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 8
MAX_RESULTS = 6
MAX_CTX_CHARS = 2400
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(html: str) -> str:
    return (
        _TAG_RE.sub("", html or "")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#x27;", "'")
        .replace("&#039;", "'")
        .replace("\r", " ")
        .strip()
    )


async def _fetch(url: str, params: dict = None, headers: dict = None):
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        return await client.get(url, params=params, headers=headers or {})


async def _google_news(query: str, lang: str) -> list[dict]:
    """Berita terkini dari Google News RSS (id/en) — andal & tanpa key."""
    hl = "id" if lang == "id" else "en-US"
    gl = "ID" if lang == "id" else "US"
    ceid = "ID:id" if lang == "id" else "US:en"
    try:
        r = await _fetch(
            "https://news.google.com/rss/search",
            params={"q": query, "hl": hl, "gl": gl, "ceid": ceid},
            headers={"User-Agent": UA},
        )
        root = ET.fromstring(r.text)
    except (httpx.HTTPError, ValueError, ET.ParseError):
        return []
    out = []
    for it in root.findall(".//item"):
        title = _clean(it.findtext("title") or "")
        link = (it.findtext("link") or "").strip()
        desc = _clean(it.findtext("description") or "")[:400]
        if not title:
            continue
        out.append({"title": title, "url": link, "snippet": desc})
    return out[:MAX_RESULTS]


async def _bing(query: str) -> list[dict]:
    """Hasil web umum dari Bing HTML."""
    try:
        r = await _fetch(
            "https://www.bing.com/search",
            params={"q": query},
            headers={"User-Agent": UA},
        )
        html = r.text
    except httpx.HTTPError:
        return []
    out = []
    for block in re.findall(r'<li class="b_algo".*?</li>', html, re.S)[:MAX_RESULTS]:
        a = re.search(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not a:
            continue
        url = a.group(1)
        if not url.startswith("http"):
            continue
        title = _clean(a.group(2)) or url
        p = re.search(r"<p[^>]*>(.*?)</p>", block, re.S)
        snippet = _clean(p.group(1)) if p else ""
        out.append({"title": title, "url": url, "snippet": snippet})
    return out


async def _ddg_instant(query: str) -> list[dict]:
    """Instant Answer DuckDuckGo (jawaban langsung untuk banyak pertanyaan)."""
    try:
        r = await _fetch(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": 1, "skip_disambig": 1},
            headers={"User-Agent": UA},
        )
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return []
    out = []
    if data.get("AbstractText"):
        out.append(
            {
                "title": data.get("Heading") or data.get("AbstractTitle") or query,
                "url": data.get("AbstractURL") or "",
                "snippet": data["AbstractText"][:500],
            }
        )
    for t in data.get("RelatedTopics") or []:
        if isinstance(t, dict) and t.get("Text"):
            out.append(
                {
                    "title": t["Text"][:80],
                    "url": t.get("FirstURL") or "",
                    "snippet": t["Text"],
                }
            )
    return out


async def _wiki(query: str, lang: str) -> list[dict]:
    """Ringkasan dari Wikipedia (extracts), bahasa id/en."""
    api = f"https://{lang}.wikipedia.org/w/api.php"
    try:
        r = await _fetch(
            api,
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": query,
                "gsrlimit": 3,
                "prop": "extracts",
                "explaintext": 1,
                "exintro": 1,
                "exchars": 600,
                "redirects": 1,
                "format": "json",
                "formatversion": 2,
            },
            headers={"User-Agent": UA},
        )
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return []
    out = []
    for p in data.get("query", {}).get("pages") or []:
        title, extract = p.get("title"), (p.get("extract") or "").strip()
        if not title or not extract:
            continue
        out.append(
            {
                "title": title,
                "url": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
                "snippet": extract[:600].replace("\n", " "),
            }
        )
    return out


async def search(query: str) -> list[dict]:
    """Gabungkan semua sumber, dedupe per URL, batasi hasil."""
    groups = await asyncio.gather(
        _google_news(query, "id"),
        _google_news(query, "en"),
        _bing(query),
        _ddg_instant(query),
        _wiki(query, "id"),
        _wiki(query, "en"),
        return_exceptions=True,
    )
    seen, out = set(), []
    for group in groups:
        if not isinstance(group, list):
            continue
        for item in group:
            key = (item.get("url") or "").split("#")[0].rstrip("/") or (
                item.get("title") or ""
            ).lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    return out[:MAX_RESULTS]


async def context(query: str) -> str:
    """Bentuk teks konteks untuk disuntikkan ke prompt model (kosong jika gagal)."""
    hits = await search(query)
    if not hits:
        return ""
    parts, total = [], 0
    for i, h in enumerate(hits, 1):
        block = (
            f"[Sumber {i}] {h.get('title', '').strip()}\n"
            f"{h.get('url', '').strip()}\n"
            f"{h.get('snippet', '').strip()}"
        )
        if total >= MAX_CTX_CHARS:
            break
        if len(block) > MAX_CTX_CHARS - total:
            block = block[: MAX_CTX_CHARS - total]
        parts.append(block)
        total += len(block)
    return "\n\n---\n\n".join(parts)