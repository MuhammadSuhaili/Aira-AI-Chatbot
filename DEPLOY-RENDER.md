# Deploy Aira ke Render.com (gratis, TANPA kartu kredit)

Aira akan jalan 24/7 di server Render tanpa laptop nyala, tanpa kartu kredit. Semua model chat pakai **API cloud** (Gemini + Groq). RAG otomatis pakai embedding **Gemini** (tidak butuh Ollama).

> Bedanya dengan VPS: instance Render free **tidur** kalau ~15 menit tidak dipakai (buka lagi ~30 detik untuk bangun). Fitur ini hanya di plan free — jalan, hanya kadang "tidur".

---

## 1. Buat akun GitHub (gratis)

Buka https://github.com → daftar (bebas, tanpa kartu).

## 2. Buat repo + upload kode Aira

Di Windows, buka PowerShell di folder `Project 1`:

```powershell
gci | measure
# pastikan folder Chatbot ada, lalu:
cd Chatbot

git init
git add .
git commit -m "Aira siap deploy"
git branch -M main
git remote add origin https://github.com/<username-github>/aira.git
git push -u origin main
```

> Ganti `<username-github>` dengan username kamu. Repo boleh **Private**. File `backend/config.json` (berisi API key) sudah otomatis di-skip oleh `.gitignore`.

## 3. Buat web service di Render

1. Buka https://dashboard.render.com → login pakai akun **GitHub**
2. Klik **New +** → **Blueprint**
3. Pilih repo `aira` yang barusan kamu push → klik **Apply**
4. Render membaca `render.yaml` otomatis dan mulai deploy (instal Python + jalankan server, ±5 menit)
5. Saat selesai, muncul URL: `https://aira-chatbot.onrender.com`

## 4. Masukkan API key

1. Buka `https://aira-chatbot.onrender.com`
2. Roda gigi **Pengaturan** → isi **Gemini API Key** + **Groq API Key** → **Simpan**
3. Pilih model di dropdown **Gemini ☁ / Groq ☁**

## 5. Dokumen RAG

- Letakkan file `.txt`/`.md`/`.csv` di folder `Chatbot/documents` di laptop, commit & push lagi → Render auto-deploy
- Di web, masuk Pengaturan → nyalakan *Baca dokumen saat menjawab* → **Proses ulang file**

> Disk Render free tidak permanen: index dokumen di-reset setiap kode baru di-deploy (tinggal klik *Proses ulang file* lagi).

---

## Pembaruan kode berikutnya
Cukup commit & push di laptop → Render auto-deploy.

## Troubleshooting
| Masalah | Solusi |
|---|---|
| Halaman tidak kebuka / *sleeping* | Tunggu ~30 detik, refresh (otomatis di-bangunkan) |
| `healthCheckPath` gagal berkali-kali | Periksa log: *Service → Logs*; biasanya key/port tidak masalah, lihat traceback |
| RAG *Proses ulang file* gagal | Pastikan Gemini key terisi (embedding sekarang via Gemini) |
| Dropdown tidak muncul model apapun | Pastikan key sudah disimpan & halaman di-refresh |
| Model `Lokal` tidak muncul | Wajar — tidak ada Ollama di Render |