# Deploy Aira ke Google Cloud (e2-micro gratis 24/7)

Panduan ini membuat Aira **selalu online** tanpa laptop harus nyala. Semua model chat dipakai dari API cloud (Gemini + Groq). Ollama di server hanya untuk **embedding RAG** (ringan, jalan di CPU).

---

## 1. Siapkan VM e2-micro (gratis selamanya)

1. Buka https://console.cloud.google.com → login akun Google → buat **project** baru
2. **Billing** harus ada (kartu kredit hanya verifikasi, tidak ditagih selama tetap di free tier)
3. Menu **Compute Engine → VM instances → Create instance**
4. Isi:
   - **Name**: `aira-vm`
   - **Region**: `us-central1` (atau `us-west1` / `us-east1` — **wajib**, di luar ini e2-micro berbayar)
   - **Machine type**: klik *Create instance* → *e2-micro* (2 vCPU shared, 1GB RAM) — di bawah *General purpose*
   - **Boot disk**: Debian 12 (atau Ubuntu 24.04), ukuran default
5. Klik **Create**

## 2. Buka port 8000 di firewall

```bash
gcloud compute firewall-rules create allow-aira --allow tcp:8000 --source-ranges 0.0.0.0/0 --description "Aira chatbot port"
```

(Login `gcloud` dulu dengan `gcloud auth login`.)

## 3. Kirim file Aira dari laptop ke VM

Di laptop Windows kamu (folder `Project 1`), buka PowerShell:

```powershell
# pastikan sudah gcloud auth login
gcloud compute scp --recurse "Chatbot" aira-vm:~
```

Kemudian di dalam VM (buka via SSH: Console → VM → *SSH*):

```bash
sudo mv ~/Chatbot /opt/aira
sudo chown -R aira:aira /opt/aira
```

> **Penting:** sebelum upload, hapus `Chatbot/backend/config.json` dari laptop/arsip kalau sudah terisi key (key akan diisi ulang di server).

## 4. Jalankan script setup di VM

```bash
sudo bash /opt/aira/deploy/setup-server.sh
```

Script ini akan:
- Install Python 3 + dependency (FastAPI, uvicorn, httpx)
- Tambah **swap 4GB** (wajib demi 1GB RAM)
- Install **Ollama** + pull `nomic-embed-text` (untuk RAG)
- Buat user & service `aira` biar jalan terus + auto-restart
- Jalankan Aira di **port 8000**

## 5. Pastikan berjalan

```bash
curl -s localhost:8000/api/health
```

Harus muncul `{"ok":true, ...}`. Dari luar juga bisa:

```bash
curl -s http://<IP-PUBLIK-VM>:8000/api/health
```

IP publik terlihat di menu VM instances (kolom *External IP*).

## 6. Masukkan API key cloud

Buka `http://<IP-PUBLIK-VM>:8000` di browser → roda gigi **Pengaturan** → isi:
- **Gemini API Key** + **Groq API Key** → Simpan

Sekarang dropdown menampilkan model `Gemini ☁` dan `Groq ☁`. **Jangan pilih Lokal** (llama3.2 tidak muat di RAM 1GB server).

## 7. Dokumen RAG (jika ingin Aira baca file kamu)

1. Letakkan file di folder ini di VM `/opt/aira/documents`
2. Buka Aira → Pengaturan → nyalakan *Baca dokumen saat menjawab* → **Proses ulang file**

## 8. (Opsional) HTTPS gratis dengan domain

Fungsional HTTP tanpa password sudah cukup buat pribadi, tapi semua lalu lintas terlihat polos. Kalau mau HTTPS + alamat cantik gratis:
1. Daftar https://www.cloudflare.com → tambahkan domain → Create Tunnel
2. Install `cloudflared` di VM dan arahkan tunnel ke `http://localhost:8000`
3. Akses Aira via URL aman `https://...` — IP server pun tersembunyi

---

## Rekap biaya & RAM
- VM + 30GB disk + lalu lintas: **Rp 0**
- Model Gemini/Groq: **gratis** (kuota harian)
- Pemakaian RAM: sistem ~200MB + uvicorn ~120MB + Ollama embedding (aktif saat pencarian saja) — cukup dengan swap 4GB

## Troubleshooting
| Masalah | Solusi |
|---|---|
| `curl` dari luar gagal | Cek firewall rule langkah 2; pastikan VM pakai network default |
| Service mati tiap beberapa menit | `journalctl -u aira -n 50` untuk lihat error |
| `/api/health` `"local":false` | Wajar — Ollama hanya untuk embedding, bukan chat |
| RAG reindex gagal | `systemctl status ollama`; pastikan `nomic-embed-text` ter-pull |