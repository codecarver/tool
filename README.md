# Diagram & Notes Tools

Kumpulan alat bantu yang berjalan **sepenuhnya di browser** — tanpa server, tanpa login, tanpa build step. Semua data disimpan di perangkat Anda (localStorage / File System Access API).

## Isi

- **Mind Map** (`mindmap.html`) — peta pikiran radial: drag & drop, ciutkan/perluas, deskripsi per node, tandai selesai, zoom, ekspor PNG/JSON, impor JSON.
- **Sequence Diagram** (`sequence.html`) — tulis interaksi berbasis teks, render otomatis. Mendukung garis solid/putus-putus, tanda gagal (X), warna merah, self-loop, judul, separator, catatan.
- **Flow Diagram** (`flow.html`) — alur proses: terminator, proses, keputusan, input/output, dokumen, sub-proses, teks bebas; panah lengkung/siku, warna, grup.
- **Free Diagram** (`free.html`) — kanvas bebas: kotak, elips, wajik, teks; objek di dalam objek, warna, grup.
- **Notes (Markdown)** (`notes.html`) — editor catatan WYSIWYG format Markdown: buka folder lokal, jelajah file, auto-save, warna/highlight, font, tabel, collapsible, nested list, ekspor PDF.

> Catatan: fitur akses folder & auto-save pada Notes memakai File System Access API — butuh browser berbasis Chromium (Chrome/Edge).

## Menjalankan secara lokal

Karena murni statis, cukup buka `index.html` di browser. Untuk beberapa fitur (mis. akses folder) sebaiknya dijalankan lewat server statis sederhana:

```bash
# Python 3
python -m http.server 8000
# lalu buka http://localhost:8000

# atau Node (jika terpasang)
npx serve .
```

## Struktur

```
.
├── index.html        # halaman utama (daftar tools)
├── mindmap.html
├── sequence.html
├── flow.html
├── free.html
├── notes.html
├── css/
│   └── app.css
└── js/
    ├── mindmap.js
    ├── sequence.js
    ├── diagram-core.js   # dipakai flow.html & free.html
    └── notes.js
```

## Deploy ke GitHub Pages

Sudah disertakan workflow otomatis di `.github/workflows/deploy.yml`. Setelah push ke branch `main`:

1. Buka repositori di GitHub → **Settings** → **Pages**.
2. Pada **Build and deployment**, pilih **Source: GitHub Actions**.
3. Setiap push ke `main` akan otomatis men-deploy situs.

Situs akan tersedia di `https://<username>.github.io/<nama-repo>/`.

Alternatif tanpa Actions: Settings → Pages → Source: **Deploy from a branch** → pilih `main` / `root`. File `.nojekyll` memastikan aset disajikan apa adanya.

## Lisensi

Bebas digunakan. Built with love from Darjo, kota autopilot.
