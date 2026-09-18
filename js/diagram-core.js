// Editor diagram generik berbasis node + edge (dipakai Flow & Free diagram).
// Fitur: tambah node (pilih bentuk), drag, hubungkan dengan panah, edit teks,
// hapus, zoom, export PNG/JSON, import JSON, auto-save ke localStorage.
window.createDiagram = function (opts) {
    'use strict';
    const storageKey = opts.storageKey;
    const shapes = opts.shapes;          // daftar bentuk yang tersedia
    const defaultShape = opts.defaultShape;
    const sample = opts.sample;          // {nodes, edges}

    const canvas = document.getElementById(opts.canvasId);
    const svg = document.getElementById(opts.svgId);
    const nodesLayer = document.getElementById(opts.nodesId);
    const stage = document.getElementById(opts.stageId);

    let model = { nodes: [], edges: [] };
    let zoom = 1;
    let connectFrom = null; // id node sumber saat mode hubungkan
    let idc = 1;
    let gidc = 1;                       // penghitung id grup
    const selection = new Set();        // id node yang sedang dipilih (multi-select)
    function gid() { return 'g' + (gidc++); }
    function isSelected(id) { return selection.has(id); }
    function clearSelection() { selection.clear(); refreshSelectionStyles(); }
    function refreshSelectionStyles() {
        for (const id in elById) {
            if (elById[id]) elById[id].classList.toggle('selected', selection.has(id));
        }
    }
    // Semua id node dalam grup yang sama dengan node tertentu (atau hanya dirinya bila tak bergrup).
    function groupMembers(node) {
        if (!node.group) return [node.id];
        return model.nodes.filter(function (n) { return n.group === node.group; }).map(function (n) { return n.id; });
    }
    const nid = function () { return 'x' + (idc++); };
    const elById = {};

    function bumpCounters() {
        (model.nodes || []).forEach(function (n) {
            const num = parseInt(String(n.id).replace(/\D/g, ''), 10);
            if (!isNaN(num) && num >= idc) idc = num + 1;
            if (n.group) {
                const gn = parseInt(String(n.group).replace(/\D/g, ''), 10);
                if (!isNaN(gn) && gn >= gidc) gidc = gn + 1;
            }
        });
    }
    function seed() {
        model = JSON.parse(JSON.stringify(sample));
        bumpCounters();
    }

    // ===== storage =====
    function save() { try { localStorage.setItem(storageKey, JSON.stringify({ model: model })); } catch (e) {} }
    function loadStored() {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return false;
            const d = JSON.parse(raw);
            if (d && d.model && Array.isArray(d.model.nodes)) { model = d.model; bumpCounters(); return true; }
        } catch (e) {}
        return false;
    }

    function findNode(id) { return model.nodes.find(function (n) { return n.id === id; }); }

    // ===== render =====
    function render() {
        const sl = canvas.scrollLeft, st = canvas.scrollTop;
        nodesLayer.innerHTML = '';
        for (const k in elById) delete elById[k];
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // defs arrow
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'dg-arrow'); marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10'); marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3'); marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        const ap = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        ap.setAttribute('d', 'M0,0 L8,3 L0,6 Z'); ap.setAttribute('fill', '#3e4c59');
        marker.appendChild(ap); defs.appendChild(marker); svg.appendChild(defs);

        model.nodes.forEach(renderNode);
        model.edges.forEach(drawEdge);
        resize();

        canvas.scrollLeft = sl; canvas.scrollTop = st;
        save();
    }

    function nodeGeom(node) {
        const el = elById[node.id];
        // Bila node punya ukuran eksplisit (hasil resize), pakai itu; jika tidak, ukur dari DOM.
        const w = (typeof node.w === 'number') ? node.w : (el ? el.offsetWidth : 120);
        const h = (typeof node.h === 'number') ? node.h : (el ? el.offsetHeight : 44);
        return { x: node.x, y: node.y, w: w, h: h, cx: node.x + w / 2, cy: node.y + h / 2 };
    }
    function edgePoint(g, tx, ty) {
        const dx = tx - g.cx, dy = ty - g.cy;
        if (dx === 0 && dy === 0) return { x: g.cx, y: g.cy };
        const s = 1 / Math.max(Math.abs(dx) / (g.w / 2), Math.abs(dy) / (g.h / 2));
        return { x: g.cx + dx * s, y: g.cy + dy * s };
    }
    // Pecah teks menjadi baris agar muat dalam lebar maxW (word-wrap), menghormati \n eksplisit.
    function wrapText(ctx, text, maxW) {
        const out = [];
        String(text).split('\n').forEach(function (segment) {
            const words = segment.split(/\s+/).filter(function (w) { return w.length; });
            if (words.length === 0) { out.push(''); return; }
            let line = words[0];
            for (let i = 1; i < words.length; i++) {
                const test = line + ' ' + words[i];
                if (ctx.measureText(test).width <= maxW) { line = test; }
                else { out.push(line); line = words[i]; }
            }
            out.push(line);
        });
        return out;
    }
    const SVGNS = 'http://www.w3.org/2000/svg';

    let openMenu = null;
    function closeEdgeMenu() {
        if (openMenu) { openMenu.remove(); openMenu = null; }
        document.removeEventListener('click', outsideClose);
    }
    // Geser menu agar tidak keluar layar (penting di mobile).
    function clampMenu(menu) {
        const r = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        let left = parseFloat(menu.style.left), top = parseFloat(menu.style.top);
        if (left + r.width > vw - 6) left = Math.max(6, vw - r.width - 6);
        if (top + r.height > vh - 6) top = Math.max(6, vh - r.height - 6);
        menu.style.left = left + 'px'; menu.style.top = top + 'px';
    }

    // Long-press (touch) -> panggil handler seperti klik kanan. Untuk perangkat mobile.
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
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
        // cegah drag mulai jika long-press sudah memicu menu
        el.addEventListener('touchend', function (ev) { if (fired && ev.cancelable) ev.preventDefault(); });
    }

    // Palet warna umum untuk latar node.
    const FILL_COLORS = [
        { name: 'White', v: '#ffffff' },
        { name: 'Blue', v: '#cfe4ff' },
        { name: 'Green', v: '#cdefd6' },
        { name: 'Yellow', v: '#fdf2c4' },
        { name: 'Red', v: '#f8cfcf' },
        { name: 'Purple', v: '#e6d6fb' },
        { name: 'Orange', v: '#ffdfc2' },
        { name: 'Gray', v: '#e4e7eb' }
    ];
    // Menu konteks node (klik kanan). Berisi aksi + baris pilihan warna (bila allowFill).
    function showNodeMenu(ev, node, actions) {
        closeEdgeMenu();
        const menu = document.createElement('div');
        menu.className = 'dg-menu';
        const t = ev.touches ? ev.touches[0] : ev;
        menu.style.left = (t.clientX + 2) + 'px';
        menu.style.top = (t.clientY + 2) + 'px';

        function item(text, onClick) {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = text;
            b.addEventListener('click', function (e2) {
                e2.stopPropagation(); closeEdgeMenu(); onClick();
            });
            menu.appendChild(b);
        }
        item('Edit text', actions.editText);
        item('Connect arrow to another node', actions.startLink);

        // Grup / lepas grup. Butuh minimal 2 node (pilihan aktif + node ini) untuk membuat grup.
        const selIds = new Set(selection); selIds.add(node.id);
        if (selIds.size >= 2) {
            item('Group selected nodes (' + selIds.size + ')', function () {
                const g = gid();
                selIds.forEach(function (id) { const n = findNode(id); if (n) n.group = g; });
                clearSelection(); render();
            });
        }
        if (node.group) {
            item('Ungroup', function () {
                const g = node.group;
                model.nodes.forEach(function (n) { if (n.group === g) delete n.group; });
                render();
            });
        }

        if (opts.allowFill) {
            // Baris swatch warna.
            const row = document.createElement('div');
            row.className = 'dg-swatch-row';
            FILL_COLORS.forEach(function (c) {
                const sw = document.createElement('button');
                sw.type = 'button'; sw.className = 'dg-swatch-btn'; sw.title = c.name;
                sw.style.background = c.v;
                sw.addEventListener('click', function (e2) {
                    e2.stopPropagation(); closeEdgeMenu();
                    node.fill = c.v; render();
                });
                row.appendChild(sw);
            });
            menu.appendChild(row);
        }

        item('Delete node', function () {
            if (confirm('Delete this node and its connected arrows?')) actions.doDelete();
        });

        document.body.appendChild(menu);
        openMenu = menu;
        clampMenu(menu);
        setTimeout(function () { document.addEventListener('click', outsideClose); }, 0);
    }

    // Tutup menu bila klik di luar area menu (bukan pada tombol menu itu sendiri).
    function outsideClose(e) {
        if (openMenu && openMenu.contains(e.target)) return; // klik di dalam menu: abaikan
        document.removeEventListener('click', outsideClose);
        closeEdgeMenu();
    }

    // Menu dropdown kecil untuk aksi pada garis (edge).
    function showEdgeMenu(ev, edge, editLabel) {
        closeEdgeMenu();
        const menu = document.createElement('div');
        menu.className = 'dg-menu';
        const t = ev.touches ? ev.touches[0] : ev;
        menu.style.left = (t.clientX + 2) + 'px';
        menu.style.top = (t.clientY + 2) + 'px';

        function item(text, onClick) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.addEventListener('click', function (e2) {
                e2.stopPropagation(); closeEdgeMenu(); onClick();
            });
            menu.appendChild(b);
        }
        item('Edit label', editLabel);
        const hasBend = typeof edge.wx === 'number';
        item(hasBend ? 'Straighten' : 'Bend (middle)', function () {
            if (hasBend) { delete edge.wx; delete edge.wy; }
            else {
                const a = findNode(edge.from), b = findNode(edge.to);
                if (a && b) {
                    const ga = nodeGeom(a), gb = nodeGeom(b);
                    edge.wx = (ga.cx + gb.cx) / 2; edge.wy = (ga.cy + gb.cy) / 2 - 40;
                }
            }
            render();
        });
        // Gaya garis: lengkung (default) atau siku/step (orthogonal). Toggle bolak-balik.
        const isElbow = edge.style === 'elbow';
        item(isElbow ? 'Style: make Curved' : 'Style: make Elbow (step)', function () {
            edge.style = isElbow ? 'curve' : 'elbow';
            render();
        });
        item('Delete arrow', function () {
            model.edges = model.edges.filter(function (x) { return x !== edge; });
            render();
        });
        document.body.appendChild(menu);
        openMenu = menu;
        clampMenu(menu);
        // tutup saat klik di luar (abaikan klik di dalam menu)
        setTimeout(function () { document.addEventListener('click', outsideClose); }, 0);
    }

    // Bangun path "siku" (orthogonal step) antara dua node.
    // Bila ada waypoint (via), belokan melewati titik itu; jika tidak, belok di tengah.
    function elbowPath(ga, gb, via) {
        // titik keluar/masuk di sisi node, arah horizontal atau vertikal dominan
        const dxc = gb.cx - ga.cx, dyc = gb.cy - ga.cy;
        const horizontal = Math.abs(dxc) >= Math.abs(dyc);
        let s, t, midX, midY, d;
        if (horizontal) {
            const dir = dxc >= 0 ? 1 : -1;
            s = { x: ga.cx + dir * ga.w / 2, y: ga.cy };
            t = { x: gb.cx - dir * gb.w / 2, y: gb.cy };
            midX = via ? via.x : (s.x + t.x) / 2;
            d = 'M ' + s.x + ' ' + s.y + ' L ' + midX + ' ' + s.y +
                ' L ' + midX + ' ' + t.y + ' L ' + t.x + ' ' + t.y;
        } else {
            const dir = dyc >= 0 ? 1 : -1;
            s = { x: ga.cx, y: ga.cy + dir * ga.h / 2 };
            t = { x: gb.cx, y: gb.cy - dir * gb.h / 2 };
            midY = via ? via.y : (s.y + t.y) / 2;
            d = 'M ' + s.x + ' ' + s.y + ' L ' + s.x + ' ' + midY +
                ' L ' + t.x + ' ' + midY + ' L ' + t.x + ' ' + t.y;
        }
        return { d: d, s: s, t: t, mid: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } };
    }

    function drawEdge(e) {
        const a = findNode(e.from), b = findNode(e.to);
        if (!a || !b) return;
        const ga = nodeGeom(a), gb = nodeGeom(b);

        // Titik belok opsional (waypoint). Bila ada, garis melewati titik ini (bentuk L/siku).
        const via = (typeof e.wx === 'number' && typeof e.wy === 'number') ? { x: e.wx, y: e.wy } : null;
        const elbow = e.style === 'elbow';

        let s, t, d;
        if (elbow) {
            const ep = elbowPath(ga, gb, via);
            s = ep.s; t = ep.t; d = ep.d;
        } else {
            // Titik ujung dihitung mengarah ke titik berikutnya (via bila ada, jika tidak ke pusat lawan).
            s = edgePoint(ga, via ? via.x : gb.cx, via ? via.y : gb.cy);
            t = edgePoint(gb, via ? via.x : ga.cx, via ? via.y : ga.cy);
            // Path: lurus bila tanpa waypoint, kurva quadratic halus bila ada waypoint.
            d = via
                ? 'M ' + s.x + ' ' + s.y + ' Q ' + via.x + ' ' + via.y + ' ' + t.x + ' ' + t.y
                : 'M ' + s.x + ' ' + s.y + ' L ' + t.x + ' ' + t.y;
        }

        const g = document.createElementNS(SVGNS, 'g');

        // garis terlihat
        const poly = document.createElementNS(SVGNS, 'path');
        poly.setAttribute('d', d);
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', '#3e4c59'); poly.setAttribute('stroke-width', '2');
        poly.setAttribute('marker-end', 'url(#dg-arrow)');

        // hit-area lebar untuk klik/hover
        const hit = document.createElementNS(SVGNS, 'path');
        hit.setAttribute('d', d);
        hit.setAttribute('fill', 'none');
        hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '16');
        hit.style.cursor = 'pointer';

        g.appendChild(hit);
        g.appendChild(poly);

        // Titik tengah kurva yang sebenarnya. Untuk kurva quadratic (M s Q via t),
        // titik pada t=0.5 adalah 0.25*s + 0.5*via + 0.25*t (bukan di titik kontrol via).
        // Dengan ini label & handle selalu menempel di garis yang terlihat.
        const curveMid = elbow
            ? { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }
            : (via
                ? { x: 0.25 * s.x + 0.5 * via.x + 0.25 * t.x, y: 0.25 * s.y + 0.5 * via.y + 0.25 * t.y }
                : { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 });

        // label garis (opsional) — ukuran latar diperkirakan dari panjang teks (hindari getBBox)
        if (e.label) {
            const mid = curveMid;
            const w = e.label.length * 7 + 8;
            const bg = document.createElementNS(SVGNS, 'rect');
            bg.setAttribute('x', mid.x - w / 2); bg.setAttribute('y', mid.y - 20);
            bg.setAttribute('width', w); bg.setAttribute('height', 16);
            bg.setAttribute('fill', '#ffffff'); bg.setAttribute('opacity', '0.85'); bg.setAttribute('rx', '3');
            const textEl = document.createElementNS(SVGNS, 'text');
            textEl.setAttribute('x', mid.x); textEl.setAttribute('y', mid.y - 8);
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('font-size', '12'); textEl.setAttribute('fill', '#1f2933');
            textEl.textContent = e.label;
            g.appendChild(bg);
            g.appendChild(textEl);
        }

        function onHoverIn() { poly.setAttribute('stroke', '#d64545'); }
        function onHoverOut() { poly.setAttribute('stroke', '#3e4c59'); }
        g.addEventListener('mouseenter', onHoverIn);
        g.addEventListener('mouseleave', onHoverOut);

        function editLabel() {
            const lbl = prompt('Line label:', e.label || '');
            if (lbl !== null) { e.label = lbl.trim(); render(); }
        }

        // Klik dua kali garis: langsung edit label.
        hit.addEventListener('dblclick', function (ev) { ev.stopPropagation(); editLabel(); });

        // Klik kanan garis: tampilkan menu (keterangan/belokkan/hapus).
        function openEdgeMenu(ev) {
            ev.preventDefault(); ev.stopPropagation();
            showEdgeMenu(ev, e, editLabel);
        }
        hit.addEventListener('contextmenu', openEdgeMenu);
        enableLongPress(hit, openEdgeMenu); // tekan-tahan di layar sentuh

        // Handle untuk membelokkan garis (drag titik tengah). Handle selalu menempel di garis (curveMid).
        const handlePos = curveMid;
        const handle = document.createElementNS(SVGNS, 'circle');
        handle.setAttribute('cx', handlePos.x); handle.setAttribute('cy', handlePos.y);
        handle.setAttribute('r', '6');
        handle.setAttribute('fill', '#fff'); handle.setAttribute('stroke', '#1f6feb');
        handle.setAttribute('stroke-width', '2');
        handle.style.cursor = 'move';
        handle.setAttribute('class', 'dg-edge-handle');
        enableWaypointDrag(handle, e);
        g.appendChild(handle);

        svg.appendChild(g);
    }

    // Drag handle untuk mengeset titik belok (waypoint) edge.
    function enableWaypointDrag(handle, edge) {
        let dragging = false;
        function down(ev) {
            ev.stopPropagation(); ev.preventDefault();
            dragging = true;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
        }
        function move(ev) {
            if (!dragging) return;
            const p = svgPoint(ev);
            // Titik kontrol = posisi pointer langsung. Kurva selalu melengkung ke arah pointer
            // dengan lengkung yang wajar (tidak overshoot). Handle akan digambar ulang di titik
            // tengah kurva sehingga tetap menempel di garis.
            edge.wx = Math.max(0, p.x);
            edge.wy = Math.max(0, p.y);
            redrawEdges();
            if (ev.cancelable) ev.preventDefault();
        }
        function up() {
            dragging = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', up);
            save();
        }
        handle.addEventListener('mousedown', down);
        handle.addEventListener('touchstart', down, { passive: false });
    }

    // Konversi koordinat pointer -> koordinat dalam SVG (memperhitungkan scroll & zoom).
    function svgPoint(ev) {
        const t = ev.touches ? ev.touches[0] : ev;
        const rect = svg.getBoundingClientRect();
        return { x: (t.clientX - rect.left) / zoom, y: (t.clientY - rect.top) / zoom };
    }

    function renderNode(node) {
        const shape = node.shape || defaultShape;
        const el = document.createElement('div');
        el.className = 'dg-node dg-' + shape
            + (node.group ? ' grouped' : '')
            + (selection.has(node.id) ? ' selected' : '');
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        // Ukuran eksplisit bila node pernah di-resize.
        if (typeof node.w === 'number') el.style.width = node.w + 'px';
        if (typeof node.h === 'number') el.style.height = node.h + 'px';
        // Warna latar kustom (bila dipilih). Diamond memakai lapisan ::before, jadi pakai CSS var.
        if (node.fill) {
            if (shape === 'diamond') el.style.setProperty('--dg-fill', node.fill);
            else el.style.background = node.fill;
        }
        el.dataset.id = node.id;

        const label = document.createElement('span');
        label.className = 'dg-label';
        label.textContent = node.text;
        label.title = 'Double-click to edit text. Right-click for menu.';
        el.appendChild(label);

        function editText() {
            const t = prompt('Node text (use \\n for line breaks):', node.text);
            if (t !== null) { node.text = t.replace(/\\n/g, '\n'); render(); }
        }
        function startLink() {
            connectFrom = node.id;
            const prev = nodesLayer.querySelector('.linking');
            if (prev) prev.classList.remove('linking');
            el.classList.add('linking');
            canvas.classList.add('dg-linking');
        }
        function doDelete() {
            model.nodes = model.nodes.filter(function (n) { return n.id !== node.id; });
            model.edges = model.edges.filter(function (e) { return e.from !== node.id && e.to !== node.id; });
            render();
        }

        // Klik dua kali: ubah teks.
        label.addEventListener('dblclick', function (ev) { ev.stopPropagation(); editText(); });
        // Klik kanan node: menu konteks (ubah teks / hubungkan / warna / hapus).
        function openNodeMenu(ev) {
            ev.preventDefault(); ev.stopPropagation();
            showNodeMenu(ev, node, { editText: editText, startLink: startLink, doDelete: doDelete });
        }
        el.addEventListener('contextmenu', openNodeMenu);
        enableLongPress(el, openNodeMenu); // tekan-tahan di layar sentuh

        // Handle resize di pojok kanan-bawah.
        const rz = document.createElement('div');
        rz.className = 'dg-resize';
        rz.title = 'Resize';
        enableResize(rz, el, node);
        el.appendChild(rz);

        enableDrag(el, node);
        nodesLayer.appendChild(el);
        elById[node.id] = el;
    }

    function enableResize(handle, el, node) {
        let sx, sy, ow, oh, resizing = false;
        const MIN_W = 60, MIN_H = 36;
        function down(e) {
            e.stopPropagation();
            e.preventDefault();
            resizing = true;
            const p = pt(e);
            sx = p.x; sy = p.y;
            // ukuran awal: dari node.w/h bila ada, jika tidak dari DOM saat ini
            ow = (typeof node.w === 'number') ? node.w : el.offsetWidth;
            oh = (typeof node.h === 'number') ? node.h : el.offsetHeight;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
        }
        function move(e) {
            if (!resizing) return;
            const p = pt(e);
            node.w = Math.max(MIN_W, ow + (p.x - sx) / zoom);
            node.h = Math.max(MIN_H, oh + (p.y - sy) / zoom);
            el.style.width = node.w + 'px';
            el.style.height = node.h + 'px';
            redrawEdges();
            if (e.cancelable) e.preventDefault();
        }
        function up() {
            resizing = false;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', up);
            save();
        }
        handle.addEventListener('mousedown', down);
        handle.addEventListener('touchstart', down, { passive: false });
    }

    function enableDrag(el, node) {
        let sx, sy, dragging = false, movers = [];
        function down(e) {
            if (e.button && e.button !== 0) return; // abaikan klik kanan/tengah
            if (e.target.tagName === 'BUTTON') return;
            if (e.ctrlKey || e.metaKey) return; // Ctrl+seret = pan kanvas (ditangani terpisah)
            // Sedang mode hubungkan: node ini menjadi tujuan panah.
            if (connectFrom) {
                if (connectFrom !== node.id) {
                    model.edges.push({ from: connectFrom, to: node.id });
                }
                connectFrom = null;
                canvas.classList.remove('dg-linking');
                render();
                e.preventDefault();
                return;
            }
            // Shift+klik: tambah/kurangi node ke pilihan (multi-select) tanpa menyeret.
            if (e.shiftKey) {
                if (selection.has(node.id)) selection.delete(node.id); else selection.add(node.id);
                refreshSelectionStyles();
                e.preventDefault();
                return;
            }
            dragging = true;
            const p = pt(e); sx = p.x; sy = p.y;
            // Tentukan node mana saja yang ikut bergerak:
            //  - anggota grup node ini, digabung dengan seluruh pilihan aktif (bila node termasuk pilihan).
            const ids = new Set(groupMembers(node));
            if (selection.has(node.id)) selection.forEach(function (id) {
                const nn = findNode(id); if (nn) groupMembers(nn).forEach(function (g) { ids.add(g); });
            });
            movers = [];
            ids.forEach(function (id) {
                const nn = findNode(id); if (nn) movers.push({ n: nn, ox: nn.x, oy: nn.y, el: elById[id] });
            });
            el.classList.add('dragging');
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up);
            e.preventDefault();
        }
        function move(e) {
            if (!dragging) return;
            const p = pt(e);
            const dx = (p.x - sx) / zoom, dy = (p.y - sy) / zoom;
            movers.forEach(function (m) {
                m.n.x = Math.max(0, m.ox + dx);
                m.n.y = Math.max(0, m.oy + dy);
                if (m.el) { m.el.style.left = m.n.x + 'px'; m.el.style.top = m.n.y + 'px'; }
            });
            redrawEdges();
            if (e.cancelable) e.preventDefault();
        }
        function up() {
            dragging = false; el.classList.remove('dragging');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', up);
            resize(); save();
        }
        el.addEventListener('mousedown', down);
        el.addEventListener('touchstart', down, { passive: false });
    }
    function pt(e) { const t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
    function redrawEdges() {
        // buang grup edge (bukan defs), lalu gambar ulang
        const groups = svg.querySelectorAll('g');
        groups.forEach(function (gp) { gp.remove(); });
        // pastikan kanvas cukup besar saat garis dibelokkan jauh (mis. sedang di-drag)
        resize();
        model.edges.forEach(drawEdge);
    }
    function resize() {
        let mx = 400, my = 300;
        model.nodes.forEach(function (n) { const g = nodeGeom(n); mx = Math.max(mx, n.x + g.w + 60); my = Math.max(my, n.y + g.h + 60); });
        // Perhitungkan titik kontrol/belok garis agar kanvas ikut membesar dan kurva tidak terpotong.
        model.edges.forEach(function (e) {
            if (typeof e.wx === 'number' && typeof e.wy === 'number') {
                mx = Math.max(mx, e.wx + 60); my = Math.max(my, e.wy + 60);
            }
        });
        svg.setAttribute('width', mx); svg.setAttribute('height', my);
        stage.style.width = mx + 'px'; stage.style.height = my + 'px';
    }

    // ===== zoom =====
    function applyZoom() { stage.style.transform = 'scale(' + zoom + ')';
        document.getElementById(opts.zoomLevelId).textContent = Math.round(zoom * 100) + '%'; }
    function setZoom(z) { zoom = Math.min(2, Math.max(0.4, z)); applyZoom(); }

    // ===== add node =====
    function addNode(shape) {
        const sh = shape || defaultShape;
        const n = { id: nid(), text: sh === 'text' ? 'Text' : 'Node', shape: sh,
            x: 60 + (model.nodes.length % 5) * 40, y: 60 + (model.nodes.length % 5) * 40 };
        model.nodes.push(n);
        render();
    }

    // ===== save/import/export =====
    async function saveBlob(defaultName, blob, mime, ext, desc) {
        if (window.showSaveFilePicker) {
            try {
                const h = await window.showSaveFilePicker({ suggestedName: defaultName,
                    types: [{ description: desc, accept: { [mime]: ['.' + ext] } }] });
                const w = await h.createWritable(); await w.write(blob); await w.close(); return;
            } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        let name = prompt('Save as (file name):', defaultName);
        if (name === null) return;
        name = (name.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '_');
        if (!name.toLowerCase().endsWith('.' + ext)) name += '.' + ext;
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }
    function exportJson() {
        const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
        saveBlob(opts.fileBase + '.json', blob, 'application/json', 'json', 'JSON file');
    }
    function exportPng() {
        const clone = svg.cloneNode(true);
        // gambar node ke SVG clone (karena node adalah HTML, kita gambar manual ke canvas)
        const c = document.createElement('canvas');
        const w = parseInt(svg.getAttribute('width')) || 800, h = parseInt(svg.getAttribute('height')) || 600;
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        // edges (dengan titik belok/waypoint & label)
        ctx.lineWidth = 2;
        model.edges.forEach(function (e) {
            const a = findNode(e.from), b = findNode(e.to); if (!a || !b) return;
            const ga = nodeGeom(a), gb = nodeGeom(b);
            const via = (typeof e.wx === 'number' && typeof e.wy === 'number') ? { x: e.wx, y: e.wy } : null;
            const elbow = e.style === 'elbow';
            let s, t, prevForArrow, mid;
            ctx.strokeStyle = '#3e4c59';
            if (elbow) {
                const ep = elbowPath(ga, gb, via);
                s = ep.s; t = ep.t; mid = ep.mid;
                // gambar path siku dari string d: parse titik-titiknya
                const pts = ep.d.match(/-?\d+(\.\d+)?/g).map(Number);
                ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
                for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
                ctx.stroke();
                // arah panah = dari titik kedua-terakhir ke terakhir
                const n = pts.length;
                prevForArrow = { x: pts[n - 4], y: pts[n - 3] };
            } else {
                s = edgePoint(ga, via ? via.x : gb.cx, via ? via.y : gb.cy);
                t = edgePoint(gb, via ? via.x : ga.cx, via ? via.y : ga.cy);
                ctx.beginPath(); ctx.moveTo(s.x, s.y);
                if (via) ctx.quadraticCurveTo(via.x, via.y, t.x, t.y);
                else ctx.lineTo(t.x, t.y);
                ctx.stroke();
                prevForArrow = via ? via : s;
                mid = via
                    ? { x: 0.25 * s.x + 0.5 * via.x + 0.25 * t.x, y: 0.25 * s.y + 0.5 * via.y + 0.25 * t.y }
                    : { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
            }
            // panah di ujung
            const ang = Math.atan2(t.y - prevForArrow.y, t.x - prevForArrow.x);
            ctx.beginPath(); ctx.moveTo(t.x, t.y);
            ctx.lineTo(t.x - 10 * Math.cos(ang - 0.4), t.y - 10 * Math.sin(ang - 0.4));
            ctx.lineTo(t.x - 10 * Math.cos(ang + 0.4), t.y - 10 * Math.sin(ang + 0.4));
            ctx.closePath(); ctx.fillStyle = '#3e4c59'; ctx.fill();
            // label
            if (e.label) {
                ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                const w = ctx.measureText(e.label).width;
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.fillRect(mid.x - w / 2 - 3, mid.y - 20, w + 6, 16);
                ctx.fillStyle = '#1f2933';
                ctx.fillText(e.label, mid.x, mid.y - 8);
            }
        });
        // nodes
        model.nodes.forEach(function (n) {
            const g = nodeGeom(n);
            ctx.fillStyle = n.fill || '#eef3ff'; ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 2;
            const shape = n.shape || defaultShape;
            const x = g.x, y = g.y, w = g.w, h = g.h, cx = g.cx, cy = g.cy;
            if (shape === 'text') {
                // Label teks bebas: tanpa kotak/border, hanya tulisan (bisa multi-baris).
                ctx.fillStyle = '#1f2933'; ctx.font = '14px system-ui, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const lines = String(n.text).split('\n');
                const lh = 18, startY = cy - (lines.length - 1) * lh / 2;
                lines.forEach(function (ln, i) { ctx.fillText(ln, cx, startY + i * lh); });
                return;
            }
            if (shape === 'ellipse') {
                ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            } else if (shape === 'diamond') {
                ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(x + w, cy);
                ctx.lineTo(cx, y + h); ctx.lineTo(x, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (shape === 'terminator') {
                const r = h / 2;
                ctx.beginPath();
                ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
                ctx.arc(x + w - r, cy, r, -Math.PI / 2, Math.PI / 2);
                ctx.lineTo(x + r, y + h); ctx.arc(x + r, cy, r, Math.PI / 2, -Math.PI / 2);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (shape === 'io') {
                const off = h * 0.35;
                ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + w, y);
                ctx.lineTo(x + w - off, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (shape === 'doc') {
                const wave = h * 0.18;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - wave);
                ctx.quadraticCurveTo(x + w * 0.75, y + h + wave, x + w / 2, y + h - wave);
                ctx.quadraticCurveTo(x + w * 0.25, y + h - 2 * wave, x, y + h - wave);
                ctx.closePath(); ctx.fill(); ctx.stroke();
            } else if (shape === 'subroutine') {
                ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y + h);
                ctx.moveTo(x + w - 6, y); ctx.lineTo(x + w - 6, y + h); ctx.stroke();
            } else {
                ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
            }
            ctx.fillStyle = '#1f2933'; ctx.font = '13px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            // Bungkus teks agar ganti baris sama dengan preview (CSS auto-wrap dalam lebar node).
            // Padding kiri-kanan node ~ 0.7rem*2 ≈ 22px; sisakan sedikit ruang.
            const maxTextW = Math.max(20, w - 24);
            const tl = wrapText(ctx, String(n.text), maxTextW);
            const lh = 16, sy = cy - (tl.length - 1) * lh / 2;
            tl.forEach(function (ln, i) { ctx.fillText(ln, cx, sy + i * lh); });
        });
        c.toBlob(function (blob) { saveBlob(opts.fileBase + '.png', blob, 'image/png', 'png', 'PNG image'); }, 'image/png');
    }
    function importFile(file) {
        const r = new FileReader();
        r.onload = function () {
            try {
                const d = JSON.parse(String(r.result));
                if (d && Array.isArray(d.nodes)) model = d;
                else if (d && d.model && Array.isArray(d.model.nodes)) model = d.model;
                else { alert('Invalid file.'); return; }
            } catch (e) { alert('Invalid JSON file: ' + e.message); return; }
            render();
        };
        r.readAsText(file);
    }

    // ===== wire toolbar =====
    document.getElementById(opts.exportJsonId).addEventListener('click', exportJson);
    document.getElementById(opts.exportPngId).addEventListener('click', exportPng);
    document.getElementById(opts.importId).addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = '';
    });
    document.getElementById(opts.resetId).addEventListener('click', function () {
        if (confirm('Reset to the initial example? Saved data will be cleared.')) {
            try { localStorage.removeItem(storageKey); } catch (e) {}
            seed(); render();
        }
    });
    document.getElementById(opts.zoomInId).addEventListener('click', function () { setZoom(zoom + 0.1); });
    document.getElementById(opts.zoomOutId).addEventListener('click', function () { setZoom(zoom - 0.1); });
    document.getElementById(opts.zoomResetId).addEventListener('click', function () { setZoom(1); });

    // tombol tambah bentuk
    (opts.addButtons || []).forEach(function (b) {
        const btn = document.getElementById(b.id);
        if (btn) btn.addEventListener('click', function () { addNode(b.shape); });
    });

    // batal mode hubungkan dengan klik kosong / Esc
    canvas.addEventListener('click', function (e) {
        if (e.target === canvas || e.target === stage || e.target === svg || e.target === nodesLayer) {
            connectFrom = null; canvas.classList.remove('dg-linking');
            const l = nodesLayer.querySelector('.linking'); if (l) l.classList.remove('linking');
            // klik area kosong tanpa Shift: kosongkan pilihan
            if (!e.shiftKey && selection.size) clearSelection();
        }
    });
    // Cegah menu konteks bawaan browser di area kanvas (kita pakai menu sendiri di node/garis).
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { connectFrom = null; canvas.classList.remove('dg-linking'); }
    });

    // ===== geser panel (pan) dengan Ctrl + seret mouse =====
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
        // capture=true agar pan menang atas drag node/handle ketika Ctrl ditekan
        canvas.addEventListener('mousedown', down, true);
    })();

    // ===== Seleksi rentang dengan mouse (rubber-band) pada area kosong =====
    (function enableRubberBand() {
        let band = null, active = false, sx = 0, sy = 0, additive = false;
        function stageXY(e) {
            const r = stage.getBoundingClientRect();
            return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
        }
        function down(e) {
            if (e.button && e.button !== 0) return;      // hanya klik kiri
            if (e.ctrlKey || e.metaKey) return;          // Ctrl = pan
            // hanya mulai di area kosong (bukan di atas node/handle/garis).
            // nodesLayer (#dg-nodes) menutupi seluruh stage, jadi klik kosong sering mengenainya.
            if (!(e.target === canvas || e.target === stage || e.target === svg || e.target === nodesLayer)) return;
            active = true;
            additive = e.shiftKey;                        // Shift = tambah ke pilihan lama
            const p = stageXY(e); sx = p.x; sy = p.y;
            band = document.createElement('div');
            band.className = 'dg-rubber';
            band.style.left = sx + 'px'; band.style.top = sy + 'px';
            band.style.width = '0px'; band.style.height = '0px';
            stage.appendChild(band);
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            e.preventDefault();
        }
        function move(e) {
            if (!active) return;
            const p = stageXY(e);
            const x = Math.min(sx, p.x), y = Math.min(sy, p.y);
            const w = Math.abs(p.x - sx), h = Math.abs(p.y - sy);
            band.style.left = x + 'px'; band.style.top = y + 'px';
            band.style.width = w + 'px'; band.style.height = h + 'px';
            e.preventDefault();
        }
        function up(e) {
            if (!active) return;
            active = false;
            const rect = { x: parseFloat(band.style.left), y: parseFloat(band.style.top),
                w: parseFloat(band.style.width), h: parseFloat(band.style.height) };
            if (band && band.parentNode) band.parentNode.removeChild(band);
            band = null;
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            // Seret sangat kecil dianggap klik biasa -> jangan ubah pilihan.
            if (rect.w < 4 && rect.h < 4) { if (!additive) clearSelection(); return; }
            if (!additive) selection.clear();
            // Pilih node yang beririsan dengan kotak seleksi.
            model.nodes.forEach(function (n) {
                const g = nodeGeom(n);
                const inter = !(g.x > rect.x + rect.w || g.x + g.w < rect.x ||
                                g.y > rect.y + rect.h || g.y + g.h < rect.y);
                if (inter) selection.add(n.id);
            });
            refreshSelectionStyles();
        }
        // capture=false: biarkan node menangani mousedown-nya sendiri; hanya area kosong yang sampai sini.
        canvas.addEventListener('mousedown', down);
    })();

    if (!loadStored()) seed();
    applyZoom();
    render();
};
