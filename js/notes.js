(function () {
    'use strict';

    // ===================== Elemen =====================
    const treeEl = document.getElementById('nt-tree');
    const folderNameEl = document.getElementById('nt-folder-name');
    const editor = document.getElementById('nt-editor');
    const statusEl = document.getElementById('nt-status');
    const autosaveChk = document.getElementById('nt-autosave');
    const blockSel = document.getElementById('nt-block');
    const fsHint = document.getElementById('nt-fs-hint');

    const btnOpen = document.getElementById('nt-open-folder');
    const btnNew = document.getElementById('nt-new-file');
    const btnRefresh = document.getElementById('nt-refresh');
    const btnSave = document.getElementById('nt-save');
    const rawArea = document.getElementById('nt-raw-area');
    const btnRaw = document.getElementById('nt-raw');
    const btnWrap = document.getElementById('nt-wrap');

    const hasFS = !!(window.showDirectoryPicker);

    // ===================== State =====================
    let dirHandle = null;          // active FileSystemDirectoryHandle
    let dirStack = [];             // folder chain root -> current (for "go up")
    let currentFileHandle = null;  // currently open file
    let currentFileName = null;
    let dirty = false;
    let saveTimer = null;
    let rawMode = false;           // true = editing raw Markdown in the textarea

    if (!hasFS) {
        fsHint.textContent = 'This browser does not support local folder access. Use Chrome/Edge for the explorer & auto-save features.';
    }

    // ===================== Util status =====================
    function setStatus(text, kind) {
        statusEl.textContent = text || '';
        statusEl.className = 'nt-status' + (kind ? ' ' + kind : '');
    }

    // ===================== Konversi Markdown <-> HTML (subset umum) =====================
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // ---- Pembantu tabel GFM ----
    // Baris pemisah alignment, mis: | --- | :---: | ---: |  (harus mengandung '-')
    function isDelimRow(line) {
        if (line == null) return false;
        const t = String(line).trim();
        if (t.indexOf('-') === -1) return false;
        return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
    }
    // Pisah satu baris tabel pada '|' yang TIDAK di-escape; buang pipe tepi; unescape \| -> |
    function splitRow(line) {
        let t = String(line).trim();
        if (t.charAt(0) === '|') t = t.slice(1);
        if (t.charAt(t.length - 1) === '|' && !/\\$/.test(t)) t = t.slice(0, -1);
        // pecah pada | yang tidak didahului backslash
        const cells = t.split(/(?<!\\)\|/);
        return cells.map(function (c) { return c.replace(/\\\|/g, '|').trim(); });
    }
    // Alignment per kolom dari baris pemisah: :---: center, ---: right, :--- left, selain itu null
    function parseAligns(delimLine) {
        return splitRow(delimLine).map(function (c) {
            const s = c.trim();
            const left = s.charAt(0) === ':';
            const right = s.charAt(s.length - 1) === ':';
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return null;
        });
    }
    // Inline: **bold**, *italic*, `code`, ~~strike~~, [teks](url),
    // serta <span style="color/background">...</span> mentah (untuk warna) yang dipertahankan.
    function inlineMdToHtml(text) {
        let t = escapeHtml(String(text));
        t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
        t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
        t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
        t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        // Allow a literal <br> / <br/> written by the user to render as a line break.
        t = t.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
        return t; // placeholder \u0000RS..\u0000 dipulihkan di akhir mdToHtml
    }
    // Ekstrak span gaya (color/background/font-family) TERLUAR dengan memperhatikan
    // sarang <span>...</span>, lalu ganti dengan placeholder \u0000RSn\u0000.
    function protectSpans(text, store) {
        const openRe = /<span\s+style="[^"]*(?:color|background|font-family)[^"]*"\s*>/gi;
        let out = '';
        let idx = 0;
        while (idx < text.length) {
            openRe.lastIndex = idx;
            const m = openRe.exec(text);
            if (!m) { out += text.slice(idx); break; }
            out += text.slice(idx, m.index); // teks sebelum span
            // cari </span> penutup yang seimbang mulai dari akhir tag pembuka
            let depth = 1;
            let p = openRe.lastIndex;
            const spanTag = /<\/?span\b[^>]*>/gi;
            spanTag.lastIndex = p;
            let closeEnd = -1;
            let tm;
            while ((tm = spanTag.exec(text))) {
                if (/^<\//.test(tm[0])) { depth--; if (depth === 0) { closeEnd = spanTag.lastIndex; break; } }
                else { depth++; }
            }
            if (closeEnd === -1) { // tak ada penutup -> perlakukan sebagai teks biasa
                out += text.slice(m.index, m.index + m[0].length);
                idx = m.index + m[0].length;
                continue;
            }
            const full = text.slice(m.index, closeEnd);
            // buang span kosong (tanpa isi berarti)
            const innerOnly = full.replace(/^<span[^>]*>/i, '').replace(/<\/span>$/i, '');
            if (innerOnly.replace(/<[^>]+>/g, '').replace(/\s+/g, '') === '') {
                out += innerOnly; // pertahankan isi (mungkin span bersarang lain), buang bungkus kosong
            } else {
                store.push(full.replace(/\n/g, ' '));
                out += '\u0000RS' + (store.length - 1) + '\u0000';
            }
            idx = closeEnd;
        }
        return out;
    }

    // Bangun HTML daftar bersarang dari daftar item {level, ordered, text}.
    function buildNestedList(items) {
        let idx = 0;
        function build(level) {
            if (idx >= items.length || items[idx].level < level) return '';
            const ordered = items[idx].ordered;
            let out = ordered ? '<ol>' : '<ul>';
            while (idx < items.length && items[idx].level === level) {
                const it = items[idx];
                idx++;
                let li = '<li>' + inlineMdToHtml(it.text);
                // sub-daftar bila item berikutnya lebih dalam
                if (idx < items.length && items[idx].level > level) {
                    li += build(level + 1);
                }
                li += '</li>';
                out += li;
            }
            out += ordered ? '</ol>' : '</ul>';
            return out;
        }
        // normalisasi: level minimum jadi 0
        const minLevel = items.reduce(function (m, it) { return Math.min(m, it.level); }, Infinity);
        items.forEach(function (it) { it.level -= minLevel; });
        return build(0);
    }

    // Markdown -> HTML (blok: heading, list, quote, code fence, hr, paragraf)
    function mdToHtml(md) {
        let text = String(md).replace(/\r\n/g, '\n');
        // Lindungi blok fenced ```...``` yang SUDAH benar agar tidak diutak-atik normalisasi di bawah.
        const fences = [];
        text = text.replace(/```[\s\S]*?```/g, function (m) {
            fences.push(m); return '\u0000FENCE' + (fences.length - 1) + '\u0000';
        });
        // Perbaiki code lama: `...` (backtick tunggal) yang membungkus teks MULTI-BARIS.
        // HANYA ubah jika seluruh span berdiri sendiri (backtick di awal baris, isi
        // multi-baris tanpa baris kosong, backtick di akhir baris) DAN tidak ada backtick
        // lain di dalamnya. Ini mencegah backtick antar-baris yang tidak berhubungan
        // ter-pasang keliru sehingga menelan sebagian besar dokumen.
        text = text.replace(/^`([^`]*\n(?:[^`\n]*\n)*?[^`\n]*)`[ \t]*$/gm, function (_, inner) {
            return '```\n' + inner.replace(/^\n+|\n+$/g, '') + '\n```';
        });
        // Kembalikan fenced block yang dilindungi.
        text = text.replace(/\u0000FENCE(\d+)\u0000/g, function (_, i) { return fences[+i]; });
        // Perbaiki span lama yang punya kutip ganda di dalam style (mis. font-family:"Comic Sans MS")
        // yang merusak atribut. Ubah kutip ganda di dalam style menjadi kutip tunggal.
        text = text.replace(/<span style="((?:[^"]|"[^"]*")*?)">/gi, function (m, style) {
            // Bila style mengandung kutip ganda internal (setelah karakter pertama), rapikan.
            return '<span style="' + style.replace(/"/g, "'") + '">';
        });
        // Tangani juga bentuk rusak: font-family:"X", cursive;">  (kutip di tengah)
        text = text.replace(/font-family:"([^"]*)"/gi, "font-family:'$1'");
        // Lindungi span warna/huruf mentah (termasuk multi-baris & BERSARANG) sebelum diproses
        // per baris, agar tag tidak bocor sebagai teks. Placeholder tanpa newline.
        const rawSpans = [];
        text = protectSpans(text, rawSpans);
        const lines = text.split('\n');
        const html = [];
        let i = 0;
        let listType = null; // 'ul' | 'ol'
        function closeList() { if (listType) { html.push('</' + listType + '>'); listType = null; } }
        while (i < lines.length) {
            let line = lines[i];
            // Blok collapsible mentah: <details>...</details> (dipertahankan apa adanya,
            // isi di dalamnya dikonversi sebagai markdown).
            if (/^<details/i.test(line.trim())) {
                closeList();
                const buf = [];
                i++;
                while (i < lines.length && !/^<\/details>/i.test(lines[i].trim())) { buf.push(lines[i]); i++; }
                i++; // lewati </details>
                let summary = 'Section';
                const inner = [];
                buf.forEach(function (b) {
                    const sm = b.trim().match(/^<summary>(.*)<\/summary>$/i);
                    if (sm) summary = sm[1]; else inner.push(b);
                });
                html.push('<details open><summary>' + inlineMdToHtml(summary) + '</summary>' +
                    mdToHtml(inner.join('\n')) + '</details>');
                continue;
            }
            // code fence ```
            if (/^```/.test(line)) {
                closeList();
                const buf = [];
                i++;
                while (i < lines.length && !/^```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
                i++; // lewati penutup
                html.push('<pre>' + buf.join('\n') + '</pre>');
                continue;
            }
            // Tabel Markdown (GFM). Baris berisi '|' diikuti baris pemisah alignment.
            // Mendukung: dengan/tanpa pipe di tepi, escaped pipe (\|), dan alignment (:---, :---:, ---:).
            if (line.indexOf('|') !== -1 && i + 1 < lines.length && isDelimRow(lines[i + 1])) {
                closeList();
                const header = splitRow(line);
                const aligns = parseAligns(lines[i + 1]);
                i += 2; // lewati header + pemisah
                const bodyRows = [];
                while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i]) && !isDelimRow(lines[i])) {
                    bodyRows.push(splitRow(lines[i])); i++;
                }
                const cols = header.length;
                function alignAttr(ci) { const a = aligns[ci]; return a ? ' style="text-align:' + a + '"' : ''; }
                let th = '<table><thead><tr>' + header.map(function (h, ci) {
                    return '<th' + alignAttr(ci) + '>' + inlineMdToHtml(h) + '</th>';
                }).join('') + '</tr></thead>';
                let tb = '<tbody>' + bodyRows.map(function (r) {
                    let row = '<tr>';
                    for (let ci = 0; ci < cols; ci++) row += '<td' + alignAttr(ci) + '>' + inlineMdToHtml(r[ci] || '') + '</td>';
                    return row + '</tr>';
                }).join('') + '</tbody></table>';
                html.push(th + tb);
                continue;
            }
            // hr
            if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); html.push('<hr>'); i++; continue; }
            // heading (also match an empty heading like "###" used as a spacer)
            const hm = line.match(/^(#{1,6})(?:\s+(.*))?$/);
            if (hm) { closeList(); const lvl = hm[1].length; html.push('<h' + lvl + '>' + inlineMdToHtml(hm[2] || '') + '</h' + lvl + '>'); i++; continue; }
            // blockquote
            if (/^>\s?/.test(line)) {
                closeList();
                const buf = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(inlineMdToHtml(lines[i].replace(/^>\s?/, ''))); i++; }
                html.push('<blockquote>' + buf.join('<br>') + '</blockquote>');
                continue;
            }
            // Daftar (mendukung sarang berdasarkan indentasi). Kumpulkan baris list berturut-turut.
            if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
                closeList();
                const items = [];
                while (i < lines.length && /^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])) {
                    const mm = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
                    const indent = mm[1].replace(/\t/g, '  ').length;
                    const ordered = /\d+\./.test(mm[2]);
                    items.push({ level: Math.floor(indent / 2), ordered: ordered, text: mm[3] });
                    i++;
                }
                html.push(buildNestedList(items));
                continue;
            }
            // Baris kosong: satu baris kosong = pemisah biasa; baris kosong BERUNTUN
            // dipertahankan sebagai spacer (paragraf kosong) agar jarak vertikal tidak hilang.
            if (/^\s*$/.test(line)) {
                closeList();
                let blanks = 0;
                while (i < lines.length && /^\s*$/.test(lines[i])) { blanks++; i++; }
                for (let b = 1; b < blanks; b++) html.push('<p class="mm-spacer"><br></p>');
                continue;
            }
            // paragraf (gabungkan baris berturut-turut)
            closeList();
            const buf = [inlineMdToHtml(line)];
            i++;
            while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|```)/.test(lines[i])
                   && !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])) {
                buf.push(inlineMdToHtml(lines[i])); i++;
            }
            html.push('<p>' + buf.join('<br>') + '</p>');
        }
        closeList();
        let result = html.join('\n');
        // pulihkan span warna/huruf mentah yang dilindungi di awal fungsi ini
        result = result.replace(/\u0000RS(\d+)\u0000/g, function (_, i) { return rawSpans[+i] || ''; });
        return result;
    }

    // HTML -> Markdown
    function htmlToMd(root) {
        const out = [];
        // Ambil teks blok kode dengan MEMPERTAHANKAN baris baru: <br> dan elemen blok
        // (div/p) yang dibuat saat menekan Enter di dalam <pre> diubah jadi "\n".
        function preText(el) {
            let s = '';
            el.childNodes.forEach(function (n) {
                if (n.nodeType === 3) { s += n.nodeValue; return; }
                if (n.nodeType !== 1) return;
                const t = n.nodeName.toLowerCase();
                if (t === 'br') { s += '\n'; return; }
                if (t === 'div' || t === 'p') {
                    if (s && !/\n$/.test(s)) s += '\n';
                    s += preText(n);
                    if (!/\n$/.test(s)) s += '\n';
                } else {
                    s += preText(n);
                }
            });
            return s;
        }
        function inline(node) {
            let s = '';
            node.childNodes.forEach(function (c) {
                if (c.nodeType === 3) { s += c.nodeValue; return; }
                const tag = c.nodeName.toLowerCase();
                const inner = inline(c);
                if (tag === 'b' || tag === 'strong') s += '**' + inner + '**';
                else if (tag === 'i' || tag === 'em') s += '*' + inner + '*';
                else if (tag === 's' || tag === 'strike' || tag === 'del') s += '~~' + inner + '~~';
                else if (tag === 'code') s += '`' + inner + '`';
                else if (tag === 'a') s += '[' + inner + '](' + (c.getAttribute('href') || '') + ')';
                else if (tag === 'br') s += '\n';
                else if (tag === 'span' || tag === 'font') {
                    // Pertahankan warna teks / latar / jenis huruf sebagai HTML span mentah.
                    const col = c.style && (c.style.color || '');
                    const bg = c.style && (c.style.backgroundColor || '');
                    const ff = (c.style && c.style.fontFamily) || (tag === 'font' && c.getAttribute('face')) || '';
                    if (col || bg || ff) {
                        let st = '';
                        if (col) st += 'color:' + col + ';';
                        if (bg) st += 'background:' + bg + ';';
                        // font-family sering mengandung tanda kutip ganda -> ganti ke kutip tunggal
                        // agar tidak merusak atribut style="...".
                        if (ff) st += 'font-family:' + ff.replace(/"/g, "'") + ';';
                        s += '<span style="' + st + '">' + inner + '</span>';
                    } else s += inner;
                }
                else s += inner;
            });
            return s;
        }
        // Render <ul>/<ol> beserta sarangnya dengan indentasi 2 spasi per level.
        function renderList(listEl, level) {
            const ordered = listEl.tagName.toLowerCase() === 'ol';
            let n = 1;
            Array.prototype.forEach.call(listEl.children, function (li) {
                if (li.tagName.toLowerCase() !== 'li') return;
                // teks item = inline dari li tanpa sub-list
                const clone = li.cloneNode(true);
                Array.prototype.slice.call(clone.querySelectorAll(':scope > ul, :scope > ol')).forEach(function (s) { s.remove(); });
                const marker = ordered ? (n++) + '. ' : '- ';
                out.push('  '.repeat(level) + marker + inline(clone).trim());
                // sub-list langsung di dalam li
                Array.prototype.forEach.call(li.children, function (child) {
                    const ct = child.tagName && child.tagName.toLowerCase();
                    if (ct === 'ul' || ct === 'ol') renderList(child, level + 1);
                });
            });
        }

        function block(node) {
            node.childNodes.forEach(function (c) {
                if (c.nodeType === 3) {
                    const txt = c.nodeValue.trim();
                    if (txt) out.push(txt);
                    return;
                }
                if (c.nodeType !== 1) return;
                const tag = c.nodeName.toLowerCase();
                // <code> multi-baris -> fenced block (bukan inline backtick).
                if (tag === 'code' && (/\n/.test(c.textContent) || c.querySelector('br,div,p'))) {
                    out.push('```'); out.push(preText(c).replace(/\n+$/, '')); out.push('```'); out.push('');
                    return;
                }
                if (/^h[1-6]$/.test(tag)) {
                    const ht = inline(c).trim();
                    // empty heading (used as a spacer) -> keep the bare hashes
                    out.push('#'.repeat(parseInt(tag[1], 10)) + (ht ? ' ' + ht : '')); out.push('');
                } else if (tag === 'p' || tag === 'div') {
                    // Bila paragraf/div mengandung blok (details/ul/ol/blockquote/pre/table), proses sebagai blok.
                    if (c.querySelector('details, ul, ol, blockquote, pre, table, hr, h1, h2, h3, h4, h5, h6')) {
                        block(c);
                    } else {
                        const s = inline(c).replace(/\n{2,}/g, '\n').trim();
                        if (s === '') {
                            // Empty/spacer paragraph -> keep an extra blank line so vertical spacing survives.
                            out.push('\u0000BLANK\u0000');
                        } else {
                            out.push(s); out.push('');
                        }
                    }
                } else if (tag === 'blockquote') {
                    inline(c).split('\n').forEach(function (ln) { out.push('> ' + ln); }); out.push('');
                } else if (tag === 'pre') {
                    out.push('```'); out.push(preText(c).replace(/\n+$/, '')); out.push('```'); out.push('');
                } else if (tag === 'ul' || tag === 'ol') {
                    renderList(c, 0);
                    out.push('');
                } else if (tag === 'hr') {
                    out.push('---'); out.push('');
                } else if (tag === 'table') {
                    const rows = [];
                    c.querySelectorAll('tr').forEach(function (tr) {
                        const cellsArr = [];
                        tr.querySelectorAll('th,td').forEach(function (cell) { cellsArr.push(inline(cell).trim().replace(/\|/g, '\\|') || ' '); });
                        rows.push(cellsArr);
                    });
                    if (rows.length) {
                        const colCount = rows[0].length;
                        out.push('| ' + rows[0].join(' | ') + ' |');
                        out.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
                        for (let ri = 1; ri < rows.length; ri++) {
                            out.push('| ' + rows[ri].join(' | ') + ' |');
                        }
                        out.push('');
                    }
                } else if (tag === 'details') {
                    const sum = c.querySelector(':scope > summary');
                    const summaryText = sum ? inline(sum).trim() : 'Section';
                    // isi selain summary
                    const clone = c.cloneNode(true);
                    const s2 = clone.querySelector(':scope > summary'); if (s2) s2.remove();
                    out.push('<details>');
                    out.push('<summary>' + summaryText + '</summary>');
                    out.push(htmlToMd(clone).trim());
                    out.push('</details>');
                    out.push('');
                } else {
                    const s = inline(c).trim();
                    if (s) { out.push(s); out.push(''); }
                }
            });
        }
        block(root);
        // tidy excess blank lines, then restore intentional spacer paragraphs as blank lines
        let md = out.join('\n').replace(/\n{3,}/g, '\n\n');
        md = md.replace(/\u0000BLANK\u0000/g, '');   // spacer marker -> just its surrounding newlines
        md = md.replace(/\n{3,}/g, '\n\n\n');          // allow up to one intentional extra blank line
        return md.trim() + '\n';
    }

    // ===================== Explorer folder (File System Access API) =====================
    async function openFolder() {
        if (!hasFS) { alert('This browser does not support folder access. Use Chrome/Edge.'); return; }
        try {
            dirHandle = await window.showDirectoryPicker();
        } catch (err) { if (err && err.name === 'AbortError') return; alert('Failed to open folder: ' + err.message); return; }
        dirStack = [dirHandle]; // new root
        folderNameEl.textContent = dirHandle.name;
        btnNew.disabled = false; btnRefresh.disabled = false;
        updateUpBtn();
        await listFolder();
    }

    function updateUpBtn() {
        // Up button is active once a folder is open:
        //  - in a subfolder: go up to the parent in the stack,
        //  - at the granted root: reopen the folder picker (API cannot go above the root).
        document.getElementById('nt-up').disabled = !dirHandle;
        const up = document.getElementById('nt-up');
        up.title = dirStack.length > 1 ? 'Go up one level' : 'At the top folder — click to pick another folder';
        folderNameEl.textContent = dirStack.map(function (h) { return h.name; }).join(' / ') || (dirHandle ? dirHandle.name : '');
    }

    async function goUp() {
        if (dirStack.length > 1) {
            dirStack.pop();
            dirHandle = dirStack[dirStack.length - 1];
            updateUpBtn();
            await listFolder();
        } else {
            // Sudah di root yang di-grant; API tidak mengizinkan naik ke induk -> buka pemilih folder.
            await openFolder();
        }
    }

    async function listFolder() {
        treeEl.innerHTML = '';
        if (!dirHandle) return;
        const entries = [];
        for await (const [name, handle] of dirHandle.entries()) {
            entries.push({ name: name, handle: handle, dir: handle.kind === 'directory' });
        }
        // folder dulu, lalu file; hanya tampilkan .md/.txt untuk file
        entries.sort(function (a, b) {
            if (a.dir !== b.dir) return a.dir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        entries.forEach(function (e) {
            if (!e.dir && !/\.(md|markdown|txt)$/i.test(e.name)) return;
            const li = document.createElement('li');
            li.className = 'nt-item' + (e.dir ? ' nt-dir' : '');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'nt-item-name';
            nameSpan.textContent = (e.dir ? '📁 ' : '📄 ') + e.name;
            li.appendChild(nameSpan);

            if (e.dir) {
                nameSpan.addEventListener('click', async function () {
                    dirHandle = e.handle;
                    dirStack.push(e.handle);
                    updateUpBtn();
                    await listFolder();
                });
            } else {
                nameSpan.addEventListener('click', function () { openFile(e.handle, e.name, li); });
                // Tombol aksi (rename/hapus) untuk file.
                const act = document.createElement('button');
                act.className = 'nt-item-act'; act.type = 'button'; act.textContent = '⋯';
                act.title = 'File actions (rename / delete)';
                act.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    showFileMenu(ev, e.name, e.handle);
                });
                li.appendChild(act);
            }
            treeEl.appendChild(li);
        });
        if (!treeEl.children.length) {
            const li = document.createElement('li');
            li.className = 'nt-empty'; li.textContent = 'No .md/.txt files';
            treeEl.appendChild(li);
        }
    }

    async function openFile(handle, name, li) {
        if (dirty && currentFileHandle) { await saveNow(); }
        try {
            const file = await handle.getFile();
            const text = await file.text();
            currentFileHandle = handle; currentFileName = name;
            if (rawMode) {
                rawArea.value = text;
            } else {
                editor.innerHTML = mdToHtml(text) || '<p><br></p>';
                ensureEditableGaps();
            }
            dirty = false; setStatus('Opened: ' + name);
            // active highlight
            treeEl.querySelectorAll('.nt-item.active').forEach(function (x) { x.classList.remove('active'); });
            if (li) li.classList.add('active');
        } catch (err) { alert('Failed to open file: ' + err.message); }
    }

    async function newFile() {
        if (!dirHandle) return;
        let name = prompt('New file name (e.g. notes.md):', 'new-note.md');
        if (!name) return;
        name = name.trim().replace(/[\\/:*?"<>|]/g, '_');
        if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
        try {
            const handle = await dirHandle.getFileHandle(name, { create: true });
            const w = await handle.createWritable(); await w.write('# ' + name.replace(/\.[^.]+$/, '') + '\n\n'); await w.close();
            await listFolder();
            // open the new file
            const li = Array.prototype.find.call(treeEl.children, function (x) { return x.textContent.indexOf(name) !== -1; });
            openFile(handle, name, li);
        } catch (err) { alert('Failed to create file: ' + err.message); }
    }

    // ===================== File actions menu (rename / delete) =====================
    let fileMenuEl = null;
    function closeFileMenu() {
        if (fileMenuEl) { fileMenuEl.remove(); fileMenuEl = null; }
        document.removeEventListener('click', fileMenuOutside);
    }
    function fileMenuOutside(e) { if (fileMenuEl && fileMenuEl.contains(e.target)) return; closeFileMenu(); }
    function showFileMenu(ev, name, handle) {
        closeFileMenu();
        const menu = document.createElement('div');
        menu.className = 'dg-menu';
        const t = ev.touches ? ev.touches[0] : ev;
        menu.style.left = (t.clientX + 2) + 'px';
        menu.style.top = (t.clientY + 2) + 'px';
        function item(text, onClick) {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = text;
            b.addEventListener('click', function (e2) { e2.stopPropagation(); closeFileMenu(); onClick(); });
            menu.appendChild(b);
        }
        item('Rename…', function () { renameFile(name, handle); });
        item('Delete', function () { deleteFile(name, handle); });
        document.body.appendChild(menu);
        fileMenuEl = menu;
        // clamp within viewport (mobile)
        const r = menu.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
        let left = parseFloat(menu.style.left), top = parseFloat(menu.style.top);
        if (left + r.width > vw - 6) left = Math.max(6, vw - r.width - 6);
        if (top + r.height > vh - 6) top = Math.max(6, vh - r.height - 6);
        menu.style.left = left + 'px'; menu.style.top = top + 'px';
        setTimeout(function () { document.addEventListener('click', fileMenuOutside); }, 0);
    }

    // Rename = create a new file with the new name, copy content, remove the old one
    // (the File System Access API has no native rename).
    async function renameFile(oldName, handle) {
        if (!dirHandle) return;
        let name = prompt('Rename file to:', oldName);
        if (name === null) return;
        name = name.trim().replace(/[\\/:*?"<>|]/g, '_');
        if (!name) return;
        if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
        if (name === oldName) return;
        try {
            const src = await handle.getFile();
            const content = await src.text();
            const newHandle = await dirHandle.getFileHandle(name, { create: true });
            const w = await newHandle.createWritable(); await w.write(content); await w.close();
            await dirHandle.removeEntry(oldName);
            // if we renamed the open file, keep it open under the new name
            if (currentFileName === oldName) { currentFileHandle = newHandle; currentFileName = name; }
            await listFolder();
            setStatus('Renamed to ' + name, 'ok');
        } catch (err) { alert('Failed to rename: ' + err.message); }
    }

    async function deleteFile(name, handle) {
        if (!dirHandle) return;
        if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
        try {
            await dirHandle.removeEntry(name);
            if (currentFileName === name) {
                currentFileHandle = null; currentFileName = null;
                editor.innerHTML = '<p><br></p>'; rawArea.value = '';
                setStatus('File deleted', 'ok');
            } else {
                setStatus('Deleted ' + name, 'ok');
            }
            await listFolder();
        } catch (err) { alert('Failed to delete: ' + err.message); }
    }

    // Get the current Markdown, whether we're in raw mode or WYSIWYG mode.
    function currentMarkdown() {
        return rawMode ? rawArea.value : htmlToMd(editor);
    }

    async function saveNow() {
        if (!currentFileHandle) { return saveAs(); } // no file yet -> offer Save As
        try {
            const md = currentMarkdown();
            const w = await currentFileHandle.createWritable();
            await w.write(md); await w.close();
            dirty = false; setStatus('Saved \u2022 ' + new Date().toLocaleTimeString(), 'ok');
        } catch (err) { setStatus('Save failed: ' + err.message, 'warn'); }
    }

    // Save as a new file. Use showSaveFilePicker when available; otherwise download.
    async function saveAs() {
        const md = currentMarkdown();
        const suggested = currentFileName || 'notes.md';
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: suggested,
                    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'], 'text/plain': ['.txt'] } }]
                });
                const w = await handle.createWritable(); await w.write(md); await w.close();
                currentFileHandle = handle; currentFileName = handle.name;
                dirty = false; setStatus('Saved as ' + handle.name, 'ok');
                if (dirHandle) listFolder(); // refresh list if the new file is in the active folder
                return;
            } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        // Fallback: prompt for name then download
        let name = prompt('Save as (file name):', suggested);
        if (name === null) return;
        name = (name.trim() || suggested).replace(/[\\/:*?"<>|]/g, '_');
        if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        setStatus('Downloaded: ' + name, 'ok');
    }

    function scheduleAutoSave() {
        if (!autosaveChk.checked || !currentFileHandle) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 1000);
    }

    // Pastikan setiap <details> tingkat atas punya paragraf setelahnya, dan editor diakhiri
    // paragraf kosong — supaya kursor bisa keluar dari collapsible dan menulis di bawahnya.
    // Convert a literal "<br>" / "<br/>" typed as text into a real line break element.
    function convertLiteralBr(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const targets = [];
        let n;
        while ((n = walker.nextNode())) {
            if (/<br\s*\/?>/i.test(n.nodeValue)) targets.push(n);
        }
        targets.forEach(function (tn) {
            const parts = tn.nodeValue.split(/<br\s*\/?>/i);
            const frag = document.createDocumentFragment();
            parts.forEach(function (part, idx) {
                if (part) frag.appendChild(document.createTextNode(part));
                if (idx < parts.length - 1) frag.appendChild(document.createElement('br'));
            });
            tn.parentNode.replaceChild(frag, tn);
        });
    }

    // Wrap wide tables in a horizontally-scrollable container so they never overflow the frame.
    function wrapTables(root) {
        root.querySelectorAll('table').forEach(function (tbl) {
            const parent = tbl.parentNode;
            if (parent && parent.classList && parent.classList.contains('nt-table-wrap')) return; // already wrapped
            const wrap = document.createElement('div');
            wrap.className = 'nt-table-wrap';
            wrap.setAttribute('contenteditable', 'false'); // wrapper itself not editable; table stays editable
            parent.insertBefore(wrap, tbl);
            wrap.appendChild(tbl);
            tbl.setAttribute('contenteditable', 'true');
        });
    }

    function ensureEditableGaps() {
        convertLiteralBr(editor); // typed "<br>" -> real break
        wrapTables(editor);       // make wide tables scrollable
        // Blok yang butuh paragraf editable setelahnya agar kursor bisa keluar & menulis di bawahnya.
        const BLOCKS = ['DETAILS', 'PRE', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'HR'];
        function isBlock(el) { return el && (BLOCKS.indexOf(el.tagName) !== -1 || (el.classList && el.classList.contains('nt-table-wrap'))); }
        function newP() { const p = document.createElement('p'); p.appendChild(document.createElement('br')); return p; }
        const kids = Array.prototype.slice.call(editor.children);
        kids.forEach(function (el) {
            if (isBlock(el)) {
                const next = el.nextElementSibling;
                if (!next || isBlock(next)) {
                    editor.insertBefore(newP(), el.nextSibling);
                }
            }
        });
        const last = editor.lastElementChild;
        if (!last || isBlock(last)) {
            editor.appendChild(newP());
        }
    }

    // ===================== Raw Markdown toggle =====================
    // Lets you view/fix the underlying Markdown directly (useful to repair spacing/blocks).
    function setRawMode(on) {
        if (on === rawMode) return;
        if (on) {
            rawArea.value = htmlToMd(editor);
            editor.style.display = 'none';
            rawArea.style.display = '';
            btnRaw.classList.add('active');
            rawArea.focus();
        } else {
            editor.innerHTML = mdToHtml(rawArea.value) || '<p><br></p>';
            ensureEditableGaps();
            rawArea.style.display = 'none';
            editor.style.display = '';
            btnRaw.classList.remove('active');
            editor.focus();
        }
        rawMode = on;
        // disable formatting toolbar buttons while in raw mode
        document.querySelectorAll('#nt-toolbar button[data-cmd], #nt-toolbar button[data-act], #nt-block, #nt-font, #nt-color-btn, #nt-hilite-btn, #nt-date-btn')
            .forEach(function (b) { b.disabled = on; });
    }

    // ===================== Editor & toolbar =====================
    function exec(cmd, val) { document.execCommand(cmd, false, val || null); editor.focus(); }

    document.querySelectorAll('#nt-toolbar button[data-cmd]').forEach(function (b) {
        b.addEventListener('click', function () { exec(b.getAttribute('data-cmd')); markDirty(); });
    });
    // ===== Palet warna umum =====
    const TEXT_COLORS = ['#1f2933', '#d64545', '#c2410c', '#b7791f', '#1a7f37', '#0891b2', '#1f6feb', '#9333ea', '#be185d', '#ffffff'];
    const HILITE_COLORS = ['#fff3a3', '#c7f0d2', '#cfe4ff', '#ffd8cc', '#e6d6fb', '#ffe0ef', '#e4e7eb', 'transparent'];

    function buildSwatchMenu(menuEl, colors, onPick) {
        colors.forEach(function (c) {
            const sw = document.createElement('button');
            sw.type = 'button'; sw.className = 'nt-swatch'; sw.title = c;
            sw.style.background = c === 'transparent' ? '#fff' : c;
            if (c === 'transparent') sw.textContent = '⌀';
            sw.addEventListener('click', function (e) { e.stopPropagation(); onPick(c); closeDD(); });
            menuEl.appendChild(sw);
        });
    }

    // Terapkan warna teks / latar pada seleksi menggunakan span.
    function applyColor(kind, color) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) { setStatus('Select some text first to apply color', 'warn'); return; }
        // Use execCommand when possible (foreColor/hiliteColor produce span/font).
        editor.focus();
        if (kind === 'text') {
            document.execCommand('styleWithCSS', false, true);
            document.execCommand('foreColor', false, color);
        } else {
            document.execCommand('styleWithCSS', false, true);
            // hiliteColor tidak didukung sebagian browser -> fallback backColor
            if (!document.execCommand('hiliteColor', false, color === 'transparent' ? 'transparent' : color)) {
                document.execCommand('backColor', false, color);
            }
        }
        markDirty();
    }

    let openDDMenu = null;
    function closeDD() { if (openDDMenu) { openDDMenu.classList.remove('open'); openDDMenu = null; document.removeEventListener('click', ddOutside); } }
    function ddOutside(e) { if (openDDMenu && openDDMenu.parentNode.contains(e.target)) return; closeDD(); }
    function toggleDD(menuEl) {
        if (openDDMenu === menuEl) { closeDD(); return; }
        closeDD(); menuEl.classList.add('open'); openDDMenu = menuEl;
        // Position as fixed under the trigger button so it is never clipped by overflow:hidden ancestors.
        const trigger = menuEl.parentNode.querySelector('button');
        if (trigger) {
            const r = trigger.getBoundingClientRect();
            menuEl.style.position = 'fixed';
            menuEl.style.top = (r.bottom + 3) + 'px';
            menuEl.style.left = r.left + 'px';
            // measure then clamp within viewport
            const mr = menuEl.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            let left = r.left, top = r.bottom + 3;
            if (left + mr.width > vw - 6) left = Math.max(6, vw - mr.width - 6);
            if (top + mr.height > vh - 6) top = Math.max(6, vh - mr.height - 6);
            menuEl.style.left = left + 'px';
            menuEl.style.top = top + 'px';
        }
        setTimeout(function () { document.addEventListener('click', ddOutside); }, 0);
    }

    const colorMenu = document.getElementById('nt-color-menu');
    const hiliteMenu = document.getElementById('nt-hilite-menu');
    const dateMenu = document.getElementById('nt-date-menu');
    buildSwatchMenu(colorMenu, TEXT_COLORS, function (c) { applyColor('text', c); });
    buildSwatchMenu(hiliteMenu, HILITE_COLORS, function (c) { applyColor('bg', c); });
    document.getElementById('nt-color-btn').addEventListener('click', function (e) { e.stopPropagation(); toggleDD(colorMenu); });
    document.getElementById('nt-hilite-btn').addEventListener('click', function (e) { e.stopPropagation(); toggleDD(hiliteMenu); });

    // Generic grouped dropdowns (Lists, Insert, File) triggered by [data-dd] buttons.
    document.querySelectorAll('#nt-toolbar [data-dd]').forEach(function (btn) {
        const menu = btn.parentNode.querySelector('.nt-dd-menu');
        if (!menu) return;
        btn.addEventListener('click', function (e) { e.stopPropagation(); toggleDD(menu); });
        // Close the dropdown after choosing an item inside it.
        menu.querySelectorAll('button').forEach(function (item) {
            item.addEventListener('click', function () { closeDD(); });
        });
    });

    // ===== Menu tanggal/waktu =====
    function dateFormats() {
        const d = new Date();
        const pad = function (n) { return String(n).padStart(2, '0'); };
        const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear();
        const long = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const longTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const medium = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        return [
            long + ' at ' + longTime,
            long,
            medium + ', ' + longTime,
            medium,
            longTime,
            dd + '/' + mm + '/' + yyyy,
            dd + '-' + mm + '-' + yyyy,
            yyyy + '-' + mm + '-' + dd,
            yyyy + '/' + mm + '/' + dd
        ];
    }
    document.getElementById('nt-date-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        dateMenu.innerHTML = '';
        dateFormats().forEach(function (f) {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'nt-date-item'; b.textContent = f;
            b.addEventListener('click', function (e2) {
                e2.stopPropagation();
                editor.focus();
                document.execCommand('insertText', false, f);
                closeDD(); markDirty();
            });
            dateMenu.appendChild(b);
        });
        toggleDD(dateMenu);
    });

    document.querySelectorAll('#nt-toolbar button[data-act]').forEach(function (b) {
        b.addEventListener('click', function () {
            const act = b.getAttribute('data-act');
            if (act === 'link') { const url = prompt('Link URL:', 'https://'); if (url) exec('createLink', url); }
            else if (act === 'hr') { exec('insertHorizontalRule'); }
            else if (act === 'details') {
                // Sisipkan bagian collapsible SEBAGAI blok tingkat atas (bukan di dalam <p>),
                // agar tersimpan & terbaca ulang dengan benar.
                const sel = window.getSelection();
                let innerHtml = '<p>Section content…</p>';
                if (sel && sel.rangeCount && !sel.isCollapsed) {
                    const frag = sel.getRangeAt(0).extractContents();
                    const tmp = document.createElement('div'); tmp.appendChild(frag);
                    innerHtml = tmp.innerHTML || innerHtml;
                }
                const det = document.createElement('details');
                det.open = true;
                det.innerHTML = '<summary>Section title</summary>' + innerHtml;
                // Find the top-level block where the cursor is, then insert after it.
                let anchor = null;
                if (sel && sel.rangeCount) {
                    let n = sel.getRangeAt(0).startContainer;
                    while (n && n.parentNode !== editor) n = n.parentNode;
                    anchor = n;
                }
                if (anchor && anchor.parentNode === editor) {
                    anchor.parentNode.insertBefore(det, anchor.nextSibling);
                } else {
                    editor.appendChild(det);
                }
                // Selalu sediakan paragraf kosong setelah collapsible agar bisa lanjut menulis di bawahnya.
                const after = document.createElement('p');
                after.appendChild(document.createElement('br'));
                det.parentNode.insertBefore(after, det.nextSibling);
                // pindahkan kursor ke paragraf baru
                const r = document.createRange(); r.setStart(after, 0); r.collapse(true);
                const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                editor.focus();
            }
            else if (act === 'table') {
                const rowsN = parseInt(prompt('Number of rows (excluding header):', '2') || '0', 10);
                const colsN = parseInt(prompt('Number of columns:', '3') || '0', 10);
                if (!rowsN || !colsN || rowsN < 1 || colsN < 1) return;
                let html = '<table><thead><tr>';
                for (let c = 0; c < colsN; c++) html += '<th>Column ' + (c + 1) + '</th>';
                html += '</tr></thead><tbody>';
                for (let r = 0; r < rowsN; r++) {
                    html += '<tr>';
                    for (let c = 0; c < colsN; c++) html += '<td>&nbsp;</td>';
                    html += '</tr>';
                }
                html += '</tbody></table>';
                // sisipkan sebagai blok tingkat atas
                const table = document.createElement('div'); table.innerHTML = html;
                const tbl = table.firstChild;
                const sel = window.getSelection();
                let anchor = null;
                if (sel && sel.rangeCount) { let n = sel.getRangeAt(0).startContainer; while (n && n.parentNode !== editor) n = n.parentNode; anchor = n; }
                if (anchor && anchor.parentNode === editor) anchor.parentNode.insertBefore(tbl, anchor.nextSibling);
                else editor.appendChild(tbl);
                // Always add an editable paragraph after the table so you can keep typing below it.
                const after = document.createElement('p'); after.appendChild(document.createElement('br'));
                tbl.parentNode.insertBefore(after, tbl.nextSibling);
                ensureEditableGaps();
                // put cursor into the paragraph after the table
                const rr = document.createRange(); rr.setStart(after, 0); rr.collapse(true);
                const ss = window.getSelection(); ss.removeAllRanges(); ss.addRange(rr);
                editor.focus(); markDirty();
            }
            else if (act === 'code') {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && !sel.isCollapsed) {
                    const range = sel.getRangeAt(0);
                    const text = range.toString();
                    if (/\n/.test(text)) {
                        // Multi-baris -> blok kode <pre> (bukan inline <code>).
                        insertCodeBlock(text);
                    } else {
                        const code = document.createElement('code');
                        code.appendChild(range.extractContents());
                        range.insertNode(code);
                    }
                }
                editor.focus();
            }
            else if (act === 'codeblock') {
                // Blok kode multi-baris. Ambil teks seleksi (bila ada) sebagai isi awal.
                const sel = window.getSelection();
                const seltext = (sel && sel.rangeCount && !sel.isCollapsed) ? sel.getRangeAt(0).toString() : '';
                insertCodeBlock(seltext);
                editor.focus();
            }
            markDirty();
        });

    // Sisipkan blok kode <pre> tingkat atas + paragraf kosong setelahnya, kursor di dalam <pre>.
    function insertCodeBlock(text) {
        const sel = window.getSelection();
        const pre = document.createElement('pre');
        pre.textContent = text || '';
        if (sel && sel.rangeCount && !sel.isCollapsed) sel.getRangeAt(0).deleteContents();
        // cari blok tingkat atas untuk menyisipkan setelahnya
        let anchor = null;
        if (sel && sel.rangeCount) { let n = sel.getRangeAt(0).startContainer; while (n && n.parentNode !== editor) n = n.parentNode; anchor = n; }
        if (anchor && anchor.parentNode === editor) anchor.parentNode.insertBefore(pre, anchor.nextSibling);
        else editor.appendChild(pre);
        const after = document.createElement('p'); after.appendChild(document.createElement('br'));
        pre.parentNode.insertBefore(after, pre.nextSibling);
        // taruh kursor di dalam <pre>
        const r = document.createRange();
        r.selectNodeContents(pre); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    });
    blockSel.addEventListener('change', function () {
        const v = blockSel.value;
        exec('formatBlock', v === 'p' ? 'P' : v.toUpperCase());
        markDirty();
    });

    const fontSel = document.getElementById('nt-font');
    fontSel.addEventListener('change', function () {
        const f = fontSel.value;
        editor.focus();
        const sel = window.getSelection();
        if (f && sel && sel.rangeCount && !sel.isCollapsed) {
            document.execCommand('styleWithCSS', false, true);
            document.execCommand('fontName', false, f);
        } else if (f) {
            setStatus('Select some text first to change the font', 'warn');
        }
        markDirty();
        fontSel.selectedIndex = 0; // reset to label
    });

    function markDirty() { dirty = true; setStatus('Unsaved…'); scheduleAutoSave(); }
    editor.addEventListener('input', markDirty);
    // Convert any typed literal "<br>" into a real line break when focus leaves the editor.
    editor.addEventListener('blur', function () { convertLiteralBr(editor); });

    // Shortcut: Ctrl+S simpan, Ctrl+B/I sudah default contenteditable
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
    });

    // Tab / Shift+Tab di dalam daftar: indent (buat sub-list) / outdent.
    // Di dalam blok kode <pre>: Enter menyisipkan baris baru; Enter pada baris kosong terakhir
    // keluar dari blok ke paragraf setelahnya. Tab menyisipkan 2 spasi.
    editor.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== 'Tab') return;
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        let node = sel.getRangeAt(0).startContainer;
        while (node && node !== editor && !(node.nodeType === 1 && node.tagName === 'PRE')) node = node.parentNode;
        if (!node || node.tagName !== 'PRE') return; // bukan di dalam pre
        const pre = node;
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertText', false, '  ');
            markDirty();
            return;
        }
        // Enter di dalam <pre>
        e.preventDefault();
        const text = pre.textContent;
        // Keluar bila blok berakhir dengan baris kosong (double-Enter) dan kursor di ujung.
        const atEnd = sel.getRangeAt(0).endOffset >= (sel.getRangeAt(0).endContainer.length || 0)
            && sel.getRangeAt(0).endContainer === pre.lastChild || sel.getRangeAt(0).endContainer === pre;
        if (/\n\s*$/.test(text) && atEnd) {
            // hapus newline kosong terakhir lalu pindah ke paragraf setelah pre
            pre.textContent = text.replace(/\n\s*$/, '');
            let after = pre.nextElementSibling;
            if (!after || after.tagName === 'PRE') {
                after = document.createElement('p'); after.appendChild(document.createElement('br'));
                pre.parentNode.insertBefore(after, pre.nextSibling);
            }
            const r = document.createRange(); r.setStart(after, 0); r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
        } else {
            document.execCommand('insertText', false, '\n');
        }
        markDirty();
    });

    editor.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        // hanya bila kursor berada di dalam <li>
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        let node = sel.getRangeAt(0).startContainer;
        while (node && node !== editor && !(node.nodeType === 1 && node.tagName === 'LI')) node = node.parentNode;
        if (!node || node.tagName !== 'LI') return;
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
        markDirty();
    });

    // ===================== Wire buttons =====================
    btnOpen.addEventListener('click', openFolder);
    document.getElementById('nt-up').addEventListener('click', goUp);
    btnNew.addEventListener('click', newFile);
    btnRefresh.addEventListener('click', listFolder);
    btnSave.addEventListener('click', saveNow);
    document.getElementById('nt-saveas').addEventListener('click', saveAs);
    document.getElementById('nt-pdf').addEventListener('click', exportPdf);
    btnRaw.addEventListener('click', function () { setRawMode(!rawMode); });
    rawArea.addEventListener('input', function () { dirty = true; setStatus('Unsaved…'); scheduleAutoSave(); });
    // Word-wrap toggle for the Raw textarea (default wrapped for readability).
    let rawWrap = true;
    function applyWrap() {
        rawArea.classList.toggle('nowrap', !rawWrap);
        btnWrap.classList.toggle('active', rawWrap);
    }
    btnWrap.addEventListener('click', function () { rawWrap = !rawWrap; applyWrap(); });
    applyWrap();

    // Export to PDF: open a print window with the editor content + styles, then print (Save as PDF).
    function exportPdf() {
        const title = (currentFileName || 'notes').replace(/\.[^.]+$/, '');
        // Ensure raw edits are reflected first.
        if (rawMode) setRawMode(false);
        // Open all <details> so their content is printed too.
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('details').forEach(function (d) { d.setAttribute('open', ''); });
        const win = window.open('', '_blank');
        if (!win) { alert('Popup blocked. Please allow popups to export PDF.'); return; }
        const css =
            'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933;line-height:1.6;max-width:800px;margin:24px auto;padding:0 16px;}' +
            'h1{font-size:1.8rem}h2{font-size:1.4rem}h3{font-size:1.2rem}' +
            'blockquote{border-left:3px solid #1f6feb;margin:.5rem 0;padding:.2rem .8rem;color:#52606d;background:#f7f9fb}' +
            'pre{background:#1f2933;color:#e4e7eb;padding:.7rem .9rem;border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}' +
            'code{background:#eef2f6;padding:.1rem .3rem;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}' +
            'pre code{background:transparent;padding:0}' +
            'table{border-collapse:collapse;width:100%;margin:.6rem 0}th,td{border:1px solid #cbd2d9;padding:.4rem .6rem;text-align:left}th{background:#f0f3f6}' +
            'details{border:1px solid #cbd2d9;border-radius:6px;padding:.4rem .7rem;margin:.5rem 0}summary{font-weight:600}' +
            'hr{border:none;border-top:1px solid #cbd2d9;margin:1rem 0}a{color:#1f6feb}img{max-width:100%}' +
            '@media print{body{max-width:none;margin:0}pre,code,table{white-space:pre-wrap;word-break:break-word}}';
        win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title +
            '</title><style>' + css + '</style></head><body>' + clone.innerHTML + '</body></html>');
        win.document.close();
        // beri jeda agar layout siap, lalu cetak
        win.focus();
        setTimeout(function () { win.print(); }, 300);
    }

    // Initial sample content
    editor.innerHTML = mdToHtml('# Welcome\n\nA WYSIWYG **Markdown** editor. Open a folder on the left to start.\n\n- Click *Open Folder*\n- Pick a `.md` file\n- Type, and **auto-save** will write it back to the file');
    ensureEditableGaps();

    // Mobile keyboard fallback: keep the toolbar pinned to the top of the VISIBLE area
    // (visual viewport) even when the on-screen keyboard shrinks the view. This complements
    // the `interactive-widget=resizes-content` viewport hint.
    (function stickyToolbarOnMobile() {
        const toolbar = document.getElementById('nt-toolbar');
        if (!toolbar || !window.visualViewport) return;
        const vv = window.visualViewport;
        function isMobile() { return window.matchMedia('(max-width: 760px)').matches; }
        function update() {
            if (!isMobile()) { toolbar.style.transform = ''; return; }
            // offsetTop of the visual viewport relative to layout viewport when scrolled with keyboard open
            const shift = Math.max(0, vv.offsetTop);
            toolbar.style.transform = shift ? ('translateY(' + shift + 'px)') : '';
        }
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        window.addEventListener('scroll', update, { passive: true });
    })();
})();
