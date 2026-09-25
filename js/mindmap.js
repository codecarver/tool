(function () {
    'use strict';

    // ===== Palet warna per level (dipilih yang belum dipakai lebih dulu) =====
    const PALETTE = [
        '#1f6feb', '#1a7f37', '#b7791f', '#9333ea', '#d64545',
        '#0891b2', '#c2410c', '#4f46e5', '#be185d', '#15803d',
        '#0369a1', '#a16207'
    ];
    const levelColor = {};
    function colorForLevel(level) {
        if (levelColor[level]) return levelColor[level];
        const used = new Set(Object.values(levelColor));
        let chosen = PALETTE.find(function (c) { return !used.has(c); });
        if (!chosen) chosen = PALETTE[level % PALETTE.length];
        levelColor[level] = chosen;
        return chosen;
    }

    // ===== Model =====
    let idCounter = 1;
    function newId() { return 'n' + (idCounter++); }
    function makeNode(text, x, y) {
        return { id: newId(), text: text, x: x, y: y, collapsed: false, children: [] };
    }
    function defaultRoot() {
        const r = makeNode('Main Idea', 480, 60);
        r.children.push(makeNode('Branch 1', 240, 220));
        r.children.push(makeNode('Branch 2', 720, 220));
        return r;
    }

    const STORAGE_KEY = 'rtfinance.mindmap.v1';

    let root = defaultRoot();
    let zoom = 1;
    let autoLayout = true; // mode posisi: true = auto rapi, false = manual (drag bebas)
    const elById = {}; // id -> DOM element (untuk mengukur ukuran node saat menggambar garis)

    // ===== Auto-save to localStorage (so work isn't lost) + optional file explorer =====
    let explorer = null;
    function autoSave() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: root, autoLayout: autoLayout }));
        } catch (e) { /* storage full / blocked: ignore */ }
        if (explorer) explorer.markDirty(); // auto-save to the open file too
    }
    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (data && data.root) {
                root = data.root;
                if (typeof data.autoLayout === 'boolean') autoLayout = data.autoLayout;
                return true;
            }
        } catch (e) { /* data rusak: abaikan */ }
        return false;
    }
    function clearStorage() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* abaikan */ }
    }

    // ===== Auto layout radial (kiri-kanan seimbang, mirip mind map umum) =====
    // Root di tengah; anak level-1 dibagi ke kanan & kiri; tiap sisi menjulur horizontal
    // makin jauh tiap turun level, dan disusun vertikal berdasarkan jumlah daun subtree.
    const ROW_H = 84;    // tinggi baris per daun (jarak vertikal antar cabang)
    const COL_W = 280;   // jarak horizontal antar level
    const CENTER_X = 500;
    const CENTER_Y = 400;

    function countLeaves(node) {
        if (node.collapsed || node.children.length === 0) return 1;
        return node.children.reduce(function (s, c) { return s + countLeaves(c); }, 0);
    }

    // Susun satu sisi (dir = +1 kanan, -1 kiri). Mengembalikan tinggi total (jumlah daun).
    // topLeaf = indeks daun teratas (dalam satuan baris) untuk subtree ini.
    const EST_H = 40;    // perkiraan tinggi node untuk konversi pusat -> pojok kiri-atas
    const EST_W = 150;   // perkiraan lebar node
    function layoutSide(node, depth, topLeaf, dir) {
        const leaves = countLeaves(node);
        // pusat vertikal = tengah dari rentang daun subtree
        const cy = CENTER_Y + (topLeaf + leaves / 2 - 0.5) * ROW_H;
        // node.y/node.x adalah pojok kiri-atas, jadi kurangi setengah ukuran perkiraan.
        node.y = cy - EST_H / 2;
        node.x = CENTER_X + dir * depth * COL_W - EST_W / 2;
        if (!node.collapsed && node.children.length > 0) {
            let cursor = topLeaf;
            node.children.forEach(function (c) {
                const w = countLeaves(c);
                layoutSide(c, depth + 1, cursor, dir);
                cursor += w;
            });
        }
        return leaves;
    }

    function layout(root) {
        root.x = CENTER_X - EST_W / 2;
        root.y = CENTER_Y - EST_H / 2;
        const kids = root.collapsed ? [] : root.children;
        // bagi anak level-1: separuh pertama ke kanan, sisanya ke kiri
        const rightCount = Math.ceil(kids.length / 2);
        const rightKids = kids.slice(0, rightCount);
        const leftKids = kids.slice(rightCount);

        // hitung total daun tiap sisi untuk memusatkan secara vertikal
        function totalLeaves(list) { return list.reduce(function (s, c) { return s + countLeaves(c); }, 0); }
        const rTot = totalLeaves(rightKids), lTot = totalLeaves(leftKids);

        // sisi kanan
        let cursor = -rTot / 2;
        rightKids.forEach(function (c) {
            const w = countLeaves(c);
            layoutSide(c, 1, cursor, +1);
            cursor += w;
        });
        // sisi kiri
        cursor = -lTot / 2;
        leftKids.forEach(function (c) {
            const w = countLeaves(c);
            layoutSide(c, 1, cursor, -1);
            cursor += w;
        });

        // Geser semua agar tidak ada koordinat negatif (agar muat di kanvas scroll).
        let minX = Infinity, minY = Infinity;
        forEachVisible(root, function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); });
        const offX = minX < 60 ? (60 - minX) : 0;
        const offY = minY < 60 ? (60 - minY) : 0;
        if (offX || offY) forEachVisible(root, function (n) { n.x += offX; n.y += offY; });
    }

    function applyAutoLayoutIfNeeded() {
        if (autoLayout) layout(root);
    }

    const canvas = document.getElementById('mm-canvas');
    const svg = document.getElementById('mm-svg');
    const nodesLayer = document.getElementById('mm-nodes');
    const stage = document.getElementById('mm-stage');

    function forEachVisible(node, cb) {
        cb(node);
        if (!node.collapsed) node.children.forEach(function (c) { forEachVisible(c, cb); });
    }
    function removeNode(node, id) {
        node.children = node.children.filter(function (c) { return c.id !== id; });
        node.children.forEach(function (c) { removeNode(c, id); });
    }

    // Long-press (touch) -> behave like right-click. For mobile devices.
    function enableLongPress(el, handler) {
        let timer = null, startX = 0, startY = 0, fired = false;
        el.addEventListener('touchstart', function (ev) {
            if (!ev.touches || ev.touches.length !== 1) return;
            const t = ev.touches[0]; startX = t.clientX; startY = t.clientY; fired = false;
            timer = setTimeout(function () {
                fired = true;
                handler({ clientX: startX, clientY: startY, touches: [{ clientX: startX, clientY: startY }],
                    preventDefault: function () {}, stopPropagation: function () {} });
            }, 500);
        }, { passive: true });
        el.addEventListener('touchmove', function (ev) {
            if (!timer) return;
            const t = ev.touches[0];
            if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) { clearTimeout(timer); timer = null; }
        }, { passive: true });
        function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
        el.addEventListener('touchend', function (ev) { if (fired && ev.cancelable) ev.preventDefault(); cancel(); });
        el.addEventListener('touchcancel', cancel);
    }

    // ===== Rendering =====
    function render(focusId) {
        // Simpan posisi scroll agar viewport tidak meloncat saat re-render.
        const savedLeft = canvas.scrollLeft;
        const savedTop = canvas.scrollTop;

        applyAutoLayoutIfNeeded();
        nodesLayer.innerHTML = '';
        for (const k in elById) delete elById[k];
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // defs: panah untuk ujung garis (gaya mind map)
        const NS = 'http://www.w3.org/2000/svg';
        const defs = document.createElementNS(NS, 'defs');
        const marker = document.createElementNS(NS, 'marker');
        marker.setAttribute('id', 'mm-arrow'); marker.setAttribute('markerWidth', '7');
        marker.setAttribute('markerHeight', '7'); marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'userSpaceOnUse');
        const ap = document.createElementNS(NS, 'path');
        ap.setAttribute('d', 'M0,0 L6,3 L0,6 Z'); ap.setAttribute('fill', '#5b6675');
        marker.appendChild(ap); defs.appendChild(marker); svg.appendChild(defs);

        // 1) render node dulu supaya ukurannya bisa diukur
        renderNode(root, 0);
        // 2) baru gambar garis (butuh ukuran node)
        drawConnectors(root);
        resizeStage();

        // Kembalikan posisi scroll semula.
        canvas.scrollLeft = savedLeft;
        canvas.scrollTop = savedTop;

        // Bila diminta, langsung buka editor pada node tertentu (mis. node yang baru dibuat).
        if (focusId && elById[focusId]) {
            const node = findNode(root, focusId);
            if (node) openEditor(node, elById[focusId]);
        }

        // Auto-save setiap render (mencakup semua perubahan: tambah/hapus/edit/pindah/ciutkan).
        autoSave();
    }

    function findNode(node, id) {
        if (node.id === id) return node;
        for (const c of node.children) {
            const f = findNode(c, id);
            if (f) return f;
        }
        return null;
    }

    // Titik pusat node berdasarkan ukuran aktual elemennya.
    function nodeCenter(node) {
        const el = elById[node.id];
        const w = el ? el.offsetWidth : 120;
        const h = el ? el.offsetHeight : 36;
        return { cx: node.x + w / 2, cy: node.y + h / 2, w: w, h: h };
    }

    // Titik potong pada tepi kotak node, di sepanjang garis pusat-ke-pusat menuju (tx,ty).
    function edgePoint(node, tx, ty) {
        const c = nodeCenter(node);
        const dx = tx - c.cx, dy = ty - c.cy;
        if (dx === 0 && dy === 0) return { x: c.cx, y: c.cy };
        const halfW = c.w / 2, halfH = c.h / 2;
        // skala agar titik jatuh tepat di tepi kotak (perbandingan terhadap sisi terdekat)
        const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
        return { x: c.cx + dx * scale, y: c.cy + dy * scale };
    }

    // Bentuk path kurva-S halus (cubic Bézier). Tangen di kedua ujung selalu HORIZONTAL
    // searah cabang (dir), sehingga garis keluar mulus dari sisi induk dan panah masuk
    // horizontal ke sisi anak — rapi untuk layout radial, tanpa loop/garis nyaris nol.
    function connectorPath(start, end, dir) {
        // panjang tonjolan kontrol: proporsional jarak horizontal, minimal 30px.
        const reach = Math.max(30, Math.abs(end.x - start.x) * 0.5);
        const c1x = start.x + dir * reach;
        const c2x = end.x - dir * reach;
        return 'M ' + start.x + ' ' + start.y +
            ' C ' + c1x + ' ' + start.y +
            ' ' + c2x + ' ' + end.y +
            ' ' + end.x + ' ' + end.y;
    }

    // Titik sambung di sisi kiri/kanan node (bukan mengarah ke pusat), agar rapi untuk layout radial.
    // side = +1 -> sisi kanan node, side = -1 -> sisi kiri node.
    function sidePoint(node, side) {
        const c = nodeCenter(node);
        return { x: node.x + (side > 0 ? c.w : 0), y: c.cy };
    }

    function drawConnectors(node) {
        if (node.collapsed) return;
        node.children.forEach(function (c) {
            const pc = nodeCenter(node), cc = nodeCenter(c);
            // arah cabang: anak di kanan induk -> keluar dari sisi kanan induk, masuk sisi kiri anak.
            const dir = cc.cx >= pc.cx ? 1 : -1;
            const start = sidePoint(node, dir);       // sisi induk menghadap anak
            const end = sidePoint(c, -dir);            // sisi anak menghadap induk
            end.x -= dir * 3;                          // sisakan celah kecil agar ujung panah rapi
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', connectorPath(start, end, dir));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#5b6675');
            path.setAttribute('stroke-width', '2.5');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('marker-end', 'url(#mm-arrow)');
            svg.appendChild(path);
            drawConnectors(c);
        });
    }

    function addChild(node) {
        // Tempatkan anak baru ke SAMPING induk sesuai sisinya (kanan/kiri dari root).
        const sideDir = (node === root) ? 1 : (node.x >= root.x ? 1 : -1);
        const cw = (elById[node.id] ? elById[node.id].offsetWidth : 150);
        const childX = sideDir > 0 ? node.x + cw + 120 : node.x - 120 - 60;
        const child = makeNode('New', Math.max(20, childX), node.y);
        node.children.push(child);
        node.collapsed = false;
        render();
    }

    function renderNode(node, level) {
        const el = document.createElement('div');
        el.className = 'mm-node' + (node.done ? ' is-done' : '');
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        const color = colorForLevel(level);
        el.style.borderColor = color;
        el.style.background = hexToTint(color, 0.22);
        el.dataset.id = node.id;

        const label = document.createElement('span');
        label.className = 'mm-label';
        label.textContent = node.text; // textContent + CSS pre-wrap -> newline tampil
        label.title = 'Double-click to edit text. Right-click for menu.';
        label.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            openEditor(node, el);
        });
        el.appendChild(label);

        // Satu badge saja: tombol ciutkan/perluas + indikator progres.
        // - Tanpa anak yang done: tampilkan jumlah total anak (mis. "5").
        // - Bila ada anak yang done: tampilkan "done/total" (mis. "1/5", "5/5").
        if (node.children.length > 0) {
            const total = node.children.length;
            const doneCount = node.children.filter(function (c) { return c.done; }).length;
            const allDone = doneCount > 0 && doneCount === total;
            const count = document.createElement('span');
            count.className = 'mm-count'
                + (node.collapsed ? ' collapsed' : '')
                + (doneCount > 0 ? ' has-done' : '')
                + (allDone ? ' complete' : '');
            let label = doneCount > 0 ? (doneCount + '/' + total) : String(total);
            count.textContent = node.collapsed ? ('+' + label) : label;
            count.title = (doneCount > 0 ? (doneCount + ' of ' + total + ' children done — ') : (total + ' children — '))
                + 'click to ' + (node.collapsed ? 'expand' : 'collapse');
            count.addEventListener('click', function (e) {
                e.stopPropagation(); node.collapsed = !node.collapsed; render();
            });
            el.appendChild(count);
        }

        // Indikator kecil bila node punya deskripsi (titik biru), tanpa tombol.
        if (node.desc && node.desc.trim() !== '') {
            const dot = document.createElement('span');
            dot.className = 'mm-desc-dot';
            dot.title = 'Has a description (right-click to view)';
            el.appendChild(dot);
        }

        // Right-click node: full context menu (add child, text, done, description, collapse, delete).
        function openNodeMenu(e) {
            e.preventDefault(); e.stopPropagation();
            showNodeMenu(e, node, el);
        }
        el.addEventListener('contextmenu', openNodeMenu);
        enableLongPress(el, openNodeMenu); // press-and-hold on touch devices

        if (autoLayout) el.style.cursor = 'default';
        enableDrag(el, node);
        nodesLayer.appendChild(el);
        elById[node.id] = el;

        if (!node.collapsed) node.children.forEach(function (c) { renderNode(c, level + 1); });
    }

    // ===== Menu konteks node (klik kanan) =====
    let nodeMenu = null;
    function closeNodeMenu() {
        if (nodeMenu) { nodeMenu.remove(); nodeMenu = null; }
        document.removeEventListener('click', nodeMenuOutside);
    }
    function nodeMenuOutside(e) {
        if (nodeMenu && nodeMenu.contains(e.target)) return;
        closeNodeMenu();
    }
    function showNodeMenu(ev, node, el) {
        closeNodeMenu();
        const menu = document.createElement('div');
        menu.className = 'dg-menu';
        const t = ev.touches ? ev.touches[0] : ev;
        menu.style.left = (t.clientX + 2) + 'px';
        menu.style.top = (t.clientY + 2) + 'px';
        function item(text, onClick) {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = text;
            b.addEventListener('click', function (e2) {
                e2.stopPropagation(); closeNodeMenu(); onClick();
            });
            menu.appendChild(b);
        }
        item('Add child', function () { addChild(node); });
        item('Edit text', function () { openEditor(node, elById[node.id] || el); });
        item(node.done ? 'Unmark done' : 'Mark as done', function () {
            node.done = !node.done; render();
        });
        const hasDesc = node.desc && node.desc.trim() !== '';
        item(hasDesc ? 'View/edit description' : 'Add description', function () { openDescription(node); });
        if (node.children.length > 0) {
            item(node.collapsed ? 'Expand' : 'Collapse', function () {
                node.collapsed = !node.collapsed; render();
            });
        }
        if (node !== root) {
            item('Delete node (and children)', function () {
                if (confirm('Delete this node and all its children?')) { removeNode(root, node.id); render(); }
            });
        }
        document.body.appendChild(menu);
        nodeMenu = menu;
        // Keep menu within the viewport (important on mobile).
        (function () {
            const r = menu.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            let left = parseFloat(menu.style.left), top = parseFloat(menu.style.top);
            if (left + r.width > vw - 6) left = Math.max(6, vw - r.width - 6);
            if (top + r.height > vh - 6) top = Math.max(6, vh - r.height - 6);
            menu.style.left = left + 'px'; menu.style.top = top + 'px';
        })();
        setTimeout(function () { document.addEventListener('click', nodeMenuOutside); }, 0);
    }

    // Editor multi-baris (textarea overlay)
    function openEditor(node, el) {
        const label = el.querySelector('.mm-label');
        const ta = document.createElement('textarea');
        ta.className = 'mm-editor';
        ta.value = node.text;
        ta.rows = Math.max(2, node.text.split('\n').length);
        label.replaceWith(ta);
        try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
        ta.select();
        let done = false;

        function commit() {
            if (done) return; done = true;
            const v = ta.value.replace(/\s+$/, '');
            node.text = v.trim() === '' ? node.text : v; // kosong -> pertahankan teks lama
            render();
        }
        // Enter = baris baru. Ctrl/Cmd+Enter atau blur = simpan. Esc = batal.
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); done = true; render(); }
        });
        ta.addEventListener('blur', commit);
    }

    // Modal deskripsi: catatan panjang per node. Tidak muncul di gambar utama/ekspor,
    // hanya saat dibuka lewat tombol ini.
    let descOverlay = null;
    function closeDescription() {
        if (descOverlay) { descOverlay.remove(); descOverlay = null; }
        document.removeEventListener('keydown', onDescKey);
    }
    function onDescKey(e) { if (e.key === 'Escape') closeDescription(); }
    function openDescription(node) {
        closeDescription();
        const overlay = document.createElement('div');
        overlay.className = 'mm-modal-overlay';

        const box = document.createElement('div');
        box.className = 'mm-modal';

        const title = document.createElement('div');
        title.className = 'mm-modal-title';
        title.textContent = 'Description — ' + (node.text || '').split('\n')[0];

        const ta = document.createElement('textarea');
        ta.className = 'mm-modal-textarea';
        ta.value = node.desc || '';
        ta.placeholder = 'Write a longer note here. It will not appear in the main image, only here.';

        const actions = document.createElement('div');
        actions.className = 'mm-modal-actions';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-sm'; saveBtn.type = 'button'; saveBtn.textContent = 'Save';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-outline'; cancelBtn.type = 'button'; cancelBtn.textContent = 'Close';

        saveBtn.addEventListener('click', function () {
            node.desc = ta.value;
            autoSave();
            closeDescription();
            render(); // perbarui indikator titik pada tombol catatan
        });
        cancelBtn.addEventListener('click', closeDescription);

        actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
        box.appendChild(title); box.appendChild(ta); box.appendChild(actions);
        overlay.appendChild(box);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDescription(); });
        document.body.appendChild(overlay);
        descOverlay = overlay;
        document.addEventListener('keydown', onDescKey);
        try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    }

    function hexToTint(hex, alpha) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    // ===== Drag (memperhitungkan zoom) =====
    function enableDrag(el, node) {
        let startX, startY, origX, origY, dragging = false;
        function onDown(e) {
            if (e.button && e.button !== 0) return; // abaikan klik kanan/tengah
            if (autoLayout) return; // mode auto: posisi diatur otomatis, drag dimatikan
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
            dragging = true;
            const p = pointer(e);
            startX = p.x; startY = p.y; origX = node.x; origY = node.y;
            el.classList.add('dragging');
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
            e.preventDefault();
        }
        function onMove(e) {
            if (!dragging) return;
            const p = pointer(e);
            node.x = Math.max(0, origX + (p.x - startX) / zoom);
            node.y = Math.max(0, origY + (p.y - startY) / zoom);
            el.style.left = node.x + 'px';
            el.style.top = node.y + 'px';
            redrawConnectorsOnly();
            if (e.cancelable) e.preventDefault();
        }
        function onUp() {
            dragging = false; el.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            resizeStage();
            autoSave(); // simpan posisi baru setelah drag manual
        }
        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
    }
    function pointer(e) {
        const t = e.touches ? e.touches[0] : e;
        return { x: t.clientX, y: t.clientY };
    }
    function redrawConnectorsOnly() {
        // Hapus hanya garis (path/line), pertahankan <defs> (marker panah).
        const paths = svg.querySelectorAll('path, line');
        paths.forEach(function (p) { p.remove(); });
        drawConnectors(root);
    }
    function resizeStage() {
        let maxX = 0, maxY = 0;
        forEachVisible(root, function (n) {
            const c = nodeCenter(n);
            maxX = Math.max(maxX, n.x + c.w + 40);
            maxY = Math.max(maxY, n.y + c.h + 40);
        });
        svg.setAttribute('width', maxX);
        svg.setAttribute('height', maxY);
        stage.style.width = maxX + 'px';
        stage.style.height = maxY + 'px';
    }

    // ===== Zoom =====
    function applyZoom() {
        stage.style.transform = 'scale(' + zoom + ')';
        document.getElementById('mm-zoom-level').textContent = Math.round(zoom * 100) + '%';
    }
    function setZoom(z) { zoom = Math.min(2, Math.max(0.4, z)); applyZoom(); }

    // ===== Save file (pilih nama & lokasi bila browser mendukung File System Access API) =====
    function fallbackDownload(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    async function saveBlob(defaultName, blob, mimeType, extension, pickerTypeDesc) {
        // Browser modern (Chrome/Edge): dialog "Save As" dengan pilih folder & nama.
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [{ description: pickerTypeDesc, accept: { [mimeType]: ['.' + extension] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return; // pengguna membatalkan
                // selain batal -> jatuh ke fallback
            }
        }
        // Fallback: prompt nama, lalu unduh (lokasi mengikuti folder unduhan browser).
        let name = prompt('Save as (file name):', defaultName);
        if (name === null) return;
        name = (name.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '_');
        if (!name.toLowerCase().endsWith('.' + extension)) name += '.' + extension;
        fallbackDownload(name, blob);
    }

    function exportJson() {
        const blob = new Blob([JSON.stringify(root, null, 2)], { type: 'application/json' });
        saveBlob('mindmap.json', blob, 'application/json', 'json', 'JSON file');
    }

    // ===== Export ke gambar (PNG) — digambar manual ke canvas =====
    function measureText(ctx, text, font) {
        ctx.font = font;
        const lines = text.split('\n');
        let maxW = 0;
        lines.forEach(function (l) { maxW = Math.max(maxW, ctx.measureText(l).width); });
        return { lines: lines, width: maxW };
    }

    function exportPng() {
        const PAD = 40;
        const FONT = '14px system-ui, sans-serif';
        const LINE_H = 18;
        const NODE_PAD_X = 12, NODE_PAD_Y = 8;

        // ukur dulu untuk menentukan ukuran kanvas & posisi tepi node
        const tmp = document.createElement('canvas').getContext('2d');
        const geom = {}; // id -> {x,y,w,h,cx,cy,lines,color}
        let maxX = 0, maxY = 0;
        function measureNode(node, level) {
            const m = measureText(tmp, node.text, FONT);
            // PENTING: pakai ukuran node yang SAMA dengan live preview (DOM), bukan hanya lebar teks,
            // agar posisi & titik sambung garis di ekspor identik dengan yang di layar.
            const el = elById[node.id];
            const w = el ? el.offsetWidth : Math.max(60, m.width + NODE_PAD_X * 2);
            const h = el ? el.offsetHeight : (m.lines.length * LINE_H + NODE_PAD_Y * 2);
            geom[node.id] = { x: node.x, y: node.y, w: w, h: h, cx: node.x + w / 2, cy: node.y + h / 2,
                lines: m.lines, color: colorForLevel(level) };
            maxX = Math.max(maxX, node.x + w);
            maxY = Math.max(maxY, node.y + h);
            if (!node.collapsed) node.children.forEach(function (c) { measureNode(c, level + 1); });
        }
        measureNode(root, 0);

        const canvasEl = document.createElement('canvas');
        canvasEl.width = maxX + PAD * 2;
        canvasEl.height = maxY + PAD * 2;
        const ctx = canvasEl.getContext('2d');
        ctx.translate(PAD, PAD);

        // latar putih
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-PAD, -PAD, canvasEl.width, canvasEl.height);

        // garis (dari tepi ke tepi)
        function edgePointG(g, tx, ty) {
            const dx = tx - g.cx, dy = ty - g.cy;
            if (dx === 0 && dy === 0) return { x: g.cx, y: g.cy };
            const scale = 1 / Math.max(Math.abs(dx) / (g.w / 2), Math.abs(dy) / (g.h / 2));
            return { x: g.cx + dx * scale, y: g.cy + dy * scale };
        }
        function drawArrowHead(ctx, x, y, ang, color) {
            const len = 9;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - len * Math.cos(ang - 0.4), y - len * Math.sin(ang - 0.4));
            ctx.lineTo(x - len * Math.cos(ang + 0.4), y - len * Math.sin(ang + 0.4));
            ctx.closePath();
            ctx.fillStyle = color; ctx.fill();
        }
        function sidePointG(g, side) { return { x: g.x + (side > 0 ? g.w : 0), y: g.cy }; }
        function drawLines(node) {
            if (node.collapsed) return;
            const g = geom[node.id];
            node.children.forEach(function (c) {
                const gc = geom[c.id];
                const dir = gc.cx >= g.cx ? 1 : -1;
                const s = sidePointG(g, dir);
                const e = sidePointG(gc, -dir);
                e.x -= dir * 3;
                const reach = Math.max(30, Math.abs(e.x - s.x) * 0.5);
                const c1x = s.x + dir * reach, c2x = e.x - dir * reach;
                ctx.strokeStyle = '#5b6675'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(s.x, s.y);
                ctx.bezierCurveTo(c1x, s.y, c2x, e.y, e.x, e.y);
                ctx.stroke();
                // panah di ujung, mengarah horizontal sesuai cabang
                drawArrowHead(ctx, e.x, e.y, dir > 0 ? 0 : Math.PI, '#5b6675');
                drawLines(c);
            });
        }
        drawLines(root);

        // node
        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }
        function tint(hex, a) {
            const n = parseInt(hex.slice(1), 16);
            return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
        }
        function drawNodes(node) {
            const g = geom[node.id];
            ctx.save();
            if (node.done) ctx.globalAlpha = 0.72; // node selesai tampil lebih redup
            roundRect(g.x, g.y, g.w, g.h, Math.min(16, g.h / 2));
            ctx.fillStyle = tint(g.color, 0.22); ctx.fill();
            ctx.strokeStyle = g.color; ctx.lineWidth = 2; ctx.stroke();
            // Teks di tengah kotak (horizontal & vertikal) — ekspor tidak punya tombol aksi.
            ctx.fillStyle = '#1f2933'; ctx.font = FONT;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const totalH = g.lines.length * LINE_H;
            const startY = g.cy - totalH / 2 + LINE_H / 2;
            g.lines.forEach(function (line, i) {
                const ly = startY + i * LINE_H;
                ctx.fillText(line, g.cx, ly);
                if (node.done) {
                    // garis coret (strikethrough) selebar teks
                    const tw = ctx.measureText(line).width;
                    ctx.strokeStyle = '#1f2933'; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(g.cx - tw / 2, ly); ctx.lineTo(g.cx + tw / 2, ly); ctx.stroke();
                }
            });
            ctx.textAlign = 'left';
            ctx.restore();

            // Satu badge (jumlah anak / progres done) di pojok kanan-atas node.
            if (node.children.length > 0) {
                const total = node.children.length;
                const dc = node.children.filter(function (c) { return c.done; }).length;
                const allDone = dc > 0 && dc === total;
                let label = dc > 0 ? (dc + '/' + total) : String(total);
                if (node.collapsed) label = '+' + label;
                ctx.save();
                ctx.font = 'bold 11px system-ui, sans-serif';
                const tw = ctx.measureText(label).width;
                const bw = Math.max(18, tw + 12), bh = 18;
                const bx = g.x + g.w - bw / 2, by = g.y - bh / 2; // tumpang di sudut kanan-atas
                ctx.beginPath();
                const rr = bh / 2;
                ctx.moveTo(bx + rr, by);
                ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
                ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
                ctx.arcTo(bx, by + bh, bx, by, rr);
                ctx.arcTo(bx, by, bx + bw, by, rr);
                ctx.closePath();
                // Warna: default abu; ada done -> hijau muda; semua done -> hijau solid; collapsed -> biru
                let fill = '#eef2f6', stroke = '#d3dce6', fg = '#52606d';
                if (node.collapsed) { fill = '#1f6feb'; stroke = '#1f6feb'; fg = '#ffffff'; }
                else if (allDone) { fill = '#1a7f37'; stroke = '#1a7f37'; fg = '#ffffff'; }
                else if (dc > 0) { fill = '#e6f4ea'; stroke = '#b7dfc2'; fg = '#1a7f37'; }
                ctx.fillStyle = fill; ctx.fill();
                ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
                ctx.fillStyle = fg;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
                ctx.restore();
            }

            if (!node.collapsed) node.children.forEach(function (c) { drawNodes(c); });
        }
        drawNodes(root);

        canvasEl.toBlob(function (blob) {
            saveBlob('mindmap.png', blob, 'image/png', 'png', 'PNG image');
        }, 'image/png');
    }
    function normalize(node, depth) {
        if (typeof node.x !== 'number' || typeof node.y !== 'number') {
            node.x = 120 + depth * 80;
            node.y = 60 + (window.__mmRow = (window.__mmRow || 0) + 1) * 80;
        }
        if (typeof node.collapsed !== 'boolean') node.collapsed = false;
        if (typeof node.done !== 'boolean') node.done = false;
        if (typeof node.desc !== 'string') node.desc = '';
        if (!node.id) node.id = newId();
        if (!Array.isArray(node.children)) node.children = [];
        node.children.forEach(function (c) { normalize(c, depth + 1); });
        return node;
    }
    function importFile(file) {
        const reader = new FileReader();
        reader.onload = function () {
            let imported = null;
            try { imported = JSON.parse(String(reader.result)); }
            catch (err) { alert('Invalid JSON file: ' + err.message); return; }
            if (!imported || typeof imported !== 'object') { alert('Invalid file.'); return; }
            window.__mmRow = 0;
            root = normalize(imported, 0);
            render();
        };
        reader.readAsText(file);
    }

    // ===== Toolbar =====
    document.getElementById('mm-export-json').addEventListener('click', exportJson);
    document.getElementById('mm-export-png').addEventListener('click', exportPng);
    document.getElementById('mm-import').addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = '';
    });
    document.getElementById('mm-reset').addEventListener('click', function () {
        if (confirm('Reset the mind map to the initial example? Auto-saved data will be cleared.')) {
            clearStorage();
            root = defaultRoot();
            render();
        }
    });
    document.getElementById('mm-zoom-in').addEventListener('click', function () { setZoom(zoom + 0.1); });
    document.getElementById('mm-zoom-out').addEventListener('click', function () { setZoom(zoom - 0.1); });
    document.getElementById('mm-zoom-reset').addEventListener('click', function () { setZoom(1); });

    const modeBtn = document.getElementById('mm-mode');
    function updateModeBtn() {
        modeBtn.textContent = autoLayout ? 'Layout: Auto' : 'Layout: Manual';
        modeBtn.title = autoLayout ? 'Click for Manual mode (free drag)' : 'Click for Auto mode (auto-tidy)';
    }
    modeBtn.addEventListener('click', function () {
        autoLayout = !autoLayout;
        updateModeBtn();
        render(); // saat beralih ke Auto, langsung dirapikan
    });
    // ===== Geser panel (pan) dengan Ctrl + seret mouse =====
    (function enablePan() {
        let panning = false, sx = 0, sy = 0, sl = 0, st = 0;
        function down(e) {
            if (!(e.ctrlKey || e.metaKey)) return;   // hanya saat Ctrl (atau Cmd) ditekan
            panning = true;
            const p = e.touches ? e.touches[0] : e;
            sx = p.clientX; sy = p.clientY;
            sl = canvas.scrollLeft; st = canvas.scrollTop;
            canvas.classList.add('dg-panning');
            e.preventDefault();
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        }
        function move(e) {
            if (!panning) return;
            const p = e.touches ? e.touches[0] : e;
            canvas.scrollLeft = sl - (p.clientX - sx);
            canvas.scrollTop = st - (p.clientY - sy);
            e.preventDefault();
        }
        function up() {
            panning = false;
            canvas.classList.remove('dg-panning');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        }
        // capture=true agar pan menang atas drag node ketika Ctrl ditekan
        canvas.addEventListener('mousedown', down, true);
    })();

    // Cegah menu konteks bawaan browser di kanvas (kita pakai menu klik kanan sendiri).
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ===== Local-folder explorer (optional) =====
    if (window.createFsExplorer && document.getElementById('mm-tree')) {
        explorer = window.createFsExplorer({
            ids: { tree: 'mm-tree', folderName: 'mm-folder-name', hint: 'mm-fs-hint', status: 'mm-fs-status',
                open: 'mm-open-folder', up: 'mm-up', newFile: 'mm-new-file', refresh: 'mm-refresh' },
            ext: 'json',
            accept: /\.(json)$/i,
            getContent: function () { return JSON.stringify(root, null, 2); },
            setContent: function (text) {
                try {
                    const data = JSON.parse(text);
                    const r = (data && data.root) ? data.root : data; // support {root:..} or bare root
                    window.__mmRow = 0;
                    root = normalize(r, 0);
                    render();
                } catch (e) { alert('Invalid JSON file: ' + e.message); }
            },
            newContent: function () { return JSON.stringify(defaultRoot(), null, 2); }
        });
    }

    // Muat mind map terakhir dari localStorage bila ada (agar tidak hilang saat lupa simpan).
    loadFromStorage();
    updateModeBtn();

    applyZoom();
    render();
})();
