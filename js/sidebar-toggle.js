// Collapse/expand the file-explorer sidebar. Shared by all tools.
// Any element with [data-sidebar-toggle] toggles the `.sidebar-collapsed` class on the
// nearest layout wrapper (.dg-wrap, .sq-wrap, or .nt-layout). State is remembered per page.
(function () {
    'use strict';
    const KEY = 'tools.sidebar.collapsed.' + location.pathname;
    const wrap = document.querySelector('.dg-wrap, .sq-wrap, .nt-layout');
    if (!wrap) return;

    function apply(collapsed) {
        wrap.classList.toggle('sidebar-collapsed', collapsed);
        try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) {}
    }

    // restore
    let init = false;
    try { init = localStorage.getItem(KEY) === '1'; } catch (e) {}
    wrap.classList.toggle('sidebar-collapsed', init);

    document.querySelectorAll('[data-sidebar-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            apply(!wrap.classList.contains('sidebar-collapsed'));
        });
    });
})();
