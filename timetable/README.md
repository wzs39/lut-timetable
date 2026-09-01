# LUT Timetable (Jadwal Kuliah)

Aplikasi jadwal kuliah lintas platform (Windows + Android) untuk mahasiswa LUT/LAB — dibangun dengan React + TypeScript + Vite, dikemas dengan Capacitor (Android) dan Electron (Windows).

> **Catatan**: Versi web (GitHub Pages) sudah **tidak digunakan** — SISU ICS tidak
> mengirim header CORS sehingga sinkronisasi di browser bergantung pada proxy
> publik yang tidak stabil. Gunakan aplikasi native (Android APK / Windows installer)
> yang berjalan via `CapacitorHttp` atau `lut-proxy://` di Electron tanpa batasan CORS.

## Fitur

- **Sinkron otomatis SISU** — tempel tautan `https://sisu.lut.fi/ilmo/api/calendar-share/<uuid>` (dari SISU → Calendar → Enrolments → Share). Parser ICS bawaan menangani format Funidata (DTSTART + DURATION, timezone Europe/Helsinki).
- **TimeEdit** — tempel tautan kursus TimeEdit LUT (`...ri1Y8....html`); aplikasi mengubahnya ke URL langganan `.ics` dan mengimpor sebagai sumber tersendiri.
- **Tambah manual** — form cepat: nama, kode, lokasi, tanggal, jam mulai/selesai.
- **Notifikasi** — pengingat 10 menit sebelum setiap pelajaran (Capacitor Local Notifications, `allowWhileIdle`; jadwal disinkron-ulang otomatis setiap kali data berubah dan tiap 10 menit).
- **Tampilan mingguan** — grid Sen–Min 08:00–20:00, navigasi minggu, kode warna per sumber (biru = SISU, ungu = TimeEdit, hijau = manual). Klik blok pelajaran untuk menghapus.
- Data tersimpan lokal (localStorage) — offline-first.

## Menjalankan (dev)

```bash
npm install
npm run dev
```

Catatan CORS: di browser dev, request ke SISU/TimeEdit lewat proxy Vite (`/proxy/sisu`, `/proxy/timeedit`). Di aplikasi native (Android/Windows), request berjalan langsung lewat `CapacitorHttp` tanpa CORS.

## Build Android

```bash
npm run build
npx cap sync android   # wajib agar plugin Local Notifications terpasang
npx cap open android   # buka di Android Studio → Run
```

## Build Windows (Electron)

```bash
npm run electron:dev   # jalankan app desktop untuk development
npm run electron:build # build installer .msi/.exe ke release-electron/
```

## Multi-device

Data tersimpan lokal di tiap perangkat (localStorage). Untuk pindah perangkat:
**数据备份 → 导出数据** di perangkat lama, pindahkan file JSON, lalu **导入数据** di perangkat baru.

Layout responsif: di layar sempit (ponsel) sidebar berubah menjadi drawer via tombol ☰.

## Test

```bash
npm test             # Vitest: ics parser, layoutDay, URL normalize, dedupe
```

## Struktur

```
src/
  types.ts              # Lesson, SyncSource
  lib/
    ics.ts              # parser ICS (VEVENT, DURATION, unfolding, unescape)
    store.ts            # persistensi + normalisasi URL + merge sinkron
    fetchIcs.ts         # strategi fetch: native / proxy dev / corsproxy
    date.ts             # helper minggu/tanggal
  hooks/useTimetable.ts # state utama aplikasi
  components/
    WeekGrid.tsx        # grid mingguan
    Sidebar.tsx         # sumber sinkron + form manual
```
