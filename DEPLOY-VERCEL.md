# Deploy Aira ke Vercel (gratis, tanpa kartu)

Backend FastAPI + frontend disajikan lewat satu function ASGI (`api/index.py`).
Key API dibaca dari **Vercel Environment Variables** (bukan `config.json` yang di-ignore).
`config.json` masih dipakai di lokal; di Vercel file itu tidak bisa ditulis jadi harus pakai env.

## 1. Import proyek
1. Buka https://vercel.com → sign up (pakai akun GitHub) — **Hobby plan gratis, tidak perlu kartu**.
2. Buat proyek → **Import** dari GitHub → pilih repo `aira`.
3. Framework Preset: biarkan auto / pilih **Other**. Build Command kosong.
4. Set **Environment Variables** (Settings → Environment Variables), contoh:
   - `GEMINI_API_KEY` = key Gemini kamu
   - `GROQ_API_KEY` = key Groq kamu
   - `RAG_ENABLED` = `false` (RAG butuh file lokal yang tidak persisten di serverless)
5. **Deploy**. Vercel auto-detect Python lewat `requirements.txt` di root.

## 2. Selesai
Aplikasi langsung online dengan URL `https://<nama-repo>.vercel.app`.
Chat/Gemini/Groq jalan. Setiap push ke GitHub otomatis redeploy.
Streaming diproses dengan `maxDuration: 60` (limit Hobby).

## Catatan
- **RAG tidak disarankan di Vercel** — disk ephemeral/read-only, index & dokumen tidak persisten antar instance.
- Key baru disimpan via env vars, bukan dari settings modal (filesystem read-only). Isi di modal lokal untuk uji lokal.
- 9Router/Ollama (localhost) tidak relevan di cloud — jangan dipakai.
- Frontend & `/api/*` semuanya dihandle function; tidak ada file statis terpisah.