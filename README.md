# Aira Chatbot

Chatbot AI bernama **Aira** — web app lokal, backend Python (FastAPI), model dijalankan via **Ollama** (lokal) dan mendukung API cloud (Gemini, Groq, OpenAI, OpenRouter). Bisa membaca dokumen lokal (RAG).

## Struktur

```
Chatbot/
├── backend/
│   ├── main.py            # Server FastAPI (chat, pengaturan, RAG)
│   ├── providers.py       # Adapter API cloud (Gemini/Groq/OpenAI/OpenRouter)
│   ├── rag.py             # Pemrosesan dokumen + retrieval (RAG)
│   ├── aira_prompt.txt    # System prompt / kepribadian Aira (bisa diedit)
│   ├── config.json        # Dibuat otomatis — berisi API key (jangan di-commit)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── documents/             # Taruh file .txt/.md/.csv di sini untuk RAG
```

## Cara Menjalankan

### 1. Install Ollama

Unduh di https://ollama.com/download (Windows: installer exe). Setelah install, buka terminal dan dalami satu model:

```bash
ollama pull llama3.2
```

Untuk fitur RAG, pull juga model embedding:

```bash
ollama pull nomic-embed-text
```

Model lain yang bisa dicoba: `qwen2.5`, `mistral`, `gemma2`, `llama3.1`, `phi3`. Cek daftar model di https://ollama.com/library

### 2. Install dependency Python

Buka terminal di folder `backend`:

```bash
cd Chatbot/backend
pip install -r requirements.txt
```

> Disarankan pakai virtual environment: `python -m venv venv` lalu aktifkan (`venv\Scripts\activate`).

### 3. Jalankan server

```bash
python main.py
```

Buka browser ke **http://127.0.0.1:8000** — chat Aira siap dipakai.

## Model Cloud (Opsional)

Lewat tombol roda gigi (**Pengaturan**) di pojok kanan atas, kamu bisa masukkan API key:

- **Gemini** — key gratis di https://aistudio.google.com (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`)
- **Groq** — key gratis di https://console.groq.com (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`)
- **OpenAI** — https://platform.openai.com (`gpt-4o`, `gpt-4o-mini`); base URL bisa diganti untuk kompatibilitas provider lain
- **OpenRouter** — https://openrouter.ai (`openrouter/auto`)
- **9Router** — gateway AI lokal gratis (router ke 60+ provider). Install `npm install -g 9router`, jalankan `9router`, sambungkan provider gratis di dashboard (`http://localhost:20128/dashboard`), lalu salin API key dari dashboard ke Pengaturan → *9Router API Key* (base URL default `http://localhost:20128/v1` sudah terisi)

Setelah key disimpan, model cloud muncul di dropdown (dikelompokkan per provider). Key disimpan di `backend/config.json` dan **tidak pernah dikirim kembali ke browser**.

## RAG — Baca Dokumen Lokal

1. Taruh file `.txt`, `.md`, atau `.csv` di folder `Chatbot/documents/`
2. Di **Pengaturan**, nyalakan toggle *Baca dokumen saat menjawab* lalu klik **Proses ulang file**
3. Beberapa detik kemudian Aira bisa menjawab berdasarkan isi dokumen kamu

File diproses sekali (di-cache lewat hash) — pemrosesan ulang hanya membaca file yang berubah. Tanpa Ollama berjalan, pemrosesan/pencarian dokumen tidak bisa dilakukan.

## Tips

- Ganti kepribadian/bahasa Aira dengan mengedit `backend/aira_prompt.txt`
- Model lokal default adalah `llama3.2`; pilih model/provider lain dari dropdown di web
- Ollama harus **sedang berjalan** (biasanya otomatis jalan setelah install, ada ikon di taskbar) saat dipakai
- Jangan bagikan `backend/config.json` — file itu berisi API key kamu