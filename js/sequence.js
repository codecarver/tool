(function () {
    'use strict';

    const STORAGE_KEY = 'rtfinance.sequence.v1';
    const SAMPLE = [
        'title: Proses Login Warga',
        'Warga -> Sistem: Login',
        'Sistem -> Sistem: Validasi input',
        'Sistem -> Database: Cek kredensial jika\\nkondisi terpenuhi',
        'Database --> Sistem: Hasil',
        '--- Verifikasi OTP ---',
        'Sistem -x Warga: Gagal kirim OTP [red]',
        'Sistem -> Warga: Tampilkan dashboard'
    ].join('\n');

    const input = document.getElementById('sq-input');
    const svg = document.getElementById('sq-svg');

    // ===== Parse =====
    // Format per baris: "A -> B: pesan"  atau  "note: teks"
    // Sintaks per baris:
    //   A -> B: pesan       (garis solid)
    //   A --> B: pesan      (garis putus-putus)
    //   A -x B: pesan        (tanda X di ujung = gagal)
    //   A --x B: pesan       (putus-putus + gagal)
    //   Tambahkan [red] di mana saja pada pesan untuk warna merah.
    //   note: teks
    function parse(text) {
        const actors = [];
        const actorSet = {};
        const steps = [];
        let title = null;
        text.split(/\r?\n/).forEach(function (raw) {
            const line = raw.trim();
            if (!line) return;
            // Judul keseluruhan (opsional): "title: teks"
            const titleMatch = line.match(/^title\s*:\s*(.*)$/i);
            if (titleMatch) { title = titleMatch[1].trim(); return; }
            // Separator horizontal: "---" atau "--- teks"
            const sepMatch = line.match(/^---+\s*(.*)$/);
            if (sepMatch) { steps.push({ type: 'sep', text: sepMatch[1].trim() }); return; }
            const noteMatch = line.match(/^note\s*:\s*(.*)$/i);
            if (noteMatch) { steps.push({ type: 'note', text: noteMatch[1] }); return; }
            // operator: -> , --> , -x , --x
            const m = line.match(/^(.+?)\s*(--?)(>|x)\s*(.+?)\s*:\s*(.*)$/i);
            if (!m) { steps.push({ type: 'note', text: line }); return; }
            const from = m[1].trim();
            const dashed = m[2] === '--';
            const failed = m[3].toLowerCase() === 'x';
            const to = m[4].trim();
            let msg = m[5].trim();
            let red = false;
            if (/\[red\]/i.test(msg)) { red = true; msg = msg.replace(/\[red\]/ig, '').trim(); }
            [from, to].forEach(function (a) {
                if (!actorSet[a]) { actorSet[a] = true; actors.push(a); }
            });
            // Ganti baris manual: tulis "\n" pada pesan untuk memaksa baris baru.
            const lines = msg.split('\\n').map(function (t) { return t.trim(); });
            // Loop ke diri sendiri bila from === to.
            const self = from === to;
            steps.push({ type: 'msg', from: from, to: to, text: msg, lines: lines, dashed: dashed, failed: failed, red: red, self: self });
        });
        return { actors: actors, steps: steps, title: title };
    }

    // ===== Render ke SVG =====
    const NS = 'http://www.w3.org/2000/svg';
    function el(name, attrs, text) {
        const e = document.createElementNS(NS, name);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (text != null) e.textContent = text;
        return e;
    }

    // Teks multi-baris di SVG: baris terakhir berada di y (tepat di atas garis),
    // baris-baris sebelumnya ditumpuk di atasnya. Mengembalikan elemen <text>.
    function multiText(x, y, anchor, fill, lines, lineH) {
        const t = el('text', { x: x, 'text-anchor': anchor, 'font-size': '12', fill: fill });
        const n = lines.length;
        lines.forEach(function (ln, i) {
            const dy = y - (n - 1 - i) * lineH; // baris terakhir di y
            t.appendChild(el('tspan', { x: x, y: dy }, ln));
        });
        return t;
    }

    let lastModel = { actors: [], steps: [] };

    function render() {
        const model = parse(input.value);
        lastModel = model;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        const marginX = 40, actorH = 34, gapY = 50;
        const titleH = model.title ? 34 : 0;   // ruang untuk judul keseluruhan
        const topY = 30 + titleH;
        const colW = 160;
        const actors = model.actors;
        const xOf = {};
        actors.forEach(function (a, i) { xOf[a] = marginX + colW / 2 + i * colW; });

        // Tinggi tiap langkah bisa berbeda: self-loop, pesan multi-baris perlu ruang ekstra.
        const LINE_H = 15;
        function labelLines(s) { return (s.lines && s.lines.length) ? s.lines.length : 1; }
        function stepHeight(s) {
            if (s.type === 'sep') return gapY - 10;
            if (s.type === 'note') return gapY;
            if (s.type === 'msg') {
                const extra = Math.max(0, labelLines(s) - 1) * LINE_H;
                return (s.self ? gapY + 20 : gapY) + extra;
            }
            return gapY;
        }

        const width = Math.max(400, marginX * 2 + Math.max(1, actors.length) * colW);
        const bodyTop = topY + actorH + 20;
        let totalStepsH = 0;
        model.steps.forEach(function (s) { totalStepsH += stepHeight(s); });
        const height = bodyTop + totalStepsH + 60;

        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        // Judul keseluruhan di paling atas (opsional)
        if (model.title) {
            svg.appendChild(el('text', { x: width / 2, y: 26, 'text-anchor': 'middle',
                'font-size': '18', 'font-weight': 'bold', fill: '#1f2933' }, model.title));
        }

        // arrow markers (normal + merah)
        const defs = el('defs', {});
        [['sq-arrow', '#3e4c59'], ['sq-arrow-red', '#d64545']].forEach(function (m) {
            const marker = el('marker', { id: m[0], markerWidth: '10', markerHeight: '10',
                refX: '8', refY: '3', orient: 'auto', markerUnits: 'strokeWidth' });
            marker.appendChild(el('path', { d: 'M0,0 L8,3 L0,6 Z', fill: m[1] }));
            defs.appendChild(marker);
        });
        svg.appendChild(defs);

        // lifelines + actor boxes
        actors.forEach(function (a) {
            const x = xOf[a];
            svg.appendChild(el('line', { x1: x, y1: topY + actorH, x2: x, y2: height - 30,
                stroke: '#cbd2d9', 'stroke-width': '1.5', 'stroke-dasharray': '4 4' }));
            const boxW = Math.max(80, a.length * 8 + 20);
            svg.appendChild(el('rect', { x: x - boxW / 2, y: topY, width: boxW, height: actorH,
                rx: 6, fill: '#e7f0ff', stroke: '#1f6feb', 'stroke-width': '1.5' }));
            svg.appendChild(el('text', { x: x, y: topY + actorH / 2 + 4, 'text-anchor': 'middle',
                'font-size': '13', fill: '#1f2933' }, a));
        });

        // steps
        let y = bodyTop;
        model.steps.forEach(function (s) {
            const h = stepHeight(s);
            if (s.type === 'sep') {
                // Separator horizontal untuk memisahkan bagian.
                svg.appendChild(el('line', { x1: marginX, y1: y, x2: width - marginX, y2: y,
                    stroke: '#9aa5b1', 'stroke-width': '1.5', 'stroke-dasharray': '2 4' }));
                if (s.text) {
                    const tw = s.text.length * 7 + 16;
                    svg.appendChild(el('rect', { x: width / 2 - tw / 2, y: y - 10, width: tw, height: 20, rx: 10,
                        fill: '#eef2f6', stroke: '#9aa5b1', 'stroke-width': '1' }));
                    svg.appendChild(el('text', { x: width / 2, y: y + 4, 'text-anchor': 'middle',
                        'font-size': '11', fill: '#52606d' }, s.text));
                }
            } else if (s.type === 'note') {
                const nx = marginX, nw = width - marginX * 2;
                svg.appendChild(el('rect', { x: nx, y: y - 14, width: nw, height: 26, rx: 4,
                    fill: '#fff7e6', stroke: '#b7791f', 'stroke-width': '1' }));
                svg.appendChild(el('text', { x: width / 2, y: y + 4, 'text-anchor': 'middle',
                    'font-size': '12', fill: '#7a5a12' }, s.text));
            } else if (s.self) {
                // Loop ke diri sendiri: panah kecil melingkar di sisi kanan lifeline.
                const x = xOf[s.from];
                if (x == null) { y += h; return; }
                const color = s.red ? '#d64545' : '#3e4c59';
                const loopW = 40, loopTop = y, loopBot = y + 26;
                const loopAttrs = {
                    d: 'M ' + x + ' ' + loopTop + ' h ' + loopW + ' v ' + (loopBot - loopTop) + ' h ' + (-loopW + 8),
                    fill: 'none', stroke: color, 'stroke-width': '1.8'
                };
                if (s.dashed) loopAttrs['stroke-dasharray'] = '6 4';
                if (!s.failed) loopAttrs['marker-end'] = s.red ? 'url(#sq-arrow-red)' : 'url(#sq-arrow)';
                // garis keluar ke kanan, turun, lalu balik dengan panah
                svg.appendChild(el('path', loopAttrs));
                if (s.failed) {
                    const cx = x + 8, cy = loopBot, r = 6;
                    svg.appendChild(el('line', { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: color, 'stroke-width': '2.2' }));
                    svg.appendChild(el('line', { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: color, 'stroke-width': '2.2' }));
                }
                const slLines = s.lines && s.lines.length ? s.lines : [s.text];
                const slMidY = (loopTop + loopBot) / 2 + 4 + (slLines.length - 1) * LINE_H / 2;
                svg.appendChild(multiText(x + loopW + 8, slMidY, 'start',
                    s.red ? '#d64545' : '#1f2933', slLines, LINE_H));
            } else {
                const x1 = xOf[s.from], x2 = xOf[s.to];
                if (x1 == null || x2 == null) { y += h; return; }
                const dir = x2 >= x1 ? 1 : -1;
                const color = s.red ? '#d64545' : '#3e4c59';
                const endX = x2 - dir * 8;
                const lineAttrs = { x1: x1, y1: y, x2: endX, y2: y,
                    stroke: color, 'stroke-width': '1.8' };
                if (s.dashed) lineAttrs['stroke-dasharray'] = '6 4';
                // Panah normal hanya bila tidak gagal; kalau gagal, garis berhenti lalu diberi X.
                if (!s.failed) lineAttrs['marker-end'] = s.red ? 'url(#sq-arrow-red)' : 'url(#sq-arrow)';
                svg.appendChild(el('line', lineAttrs));

                if (s.failed) {
                    // tanda X di ujung untuk menandai gagal terkirim
                    const cx = endX, cy = y, r = 6;
                    svg.appendChild(el('line', { x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r,
                        stroke: color, 'stroke-width': '2.2' }));
                    svg.appendChild(el('line', { x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r,
                        stroke: color, 'stroke-width': '2.2' }));
                }

                const msgLines = s.lines && s.lines.length ? s.lines : [s.text];
                svg.appendChild(multiText((x1 + x2) / 2, y - 6, 'middle',
                    s.red ? '#d64545' : '#1f2933', msgLines, LINE_H));
            }
            y += h;
        });

        autoSave();
    }

    // ===== Storage =====
    function autoSave() { try { localStorage.setItem(STORAGE_KEY, input.value); } catch (e) {} }
    function load() { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }

    // ===== Save/Import (JSON) & Export PNG — konsisten dengan mind map =====
    async function saveBlob(defaultName, blob, mime, ext, desc) {
        if (window.showSaveFilePicker) {
            try {
                const h = await window.showSaveFilePicker({ suggestedName: defaultName,
                    types: [{ description: desc, accept: { [mime]: ['.' + ext] } }] });
                const w = await h.createWritable(); await w.write(blob); await w.close(); return;
            } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        let name = prompt('Simpan sebagai (nama file):', defaultName);
        if (name === null) return;
        name = (name.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '_');
        if (!name.toLowerCase().endsWith('.' + ext)) name += '.' + ext;
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function exportJson() {
        const blob = new Blob([JSON.stringify({ text: input.value }, null, 2)], { type: 'application/json' });
        saveBlob('sequence.json', blob, 'application/json', 'json', 'File JSON');
    }
    function exportPng() {
        const clone = svg.cloneNode(true);
        const xml = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.onload = function () {
            const c = document.createElement('canvas');
            c.width = parseInt(svg.getAttribute('width')) || 800;
            c.height = parseInt(svg.getAttribute('height')) || 600;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            c.toBlob(function (blob) { saveBlob('sequence.png', blob, 'image/png', 'png', 'Gambar PNG'); }, 'image/png');
        };
        img.src = url;
    }
    function importFile(file) {
        const r = new FileReader();
        r.onload = function () {
            const txt = String(r.result);
            try {
                if (file.name.toLowerCase().endsWith('.json') || txt.trim().charAt(0) === '{') {
                    const data = JSON.parse(txt);
                    input.value = data.text != null ? data.text : '';
                } else { input.value = txt; }
            } catch (e) { alert('File tidak valid: ' + e.message); return; }
            render();
        };
        r.readAsText(file);
    }

    // ===== Wire up =====
    input.addEventListener('input', render);
    document.getElementById('sq-export-json').addEventListener('click', exportJson);
    document.getElementById('sq-export-png').addEventListener('click', exportPng);
    document.getElementById('sq-import').addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = '';
    });
    document.getElementById('sq-reset').addEventListener('click', function () {
        if (confirm('Reset ke contoh awal?')) { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            input.value = SAMPLE; render(); }
    });

    const saved = load();
    input.value = (saved !== null && saved !== '') ? saved : SAMPLE;
    render();
})();
