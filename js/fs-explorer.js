// Reusable local-folder explorer using the File System Access API.
// Shared by Flow, Free, and Sequence diagrams (and mirrors the Notes editor UX):
// open folder, browse/enter subfolders, go up, new file, open file, rename, delete, auto-save.
//
// Usage:
//   const explorer = createFsExplorer({
//     ids: { tree, folderName, hint, open, up, newFile, refresh, status },
//     ext: 'json',                       // primary extension for new files
//     accept: /\.(json)$/i,              // which files to list
//     getContent: () => string,          // current document as text (to save)
//     setContent: (text, name) => {},    // load text into the tool
//     newContent: () => string           // initial content for a new file
//   });
//   explorer.markDirty();                // call whenever the document changes (triggers auto-save)
window.createFsExplorer = function (opts) {
    'use strict';
    const treeEl = document.getElementById(opts.ids.tree);
    const folderNameEl = document.getElementById(opts.ids.folderName);
    const hintEl = opts.ids.hint ? document.getElementById(opts.ids.hint) : null;
    const statusEl = opts.ids.status ? document.getElementById(opts.ids.status) : null;
    const btnOpen = document.getElementById(opts.ids.open);
    const btnUp = document.getElementById(opts.ids.up);
    const btnNew = document.getElementById(opts.ids.newFile);
    const btnRefresh = document.getElementById(opts.ids.refresh);
    const autosaveChk = opts.ids.autosave ? document.getElementById(opts.ids.autosave) : null;

    const ext = opts.ext || 'json';
    const accept = opts.accept || /\.(json)$/i;
    const hasFS = !!(window.showDirectoryPicker);

    let dirHandle = null, dirStack = [];
    let currentFileHandle = null, currentFileName = null;
    let dirty = false, saveTimer = null;

    if (!hasFS && hintEl) {
        hintEl.textContent = 'This browser does not support local folder access. Use Chrome/Edge for the explorer & auto-save.';
    }

    function setStatus(text, kind) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.className = (statusEl.className.replace(/\s*nt-status\S*/g, '').trim() + ' nt-status' + (kind ? ' ' + kind : '')).trim();
    }

    async function openFolder() {
        if (!hasFS) { alert('This browser does not support folder access. Use Chrome/Edge.'); return; }
        try { dirHandle = await window.showDirectoryPicker(); }
        catch (err) { if (err && err.name === 'AbortError') return; alert('Failed to open folder: ' + err.message); return; }
        dirStack = [dirHandle];
        btnNew.disabled = false; btnRefresh.disabled = false;
        updateUpBtn();
        await listFolder();
    }

    function updateUpBtn() {
        btnUp.disabled = !dirHandle;
        btnUp.title = dirStack.length > 1 ? 'Go up one level' : 'At the top folder — click to pick another folder';
        folderNameEl.textContent = dirStack.map(function (h) { return h.name; }).join(' / ') || (dirHandle ? dirHandle.name : '');
    }

    async function goUp() {
        if (dirStack.length > 1) { dirStack.pop(); dirHandle = dirStack[dirStack.length - 1]; updateUpBtn(); await listFolder(); }
        else { await openFolder(); }
    }

    async function listFolder() {
        treeEl.innerHTML = '';
        if (!dirHandle) return;
        const entries = [];
        for await (const [name, handle] of dirHandle.entries()) {
            entries.push({ name: name, handle: handle, dir: handle.kind === 'directory' });
        }
        entries.sort(function (a, b) { if (a.dir !== b.dir) return a.dir ? -1 : 1; return a.name.localeCompare(b.name); });
        entries.forEach(function (e) {
            if (!e.dir && !accept.test(e.name)) return;
            const li = document.createElement('li');
            li.className = 'nt-item' + (e.dir ? ' nt-dir' : '');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'nt-item-name';
            nameSpan.textContent = (e.dir ? '📁 ' : '📄 ') + e.name;
            li.appendChild(nameSpan);
            if (e.dir) {
                nameSpan.addEventListener('click', async function () { dirHandle = e.handle; dirStack.push(e.handle); updateUpBtn(); await listFolder(); });
            } else {
                nameSpan.addEventListener('click', function () { openFile(e.handle, e.name, li); });
                const act = document.createElement('button');
                act.className = 'nt-item-act'; act.type = 'button'; act.textContent = '⋯';
                act.title = 'File actions (rename / delete)';
                act.addEventListener('click', function (ev) { ev.stopPropagation(); showFileMenu(ev, e.name, e.handle); });
                li.appendChild(act);
            }
            treeEl.appendChild(li);
        });
        if (!treeEl.children.length) {
            const li = document.createElement('li'); li.className = 'nt-empty';
            li.textContent = 'No .' + ext + ' files';
            treeEl.appendChild(li);
        }
    }

    async function openFile(handle, name, li) {
        if (dirty && currentFileHandle) { await saveNow(); }
        try {
            const file = await handle.getFile();
            const text = await file.text();
            currentFileHandle = handle; currentFileName = name;
            opts.setContent(text, name);
            dirty = false; setStatus('Opened: ' + name);
            treeEl.querySelectorAll('.nt-item.active').forEach(function (x) { x.classList.remove('active'); });
            if (li) li.classList.add('active');
        } catch (err) { alert('Failed to open file: ' + err.message); }
    }

    async function newFile() {
        if (!dirHandle) return;
        let name = prompt('New file name (e.g. diagram.' + ext + '):', 'new-' + ext + '.' + ext);
        if (!name) return;
        name = name.trim().replace(/[\\/:*?"<>|]/g, '_');
        if (!accept.test(name)) name += '.' + ext;
        try {
            const handle = await dirHandle.getFileHandle(name, { create: true });
            const w = await handle.createWritable(); await w.write(opts.newContent ? opts.newContent() : ''); await w.close();
            await listFolder();
            const li = Array.prototype.find.call(treeEl.children, function (x) { return x.textContent.indexOf(name) !== -1; });
            openFile(handle, name, li);
        } catch (err) { alert('Failed to create file: ' + err.message); }
    }

    // ===== File actions menu (rename / delete) =====
    let fileMenuEl = null;
    function closeFileMenu() { if (fileMenuEl) { fileMenuEl.remove(); fileMenuEl = null; } document.removeEventListener('click', fileMenuOutside); }
    function fileMenuOutside(e) { if (fileMenuEl && fileMenuEl.contains(e.target)) return; closeFileMenu(); }
    function showFileMenu(ev, name, handle) {
        closeFileMenu();
        const menu = document.createElement('div');
        menu.className = 'dg-menu';
        const t = ev.touches ? ev.touches[0] : ev;
        menu.style.left = (t.clientX + 2) + 'px'; menu.style.top = (t.clientY + 2) + 'px';
        function item(text, onClick) {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
            b.addEventListener('click', function (e2) { e2.stopPropagation(); closeFileMenu(); onClick(); });
            menu.appendChild(b);
        }
        item('Rename…', function () { renameFile(name, handle); });
        item('Delete', function () { deleteFile(name, handle); });
        document.body.appendChild(menu); fileMenuEl = menu;
        const r = menu.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
        let left = parseFloat(menu.style.left), top = parseFloat(menu.style.top);
        if (left + r.width > vw - 6) left = Math.max(6, vw - r.width - 6);
        if (top + r.height > vh - 6) top = Math.max(6, vh - r.height - 6);
        menu.style.left = left + 'px'; menu.style.top = top + 'px';
        setTimeout(function () { document.addEventListener('click', fileMenuOutside); }, 0);
    }

    async function renameFile(oldName, handle) {
        if (!dirHandle) return;
        let name = prompt('Rename file to:', oldName);
        if (name === null) return;
        name = name.trim().replace(/[\\/:*?"<>|]/g, '_'); if (!name) return;
        if (!accept.test(name)) name += '.' + ext;
        if (name === oldName) return;
        try {
            const src = await handle.getFile(); const content = await src.text();
            const newHandle = await dirHandle.getFileHandle(name, { create: true });
            const w = await newHandle.createWritable(); await w.write(content); await w.close();
            await dirHandle.removeEntry(oldName);
            if (currentFileName === oldName) { currentFileHandle = newHandle; currentFileName = name; }
            await listFolder(); setStatus('Renamed to ' + name, 'ok');
        } catch (err) { alert('Failed to rename: ' + err.message); }
    }

    async function deleteFile(name, handle) {
        if (!dirHandle) return;
        if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
        try {
            await dirHandle.removeEntry(name);
            if (currentFileName === name) { currentFileHandle = null; currentFileName = null; setStatus('File deleted', 'ok'); }
            else setStatus('Deleted ' + name, 'ok');
            await listFolder();
        } catch (err) { alert('Failed to delete: ' + err.message); }
    }

    async function saveNow() {
        if (!currentFileHandle) { return saveAs(); }
        try {
            const w = await currentFileHandle.createWritable(); await w.write(opts.getContent()); await w.close();
            dirty = false; setStatus('Saved \u2022 ' + new Date().toLocaleTimeString(), 'ok');
        } catch (err) { setStatus('Save failed: ' + err.message, 'warn'); }
    }

    async function saveAs() {
        const content = opts.getContent();
        const suggested = currentFileName || ('diagram.' + ext);
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({ suggestedName: suggested,
                    types: [{ description: ext.toUpperCase() + ' file', accept: { 'application/octet-stream': ['.' + ext] } }] });
                const w = await handle.createWritable(); await w.write(content); await w.close();
                currentFileHandle = handle; currentFileName = handle.name;
                dirty = false; setStatus('Saved as ' + handle.name, 'ok');
                if (dirHandle) listFolder();
                return;
            } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        let name = prompt('Save as (file name):', suggested);
        if (name === null) return;
        name = (name.trim() || suggested).replace(/[\\/:*?"<>|]/g, '_');
        if (!accept.test(name)) name += '.' + ext;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        setStatus('Downloaded: ' + name, 'ok');
    }

    function scheduleAutoSave() {
        if (autosaveChk && !autosaveChk.checked) return;
        if (!currentFileHandle) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 1000);
    }

    function markDirty() { dirty = true; if (currentFileHandle) setStatus('Unsaved…'); scheduleAutoSave(); }

    // wire buttons
    btnOpen.addEventListener('click', openFolder);
    btnUp.addEventListener('click', goUp);
    btnNew.addEventListener('click', newFile);
    btnRefresh.addEventListener('click', listFolder);

    return { markDirty: markDirty, saveNow: saveNow, saveAs: saveAs, hasFS: hasFS };
};
