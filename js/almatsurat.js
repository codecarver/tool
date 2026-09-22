// Al-Ma'tsurat (Sugro) — Dzikir Pagi & Petang. Menampilkan daftar dzikir dengan
// penghitung per item; ketuk item untuk menambah hitungan. Progres tersimpan di
// localStorage (terpisah pagi/petang) dan otomatis reset di hari baru.
(function () {
    'use strict';
    const DATASETS = {
        pagi: window.ALMATSURAT_PAGI || [],
        petang: window.ALMATSURAT_PETANG || []
    };

    const listEl = document.getElementById('am-list');
    const totalDoneEl = document.getElementById('am-total-done');
    const totalAllEl = document.getElementById('am-total-all');
    const barEl = document.getElementById('am-progress-bar');
    const resetBtn = document.getElementById('am-reset');
    const latinToggle = document.getElementById('am-toggle-latin');
    const transToggle = document.getElementById('am-toggle-trans');
    const modeBtns = document.querySelectorAll('.am-mode-btn');

    const MODE_KEY = 'almatsurat-mode';

    // Mode aktif: 'pagi' atau 'petang'. Default mengikuti waktu (>= 15:00 -> petang).
    let mode = localStorage.getItem(MODE_KEY);
    if (mode !== 'pagi' && mode !== 'petang') {
        mode = (new Date().getHours() >= 15) ? 'petang' : 'pagi';
    }

    let DATA = DATASETS[mode];
    let totalCount = 0;
    let counts = [];

    function storageKey() { return 'almatsurat-' + mode + '-progress'; }

    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function load() {
        counts = DATA.map(function () { return 0; });
        try {
            const raw = localStorage.getItem(storageKey());
            if (!raw) return;
            const obj = JSON.parse(raw);
            // Reset progress bila sudah beda hari.
            if (obj && obj.day === todayKey() && Array.isArray(obj.counts) && obj.counts.length === DATA.length) {
                counts = obj.counts.map(function (n, i) { return Math.max(0, Math.min(n | 0, DATA[i].count)); });
            }
        } catch (e) { /* abaikan */ }
    }

    function save() {
        try {
            localStorage.setItem(storageKey(), JSON.stringify({ day: todayKey(), counts: counts }));
        } catch (e) { /* abaikan */ }
    }

    // Hitung berdasarkan BAGIAN (section) yang sudah selesai, bukan per pengulangan.
    function totalDone() {
        return counts.reduce(function (s, n, i) {
            return s + (n >= DATA[i].count ? 1 : 0);
        }, 0);
    }

    function updateHeader() {
        const done = totalDone();
        totalDoneEl.textContent = done;
        totalAllEl.textContent = totalCount;
        const pct = totalCount ? Math.round((done / totalCount) * 100) : 0;
        barEl.style.width = pct + '%';
        barEl.setAttribute('aria-valuenow', String(pct));
    }

    function updateItem(idx) {
        const card = listEl.children[idx];
        if (!card) return;
        const cur = counts[idx];
        const max = DATA[idx].count;
        card.querySelector('.am-counter').textContent = cur + ' / ' + max;
        card.classList.toggle('am-complete', cur >= max);
    }

    function bump(idx) {
        const max = DATA[idx].count;
        if (counts[idx] < max) {
            counts[idx]++;
        } else {
            // sudah penuh -> ketuk lagi untuk reset item ini ke 0
            counts[idx] = 0;
        }
        updateItem(idx);
        updateHeader();
        save();
    }

    function render() {
        listEl.innerHTML = '';
        DATA.forEach(function (item, idx) {
            const card = document.createElement('div');
            card.className = 'am-item';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', item.title + ', tap untuk menghitung');

            const head = document.createElement('div');
            head.className = 'am-item-head';
            head.innerHTML =
                '<span class="am-rep">' + item.count + '×</span>' +
                '<span class="am-title">' + escapeHtml(item.title) + '</span>' +
                '<span class="am-counter">0 / ' + item.count + '</span>';

            const ar = document.createElement('div');
            ar.className = 'am-arabic';
            ar.setAttribute('dir', 'rtl');
            ar.setAttribute('lang', 'ar');
            ar.textContent = item.arabic;

            const la = document.createElement('div');
            la.className = 'am-latin';
            la.textContent = item.latin;

            const tr = document.createElement('div');
            tr.className = 'am-trans';
            tr.textContent = item.translation;

            card.appendChild(head);
            card.appendChild(ar);
            card.appendChild(la);
            card.appendChild(tr);

            // Faedah & Sumber (collapsible). Klik di sini TIDAK menambah hitungan.
            if (item.faedah || item.sumber) {
                const det = document.createElement('details');
                det.className = 'am-faedah';
                const sum = document.createElement('summary');
                sum.textContent = 'Faedah & Sumber';
                det.appendChild(sum);
                const body = document.createElement('div');
                body.className = 'am-faedah-body';
                if (item.faedah) {
                    const f = document.createElement('p');
                    f.className = 'am-faedah-text';
                    f.textContent = item.faedah;
                    body.appendChild(f);
                }
                if (item.hadits) {
                    const h = document.createElement('blockquote');
                    h.className = 'am-hadits-text';
                    h.textContent = item.hadits;
                    body.appendChild(h);
                    if (item.haditsRawi) {
                        const rw = document.createElement('p');
                        rw.className = 'am-hadits-rawi';
                        rw.textContent = '— ' + item.haditsRawi;
                        body.appendChild(rw);
                    }
                }
                if (item.sumber) {
                    const s = document.createElement('p');
                    s.className = 'am-sumber-text';
                    s.innerHTML = '<span class="am-sumber-label">Sumber:</span> ' + escapeHtml(item.sumber);
                    body.appendChild(s);
                }
                det.appendChild(body);
                // Cegah klik pada details memicu penghitung kartu.
                det.addEventListener('click', function (e) { e.stopPropagation(); });
                det.addEventListener('keydown', function (e) { e.stopPropagation(); });
                card.appendChild(det);
            }

            // Ketuk di mana saja pada kartu untuk menambah hitungan.
            card.addEventListener('click', function () { bump(idx); });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bump(idx); }
            });

            listEl.appendChild(card);
            updateItem(idx);
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function applyVisibility() {
        listEl.classList.toggle('hide-latin', !latinToggle.checked);
        listEl.classList.toggle('hide-trans', !transToggle.checked);
    }

    function updateModeButtons() {
        modeBtns.forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === mode);
            b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
        });
    }

    // Muat data mode aktif lalu render ulang seluruh tampilan.
    function loadMode() {
        DATA = DATASETS[mode];
        totalCount = DATA.length; // total = jumlah bagian (section)
        load();
        render();
        updateHeader();
    }

    function switchMode(next) {
        if (next === mode || !DATASETS[next] || !DATASETS[next].length) return;
        mode = next;
        try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* abaikan */ }
        updateModeButtons();
        loadMode();
        // Gulir ke atas agar pengguna melihat perubahan dari awal.
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ---- init ----
    updateModeButtons();
    loadMode();
    applyVisibility();

    modeBtns.forEach(function (b) {
        b.addEventListener('click', function () { switchMode(b.getAttribute('data-mode')); });
    });

    resetBtn.addEventListener('click', function () {
        if (!confirm('Reset semua hitungan ke 0?')) return;
        counts = DATA.map(function () { return 0; });
        DATA.forEach(function (_, i) { updateItem(i); });
        updateHeader();
        save();
    });

    latinToggle.addEventListener('change', function () { applyVisibility(); save(); });
    transToggle.addEventListener('change', function () { applyVisibility(); save(); });
})();
