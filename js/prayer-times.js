// Widget "Waktu Sholat Berikutnya" — melayang di setiap halaman.
// Menghitung waktu sholat secara lokal (tanpa API) dari lintang/bujur/zona waktu.
// Pengguna bisa memakai lokasi otomatis (geolocation) atau memilih kota manual.
// Algoritma mengikuti metode umum (PrayTimes) — sudut Subuh/Isya default Kemenag RI (20°/18°).
(function () {
    'use strict';
    if (window.__prayerWidgetLoaded) return;
    window.__prayerWidgetLoaded = true;

    // ---------------- Daftar kota (manual) ----------------
    // { name, lat, lng, tz } tz = offset jam dari UTC.
    const CITIES = [
        { name: 'Jakarta', lat: -6.2088, lng: 106.8456, tz: 7 },
        { name: 'Sidoarjo', lat: -7.4478, lng: 112.7183, tz: 7 },
        { name: 'Surabaya', lat: -7.2575, lng: 112.7521, tz: 7 },
        { name: 'Bandung', lat: -6.9175, lng: 107.6191, tz: 7 },
        { name: 'Semarang', lat: -6.9667, lng: 110.4167, tz: 7 },
        { name: 'Yogyakarta', lat: -7.7956, lng: 110.3695, tz: 7 },
        { name: 'Malang', lat: -7.9797, lng: 112.6304, tz: 7 },
        { name: 'Medan', lat: 3.5952, lng: 98.6722, tz: 7 },
        { name: 'Palembang', lat: -2.9761, lng: 104.7754, tz: 7 },
        { name: 'Makassar', lat: -5.1477, lng: 119.4327, tz: 8 },
        { name: 'Denpasar', lat: -8.6705, lng: 115.2126, tz: 8 },
        { name: 'Balikpapan', lat: -1.2379, lng: 116.8529, tz: 8 },
        { name: 'Banjarmasin', lat: -3.3186, lng: 114.5944, tz: 8 },
        { name: 'Pontianak', lat: -0.0263, lng: 109.3425, tz: 7 },
        { name: 'Jayapura', lat: -2.5337, lng: 140.7181, tz: 9 },
        { name: 'Jambi', lat: -1.6101, lng: 103.6131, tz: 7 },
        { name: 'Pekanbaru', lat: 0.5071, lng: 101.4478, tz: 7 },
        { name: 'Padang', lat: -0.9471, lng: 100.4172, tz: 7 },
        { name: 'Banda Aceh', lat: 5.5483, lng: 95.3238, tz: 7 },
        { name: 'Mataram', lat: -8.5833, lng: 116.1167, tz: 8 },
        { name: 'Kupang', lat: -10.1772, lng: 123.6070, tz: 8 },
        { name: 'Manado', lat: 1.4748, lng: 124.8421, tz: 8 },
        { name: 'Ambon', lat: -3.6954, lng: 128.1814, tz: 9 },
        { name: 'Mekah', lat: 21.4225, lng: 39.8262, tz: 3 },
        { name: 'Madinah', lat: 24.5247, lng: 39.5692, tz: 3 },
        { name: 'Kuala Lumpur', lat: 3.1390, lng: 101.6869, tz: 8 },
        { name: 'Singapura', lat: 1.3521, lng: 103.8198, tz: 8 }
    ];

    const STORAGE = 'prayer-location';
    const PRAYERS = [
        { key: 'fajr', label: 'Subuh' },
        { key: 'sunrise', label: 'Terbit' },
        { key: 'dhuhr', label: 'Dzuhur' },
        { key: 'asr', label: 'Ashar' },
        { key: 'maghrib', label: 'Maghrib' },
        { key: 'isha', label: 'Isya' }
    ];

    // ---------------- Perhitungan astronomi ----------------
    const D2R = Math.PI / 180, R2D = 180 / Math.PI;
    function dsin(x) { return Math.sin(x * D2R); }
    function dcos(x) { return Math.cos(x * D2R); }
    function dtan(x) { return Math.tan(x * D2R); }
    function darcsin(x) { return R2D * Math.asin(x); }
    function darccos(x) { return R2D * Math.acos(x); }
    function darctan2(y, x) { return R2D * Math.atan2(y, x); }
    function darccot(x) { return R2D * Math.atan2(1, x); }
    function fixHour(a) { a = a % 24; return a < 0 ? a + 24 : a; }

    // Julian date
    function julian(y, m, d) {
        if (m <= 2) { y -= 1; m += 12; }
        const A = Math.floor(y / 100);
        const B = 2 - A + Math.floor(A / 4);
        return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
    }

    // Deklinasi matahari & persamaan waktu untuk Julian date
    function sunPosition(jd) {
        const D = jd - 2451545.0;
        const g2 = (357.529 + 0.98560028 * D) % 360;
        const q = (280.459 + 0.98564736 * D) % 360;
        const L = (q + 1.915 * dsin(g2) + 0.020 * dsin(2 * g2)) % 360;
        const e = 23.439 - 0.00000036 * D;
        const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
        const decl = darcsin(dsin(e) * dsin(L));
        const eqt = q / 15 - fixHour(RA);
        return { declination: decl, equation: eqt };
    }

    // Sudut waktu untuk ketinggian matahari tertentu
    function computeTime(angle, lat, decl) {
        const t = (1 / 15) * darccos(
            (-dsin(angle) - dsin(lat) * dsin(decl)) / (dcos(lat) * dcos(decl))
        );
        return t;
    }

    // Hitung semua waktu sholat (jam desimal waktu lokal) untuk tanggal & lokasi.
    function computeTimes(date, lat, lng, tz) {
        const jd = julian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);
        const sp = sunPosition(jd);
        const decl = sp.declination, eqt = sp.equation;
        const noon = fixHour(12 - eqt - lng / 15 + tz);

        const fajrAngle = 20, ishaAngle = 18; // Kemenag RI
        const fajr = noon - computeTime(fajrAngle, lat, decl);
        const sunrise = noon - computeTime(0.833, lat, decl);
        const dhuhr = noon;
        // Ashar (mazhab Syafi'i: shadow factor 1)
        const asrAngle = -darccot(1 + dtan(Math.abs(lat - decl)));
        const asr = noon + computeTime(asrAngle, lat, decl);
        const maghrib = noon + computeTime(0.833, lat, decl);
        const isha = noon + computeTime(ishaAngle, lat, decl);
        return { fajr: fajr, sunrise: sunrise, dhuhr: dhuhr, asr: asr, maghrib: maghrib, isha: isha };
    }

    function fmtHM(hours) {
        let t = fixHour(hours + 0.5 / 60); // bulatkan ke menit terdekat
        let h = Math.floor(t);
        let m = Math.floor((t - h) * 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    // ---------------- State lokasi ----------------
    function getLocation() {
        try {
            const raw = localStorage.getItem(STORAGE);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* abaikan */ }
        return null;
    }
    function setLocation(loc) {
        try { localStorage.setItem(STORAGE, JSON.stringify(loc)); } catch (e) { /* abaikan */ }
    }

    // ---------------- UI ----------------
    let loc = getLocation();
    const el = document.createElement('div');
    el.className = 'pw-widget';
    el.innerHTML =
        '<button type="button" class="pw-main" aria-label="Waktu sholat berikutnya">' +
        '  <span class="pw-icon">🕌</span>' +
        '  <span class="pw-text"><span class="pw-next">—</span><span class="pw-count">memuat…</span></span>' +
        '</button>' +
        '<div class="pw-panel" hidden>' +
        '  <div class="pw-panel-head"><strong>Jadwal Sholat</strong><button type="button" class="pw-close" aria-label="Tutup">×</button></div>' +
        '  <div class="pw-loc"><span class="pw-loc-name">—</span></div>' +
        '  <ul class="pw-list"></ul>' +
        '  <div class="pw-actions">' +
        '    <button type="button" class="pw-geo">📍 Gunakan lokasi saya</button>' +
        '    <label class="pw-city-lbl">Kota:' +
        '      <select class="pw-city"></select>' +
        '    </label>' +
        '  </div>' +
        '  <p class="pw-note">Perhitungan lokal, metode Kemenag RI (Subuh 20°, Isya 18°). Perbedaan beberapa menit mungkin terjadi.</p>' +
        '</div>';
    document.body.appendChild(el);

    const mainBtn = el.querySelector('.pw-main');
    const panel = el.querySelector('.pw-panel');
    const nextEl = el.querySelector('.pw-next');
    const countEl = el.querySelector('.pw-count');
    const listEl = el.querySelector('.pw-list');
    const locNameEl = el.querySelector('.pw-loc-name');
    const citySel = el.querySelector('.pw-city');
    const geoBtn = el.querySelector('.pw-geo');
    const closeBtn = el.querySelector('.pw-close');

    // isi dropdown kota
    const optDefault = document.createElement('option');
    optDefault.value = ''; optDefault.textContent = '— pilih kota —';
    citySel.appendChild(optDefault);
    CITIES.forEach(function (c, i) {
        const o = document.createElement('option');
        o.value = String(i); o.textContent = c.name;
        citySel.appendChild(o);
    });

    mainBtn.addEventListener('click', function () {
        const show = panel.hasAttribute('hidden');
        if (show) { panel.removeAttribute('hidden'); refreshPanel(); }
        else panel.setAttribute('hidden', '');
    });
    closeBtn.addEventListener('click', function () { panel.setAttribute('hidden', ''); });

    citySel.addEventListener('change', function () {
        const v = citySel.value;
        if (v === '') return;
        const c = CITIES[+v];
        loc = { name: c.name, lat: c.lat, lng: c.lng, tz: c.tz, source: 'manual' };
        setLocation(loc);
        tick(); refreshPanel();
    });

    geoBtn.addEventListener('click', function () {
        if (!navigator.geolocation) { alert('Geolocation tidak didukung browser ini.'); return; }
        geoBtn.textContent = 'Mendeteksi…';
        navigator.geolocation.getCurrentPosition(function (pos) {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            const tz = -new Date().getTimezoneOffset() / 60; // offset jam lokal perangkat
            loc = { name: 'Lokasi saya', lat: lat, lng: lng, tz: tz, source: 'geo' };
            setLocation(loc);
            geoBtn.textContent = '📍 Gunakan lokasi saya';
            citySel.value = '';
            tick(); refreshPanel();
        }, function () {
            geoBtn.textContent = '📍 Gunakan lokasi saya';
            alert('Gagal mendapatkan lokasi. Silakan pilih kota secara manual.');
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    });

    // Countdown ke waktu sholat berikutnya
    function nextPrayer() {
        if (!loc) return null;
        const now = new Date();
        const today = computeTimes(now, loc.lat, loc.lng, loc.tz);
        const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
        // urutan sholat wajib (tanpa terbit)
        const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        for (let i = 0; i < order.length; i++) {
            const k = order[i];
            if (today[k] > nowH) {
                return { key: k, label: labelOf(k), diffH: today[k] - nowH };
            }
        }
        // sudah lewat Isya -> Subuh besok
        const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
        const t2 = computeTimes(tomorrow, loc.lat, loc.lng, loc.tz);
        return { key: 'fajr', label: 'Subuh', diffH: (24 - nowH) + t2.fajr };
    }

    function labelOf(k) {
        const p = PRAYERS.filter(function (x) { return x.key === k; })[0];
        return p ? p.label : k;
    }

    function fmtCountdown(diffH) {
        let totalMin = Math.max(0, Math.round(diffH * 60));
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        if (h > 0 && m > 0) return h + ' hour' + (h > 1 ? 's' : '') + ' ' + m + ' minute' + (m > 1 ? 's' : '');
        if (h > 0) return h + ' hour' + (h > 1 ? 's' : '');
        return m + ' minute' + (m !== 1 ? 's' : '');
    }

    function tick() {
        if (!loc) {
            nextEl.textContent = 'Set lokasi';
            countEl.textContent = 'ketuk untuk atur';
            return;
        }
        const np = nextPrayer();
        if (!np) return;
        nextEl.textContent = np.label;
        countEl.textContent = 'in ' + fmtCountdown(np.diffH);
    }

    function refreshPanel() {
        locNameEl.textContent = loc ? loc.name : 'Belum diatur';
        listEl.innerHTML = '';
        if (!loc) return;
        const t = computeTimes(new Date(), loc.lat, loc.lng, loc.tz);
        const np = nextPrayer();
        PRAYERS.forEach(function (p) {
            const li = document.createElement('li');
            li.className = 'pw-row' + (np && np.key === p.key ? ' pw-active' : '');
            li.innerHTML = '<span>' + p.label + '</span><span>' + fmtHM(t[p.key]) + '</span>';
            listEl.appendChild(li);
        });
    }

    // Auto-detect lokasi pertama kali (tanpa prompt paksa): kalau belum ada,
    // biarkan pengguna mengatur. Tapi coba tebak zona dari perangkat + default kota.
    if (loc && loc.source === 'manual') {
        const idx = CITIES.findIndex(function (c) { return c.name === loc.name; });
        if (idx >= 0) citySel.value = String(idx);
    }

    tick();
    setInterval(tick, 30 * 1000); // perbarui tiap 30 detik
})();
