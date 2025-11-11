// UI: fetch, controls, zoom/pan, centering, search, settings
(function(){
  /* ---------- Base Path Detection for GitHub Pages ---------- */
  // Detect base path for subdirectory deployments (e.g., /Uncritical-Fabulation/)
  function getBasePath() {
    const pathname = window.location.pathname;
    // Remove trailing filename (index.html) if present
    const basePath = pathname.replace(/\/[^/]*$/, '');
    // Ensure it ends with / and starts with /
    return basePath === '' ? '' : (basePath.endsWith('/') ? basePath : basePath + '/');
  }

  const BASE_PATH = getBasePath();

  // Helper function to resolve paths relative to base
  function resolvePath(path) {
    // If path already starts with http:// or https://, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    // If path starts with /, it's absolute from domain root, so prepend base path
    if (path.startsWith('/')) {
      return BASE_PATH + path.slice(1);
    }
    // Otherwise, it's relative, so prepend base path
    return BASE_PATH + path;
  }

  const stage = document.getElementById('stage');
  const svgEl = document.getElementById('svg');
  const svg = d3.select(svgEl);

  const ui = {
    gearBtn: document.getElementById('btn-gear'),
    panel: document.getElementById('panel'),
    closePanelBtn: document.getElementById('btn-close-panel'),

    selLayout: document.getElementById('sel-layout'),
    selMetric: document.getElementById('sel-metric'),
    selProbDisplay: document.getElementById('sel-prob-display'),

    numGapX: document.getElementById('num-gapx'),
    numAltGap: document.getElementById('num-altgap'),
    numTok: document.getElementById('num-font-tok'),
    numMeta: document.getElementById('num-font-meta'),
    numPadT: document.getElementById('num-pad-t'),
    numPadB: document.getElementById('num-pad-b'),
    numPadX: document.getElementById('num-pad-x'),
    numLabelMax: document.getElementById('num-label-max'),
    numCFloor: document.getElementById('num-cfloor'),
    numCCap: document.getElementById('num-ccap'),

    applyBtn: document.getElementById('btn-apply'),

    clusterSel: document.getElementById('cluster-select'),

    searchInp: document.getElementById('search'),
    searchBtn: document.getElementById('btn-search'),
    prevBtn:   document.getElementById('btn-prev'),
    nextBtn:   document.getElementById('btn-next'),
    matchCount:document.getElementById('match-count'),
    loadingSpinner: document.getElementById('loading-spinner'),

    searchScopeBtn: document.getElementById('search-scope-btn'),
    searchScopeMenu: document.getElementById('search-scope-menu'),
    searchScopeOptions: document.querySelectorAll('.search-scope-option'),

    zoomIn:  document.getElementById('zoom-in'),
    zoomOut: document.getElementById('zoom-out'),
    zoomPct: document.getElementById('zoom-pct'),

    saveBtn: document.getElementById('btn-save'),
    shareBtn: document.getElementById('btn-share'),

    themeSel: document.getElementById('sel-theme'),
    chkPredictedPaths: document.getElementById('chk-predicted-paths'),
  };


  /* ---------- Config Integration ---------- */
  const CFG = (window.APP_CONFIG || {});

  // Helper to set initial form values from config (use existing defaults if not provided)
  function applyConfigToForm(cfg) {
    if (cfg.LAYOUT)      ui.selLayout.value = cfg.LAYOUT;
    if (cfg.MAIN_METRIC) ui.selMetric.value = cfg.MAIN_METRIC;
    if (cfg.PROB_DISPLAY) ui.selProbDisplay.value = cfg.PROB_DISPLAY;
    if (cfg.THEME)       ui.themeSel.value = cfg.THEME;

    if (cfg.GAP_X != null)       ui.numGapX.value = cfg.GAP_X;
    if (cfg.ALT_GAP != null)     ui.numAltGap.value = cfg.ALT_GAP;
    if (cfg.TOKEN_FPX != null)   ui.numTok.value = cfg.TOKEN_FPX;
    if (cfg.META_FPX != null)    ui.numMeta.value = cfg.META_FPX;
    if (cfg.PAD_T != null)       ui.numPadT.value = cfg.PAD_T;
    if (cfg.PAD_B != null)       ui.numPadB.value = cfg.PAD_B;
    if (cfg.PAD_X != null)       ui.numPadX.value = cfg.PAD_X;
    if (cfg.LABEL_MAX != null)   ui.numLabelMax.value = cfg.LABEL_MAX;
    if (cfg.COLOR_FLOOR != null) ui.numCFloor.value = cfg.COLOR_FLOOR;
    if (cfg.COLOR_CAP != null)   ui.numCCap.value = cfg.COLOR_CAP;

    if (cfg.SHOW_PREDICTED_PATHS != null) ui.chkPredictedPaths.checked = cfg.SHOW_PREDICTED_PATHS;
  }

  // Apply config to form first so UI shows the configured defaults
  applyConfigToForm(CFG);

  /* ---------- Theme Management ---------- */
  const THEME_KEY = 'token-tree-theme';

  function applyTheme(theme) {
    // Remove existing theme attributes
    document.documentElement.removeAttribute('data-theme');

    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    // For 'auto', let CSS media queries handle it
  }

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getEffectiveTheme(theme) {
    if (theme === 'auto') {
      return getSystemTheme();
    }
    return theme;
  }

  function saveThemePreference(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.warn('Could not save theme preference:', e);
    }
  }

  function loadThemePreference() {
    try {
      return localStorage.getItem(THEME_KEY) || 'auto';
    } catch (e) {
      console.warn('Could not load theme preference:', e);
      return 'auto';
    }
  }

  function initializeTheme() {
    const savedTheme = loadThemePreference();
    if (ui.themeSel) {
      ui.themeSel.value = savedTheme;
    }
    applyTheme(savedTheme);
  }

  // Listen for system theme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      // Only update if user is using auto theme
      const currentTheme = loadThemePreference();
      if (currentTheme === 'auto') {
        applyTheme('auto');
      }
    });
  }

  // Theme selector change handler
  if (ui.themeSel) {
    ui.themeSel.addEventListener('change', (e) => {
      const selectedTheme = e.target.value;
      applyTheme(selectedTheme);
      saveThemePreference(selectedTheme);
    });
  }

  // Show predicted paths checkbox change handler
  if (ui.chkPredictedPaths) {
    ui.chkPredictedPaths.addEventListener('change', (e) => {
      const showPredictedPaths = e.target.checked;
      // Update the setting immediately
      VIZ.setSettings({ SHOW_PREDICTED_PATHS: showPredictedPaths });
      // Re-layout and render to show/hide ghosts
      lastBBox = VIZ.layoutAndRender();

      const usedDeepLink = applyHashViewAfterLayout();
      if (!usedDeepLink) {
        centerOnBounds();
      }

      updateZoomUI(d3.zoomTransform(svgEl).k);
    });
  }


  function centerOnBounds() {
  if (!lastBBox) return;
  const cxY = lastBBox.minY + lastBBox.width / 2;            // horizontal center in content coords
  const cxX = (lastBBox.minX + lastBBox.maxX) / 2;           // vertical center in content coords
  centerOnXY(cxY, cxX);
}

function syncLayoutSelectWithViz() {
  const s = VIZ.getSettings();
  if (ui.selLayout && s && s.LAYOUT) {
    ui.selLayout.value = s.LAYOUT;
  }
}

function relayoutOnce({ center = 'prompt' } = {}) {
  lastBBox = VIZ.layoutAndRender();       // triggers one render inside VIZ
  applyZoomBounds();                      // do NOT reapply transform here
  if (center === 'prompt') {
    const prompt = VIZ.getPromptNode();
    if (prompt) centerOnNode(prompt); else centerOnBounds();
  } else if (center === 'bounds') {
    centerOnBounds();
  }
  updateZoomUI(d3.zoomTransform(svgEl).k);
  clampScroll();
  syncLayoutSelectWithViz();
}


  /* ---------- Init VIZ ---------- */
  VIZ.init({stageEl:stage, svgEl});
  
  // Set initial settings from config before first layout
  if (window.APP_CONFIG) {
    VIZ.setSettings(window.APP_CONFIG);
  }

  /* ---------- Scroll/Pan Clamping ---------- */
  let lastBBox = null;
  let suppressScroll = false;
  // Prevent clampScroll() from running while we programmatically jump to a deep-link view
  let skipClampOnce = false;
function applyZoomBounds() {
  if (!lastBBox) return;

  const bufX = 0.08 * lastBBox.width;
  const bufY = 0.08 * lastBBox.height;

  zoom
    .extent([[0, 0], [stage.clientWidth, stage.clientHeight]])
    .translateExtent([
      [(lastBBox.minY - lastBBox.pad) - bufX, (lastBBox.minX - lastBBox.pad) - bufY],
      [(lastBBox.maxY + lastBBox.pad) + bufX, (lastBBox.maxX + lastBBox.pad) + bufY]
    ]);

  // IMPORTANT: do NOT force-clamp here.
  // (Remove: svg.call(zoom.transform, d3.zoomTransform(svgEl));)
}


  function clampScroll() {
    if (!lastBBox || suppressScroll || skipClampOnce) return;
    
    const t = d3.zoomTransform(svgEl);
    const k = t.k;
    
    // Content bounds in screen pixels
    const left = (lastBBox.minY - lastBBox.pad) * k + t.x;
    const right = (lastBBox.maxY + lastBBox.pad) * k + t.x;
    const top = (lastBBox.minX - lastBBox.pad) * k + t.y;
    const bottom = (lastBBox.maxX + lastBBox.pad) * k + t.y;
    
    // Buffer in screen pixels
    const bufPX = 0.08 * lastBBox.width * k;
    const bufPY = 0.08 * lastBBox.height * k;
    
    // Valid scroll ranges
    const minSL = Math.max(0, left - bufPX);
    const maxSL = Math.max(0, right + bufPX - stage.clientWidth);
    const minST = Math.max(0, top - bufPY);
    const maxST = Math.max(0, bottom + bufPY - stage.clientHeight);
    
    // Clamp scroll position
    suppressScroll = true;
    if (stage.scrollLeft < minSL) stage.scrollLeft = minSL;
    if (stage.scrollLeft > maxSL) stage.scrollLeft = maxSL;
    if (stage.scrollTop < minST) stage.scrollTop = minST;
    if (stage.scrollTop > maxST) stage.scrollTop = maxST;
    suppressScroll = false;
  }

  /* ---------- Zoom (cursor-anchored with Shift + wheel; drag to pan) ---------- */
  let lastPointer = [stage.clientWidth/2, stage.clientHeight/2];

  const zoom = d3.zoom()
    .scaleExtent([0.02, 8])
    .filter((event) => {
      if (event.type === 'wheel') return false;   // disable wheel zoom → native scroll
      if (event.type === 'mousedown') return true; // allow drag-to-pan
      if (event.type === 'touchstart') return false;
      return true;
    })
    .on('start', ()=> svgEl.classList.add('dragging'))
    .on('end',   ()=> svgEl.classList.remove('dragging'))
    .on('zoom', (event) => {
      VIZ.setTransform(event.transform);
      updateZoomUI(event.transform.k);
      clampScroll();

      // Write the current view back to the URL (keeps cluster param intact)
      const view = currentViewFromTransform(event.transform);
      const clusterId = ui.clusterSel?.value || getUrlClusterId();
      writeViewToUrl(view, clusterId);
    });

  svg.call(zoom);

  // Shift + two-finger zoom around cursor
  stage.addEventListener('wheel', (e)=>{
    const absX = Math.abs(e.deltaX), absY = Math.abs(e.deltaY);
    if ((e.shiftKey || e.ctrlKey) && absY >= absX) {
      e.preventDefault();
      const pointer = d3.pointer(e, svgEl);
      lastPointer = pointer;
      const factor = Math.pow(1.0015, -e.deltaY);
      svg.call(zoom.scaleBy, factor, pointer);
    }
  }, { passive: false });

  // Track cursor for zoom button anchoring
  stage.addEventListener('mousemove', (e)=> { lastPointer = d3.pointer(e, svgEl); }, { passive:true });

  // Zoom buttons
  ui.zoomIn.addEventListener('click', ()=> svg.call(zoom.scaleBy, 1.2, lastPointer));
  ui.zoomOut.addEventListener('click',()=> svg.call(zoom.scaleBy, 1/1.2, lastPointer));

  function updateZoomUI(k){
    ui.zoomPct.textContent = `${Math.round((k||1)*100)}%`;
  }

  // Re-render visible items on scroll (virtualization)
  stage.addEventListener('scroll', () => {
    VIZ.renderVisible();
    clampScroll();
    updateViewInUrl(); // <— reflect scroll changes as well
  }, { passive: true });

  /* ---------- Centering helpers ---------- */
  function centerOnXY(x, y, k=null){
    const t = d3.zoomTransform(svgEl);
    const kNext = (k==null ? t.k : k);

    // IMPORTANT: account for the scroll position
    const cxScreen = stage.scrollLeft + stage.clientWidth  / 2;
    const cyScreen = stage.scrollTop  + stage.clientHeight / 2;

    const tx = cxScreen - x * kNext;
    const ty = cyScreen - y * kNext;

    const next = d3.zoomIdentity.translate(tx, ty).scale(kNext);
    svg.call(zoom.transform, next);
  }
  function centerOnNode(node, options = {}){
    if (!node) return;

    // Determine target zoom level
    const currentZoom = d3.zoomTransform(svgEl).k;
    const minZoom = 0.23; // 23% zoom level

    // Only zoom in if current zoom is less than minimum
    const targetZoom = currentZoom < minZoom ? minZoom : currentZoom;

    centerOnXY(node.y + node.w/2, node.x, targetZoom);
  }
  function centerOnPrompt(){
    const prompt = VIZ.getPromptNode();
    if (prompt) centerOnNode(prompt);
  }

  /* ---------- Deep-link helpers (hash params: cluster, k, cx, cy) ---------- */
  function getHashParams() {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    return new URLSearchParams(raw);
  }
  function setHashParams(params) {
    const str = params.toString();
    window.history.replaceState({}, '', '#' + str);
  }
  function readViewFromUrl() {
    const p = getHashParams();
    const k  = parseFloat(p.get('k'));
    const cx = parseFloat(p.get('cx'));
    const cy = parseFloat(p.get('cy'));
    if (Number.isFinite(k) && Number.isFinite(cx) && Number.isFinite(cy)) return { k, cx, cy };
    return null;
  }
  function writeViewToUrl({ k, cx, cy }, clusterId) {
    const p = getHashParams();
    if (clusterId) p.set('cluster', clusterId);
    if (Number.isFinite(k))  p.set('k',  k.toFixed(3));
    if (Number.isFinite(cx)) p.set('cx', cx.toFixed(1));
    if (Number.isFinite(cy)) p.set('cy', cy.toFixed(1));
    setHashParams(p);
  }
  function getUrlClusterId() {
    const p = getHashParams();
    return p.get('cluster') || null;
  }
  function setClusterInUrl(clusterId, { clearView=true } = {}) {
    const p = getHashParams();
    p.set('cluster', clusterId);
    if (clearView) { p.delete('k'); p.delete('cx'); p.delete('cy'); }
    setHashParams(p);
  }

  // Search URL parameter helpers
  function getUrlSearchQuery() {
    const p = getHashParams();
    return p.get('q') || '';
  }
  function getUrlSearchScope() {
    const p = getHashParams();
    return p.get('scope') || 'current';
  }
  function getUrlSearchMatch() {
    const p = getHashParams();
    const match = parseInt(p.get('match'));
    return Number.isFinite(match) ? match : 0;
  }
  function writeSearchToUrl(query, scope, matchIndex = 0) {
    const p = getHashParams();
    if (query) {
      p.set('q', query);
      p.set('scope', scope);
      p.set('match', matchIndex.toString());
    } else {
      p.delete('q');
      p.delete('scope');
      p.delete('match');
    }
    setHashParams(p);
  }

  // Compute the current content center (cx, cy) under transform t
  function currentViewFromTransform(t) {
    const k = t.k || 1;
    const cx = (stage.clientWidth  / 2 - t.x) / k;
    const cy = (stage.clientHeight / 2 - t.y) / k;
    return { k, cx, cy };
  }

  // Apply deep-linked view if present. Return true if applied.
  function applyDeepLinkIfPresent() {
    const v = readViewFromUrl();
    if (!v) return false;
    // Optional: clamp to current bbox if available
    if (lastBBox) {
      v.cx = Math.min(Math.max(v.cx, lastBBox.minY), lastBBox.maxY);
      v.cy = Math.min(Math.max(v.cy, lastBBox.minX), lastBBox.maxX);
    }
    centerOnXY(v.cx, v.cy, v.k);
    return true;
  }

  function applyHashViewAfterLayout() {
    const v = readViewFromUrl();
    if (!v) return false;

    // Temporarily remove translateExtent so the jump isn't clamped
    zoom.translateExtent([[-1e12, -1e12], [1e12, 1e12]]);

    // Do not allow clampScroll() to fight this jump on the same frame
    skipClampOnce = true;

    // Apply requested view (cx = horizontal world coord, cy = vertical world coord)
    centerOnXY(v.cx, v.cy, v.k);

    // Restore real bounds, but do NOT force a transform here
    applyZoomBounds();

    // Let one frame paint, then re-enable clamping
    requestAnimationFrame(() => { skipClampOnce = false; });

    return true;
  }

  /* ---------- Settings panel ---------- */
  function readSettingsFromForm(){
    return {
      LAYOUT:      ui.selLayout.value,
      MAIN_METRIC: ui.selMetric.value,
      PROB_DISPLAY: ui.selProbDisplay.value,
      THEME:       ui.themeSel.value,
      SHOW_PREDICTED_PATHS: ui.chkPredictedPaths.checked,
      GAP_X:       +ui.numGapX.value || 400,
      ALT_GAP:     +ui.numAltGap.value || 30,
      TOKEN_FPX:   +ui.numTok.value || 16,
      META_FPX:    +ui.numMeta.value || 12,
      PAD_T:       +ui.numPadT.value || 10,
      PAD_B:       +ui.numPadB.value || 10,
      PAD_X:       +ui.numPadX.value || 10,
      LABEL_MAX:   +ui.numLabelMax.value || 520,
      COLOR_FLOOR: +ui.numCFloor.value || 0.02,
      COLOR_CAP:   +ui.numCCap.value || 0.60,
    };
  }
  function openPanel(){
    ui.panel.classList.add('open');
  }
  function closePanel(){
    ui.panel.classList.remove('open');
  }
  ui.gearBtn.addEventListener('click', ()=>{
    if (ui.panel.classList.contains('open')) closePanel(); else openPanel();
  });
  ui.closePanelBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e)=>{
    if ((e.metaKey||e.ctrlKey) && e.key==='/'){
      e.preventDefault();
      if (ui.panel.classList.contains('open')) closePanel(); else openPanel();
    }
  });
ui.applyBtn.addEventListener('click', ()=>{
  VIZ.setSettings(readSettingsFromForm());
  lastBBox = VIZ.layoutAndRender();

  const usedDeepLink = applyHashViewAfterLayout();
  if (!usedDeepLink) {
    // When switching layouts, always center on bounds since prompt node position changes
    centerOnBounds();
  }

  updateZoomUI(d3.zoomTransform(svgEl).k);
});

  /* ---------- Search ---------- */
  let searchMatches = [];
  let searchIndex = -1;
  let currentSearchScope = 'current'; // 'current' or 'all'
  let tokenIndex = {}; // Loaded from token_index.json
  let crossClusterMatches = []; // For all-clusters search: [{clusterId, localIndex, node}]

  // Load token index for cross-cluster search
  async function loadTokenIndex() {
    try {
      const response = await fetch(resolvePath('cluster_json/token_index.json'));
      if (response.ok) {
        tokenIndex = await response.json();
        console.log(`Loaded token index with ${Object.keys(tokenIndex).length} tokens`);
      }
    } catch (err) {
      console.warn('Could not load token index:', err);
    }
  }

  function updateMatchCount(){
    const hasActiveSearch = (ui.searchInp.value || '').trim().length > 0;
    const hasResults = searchMatches.length > 0 || crossClusterMatches.length > 0;

    if (currentSearchScope === 'all' && crossClusterMatches.length > 0) {
      ui.matchCount.textContent = `${Math.max(0,searchIndex+1)}/${crossClusterMatches.length}`;
    } else {
      ui.matchCount.textContent = `${Math.max(0,searchIndex+1)}/${searchMatches.length}`;
    }

    // Show match count only when there's an active search
    // Hide it completely when no search is being performed
    if (ui.matchCount) {
      ui.matchCount.style.display = hasActiveSearch ? 'block' : 'none';
    }
  }

  // Update search scope UI
  function updateSearchScopeUI() {
    ui.searchScopeOptions.forEach(option => {
      option.classList.toggle('active', option.dataset.scope === currentSearchScope);
    });
    updateSearchScopeIcon();
  }

  // Update search scope icon (outline vs filled)
  function updateSearchScopeIcon() {
    if (ui.searchScopeBtn) {
      ui.searchScopeBtn.classList.toggle('filled', currentSearchScope === 'all');
      ui.searchScopeBtn.classList.toggle('outline', currentSearchScope === 'current');
    }
  }

  function runSearch(jumpToFirst=true){
    const q = (ui.searchInp.value||'').trim();
    const res = VIZ.runSearch(q);
    searchMatches = VIZ.getSearchMatches();
    if (res.count && jumpToFirst){
      searchIndex = 0;
      jumpTo(searchIndex, false);
    } else {
      searchIndex = -1;
    }
    updateMatchCount();
  }

  function jumpTo(i, wrap=true){
    if (!searchMatches.length) return;
    if (wrap !== false){
      if (i<0) i = searchMatches.length-1;
      if (i>=searchMatches.length) i = 0;
    } else {
      i = Math.max(0, Math.min(searchMatches.length-1, i));
    }
    searchIndex = i;
    const node = VIZ.getPlacedNode(searchMatches[searchIndex]);
    centerOnNode(node);
    updateMatchCount();
  }

  ui.searchInp.addEventListener('keydown', (e)=>{ if (e.key==='Enter') runSearch(true); });
  
  // Hide match count immediately when user starts typing (before pressing Enter)
  ui.searchInp.addEventListener('input', ()=> {
    if (ui.matchCount) {
      ui.matchCount.style.display = 'none';
    }
  });
  
  ui.prevBtn.addEventListener('click', ()=> jumpTo(searchIndex-1));
  ui.nextBtn.addEventListener('click', ()=> jumpTo(searchIndex+1));

  // Search scope dropdown handlers
  if (ui.searchScopeBtn && ui.searchScopeMenu) {
    ui.searchScopeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.searchScopeMenu.classList.toggle('open');
    });

    ui.searchScopeOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const newScope = option.dataset.scope;
        if (newScope && newScope !== currentSearchScope) {
          currentSearchScope = newScope;
          updateSearchScopeUI();
          ui.searchScopeMenu.classList.remove('open');

          // Re-run search if there's a query
          const query = (ui.searchInp.value || '').trim();
          if (query) {
            // Hide match count during scope change
            if (ui.matchCount) {
              ui.matchCount.style.display = 'none';
            }
            // Re-run search (will show count with correct results)
            runSearch(true);
          }
        }
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!ui.searchScopeBtn.contains(e.target) && !ui.searchScopeMenu.contains(e.target)) {
        ui.searchScopeMenu.classList.remove('open');
      }
    });
  }

  // Enhanced search function that supports both modes
  async function runSearch(jumpToFirst = true) {
    const q = (ui.searchInp.value || '').trim().toLowerCase();

    if (!q) {
      // Clear search state
      searchMatches = [];
      crossClusterMatches = [];
      searchIndex = -1;
      VIZ.runSearch(''); // Clear highlights
      updateMatchCount();
      return;
    }

    if (currentSearchScope === 'all') {
      await runCrossClusterSearch(q, jumpToFirst);
    } else {
      runCurrentClusterSearch(q, jumpToFirst);
    }
  }

  function runCurrentClusterSearch(query, jumpToFirst = true) {
    const res = VIZ.runSearch(query);
    searchMatches = VIZ.getSearchMatches();
    crossClusterMatches = [];

    if (res.count && jumpToFirst) {
      searchIndex = 0;
      jumpToCurrentCluster(searchIndex, false);
    } else {
      searchIndex = -1;
    }

    updateMatchCount();

    // Update URL with search state
    if (query) {
      writeSearchToUrl(query, 'current', searchIndex >= 0 ? searchIndex : 0);
    } else {
      writeSearchToUrl('', 'current', 0);
    }
  }

  async function runCrossClusterSearch(query, jumpToFirst = true) {
    const currentClusterId = ui.clusterSel?.value;

    // Find all clusters that contain this token
    const matchingClusters = tokenIndex[query];
    if (!matchingClusters || matchingClusters.length === 0) {
      // If no exact token match, fall back to searching current cluster only
      runCurrentClusterSearch(query, jumpToFirst);
      return;
    }

    // If token is in current cluster, prioritize it
    const currentClusterIndex = currentClusterId ? matchingClusters.indexOf(currentClusterId) : -1;
    if (currentClusterIndex > -1) {
      matchingClusters.splice(currentClusterIndex, 1);
      matchingClusters.unshift(currentClusterId);
    }

    // Load matches from all clusters
    crossClusterMatches = [];
    for (const clusterId of matchingClusters) {
      try {
        const response = await fetch(resolvePath(`cluster_json/${clusterId}.json`));
        if (response.ok) {
          const data = await response.json();

          // Load data and run search
          VIZ.loadData(data);
          const res = VIZ.runSearch(query);
          const matches = VIZ.getSearchMatches();

          // Add cluster context to each match
          matches.forEach((localIndex, i) => {
            const node = VIZ.getPlacedNode(localIndex);
            if (node) {
              crossClusterMatches.push({
                clusterId,
                localIndex,
                node,
                globalIndex: crossClusterMatches.length
              });
            }
          });
        }
      } catch (err) {
        console.warn(`Failed to search cluster ${clusterId}:`, err);
      }
    }

    // Reload current cluster to restore original state
    if (currentClusterId) {
      try {
        const response = await fetch(resolvePath(`cluster_json/${currentClusterId}.json`));
        if (response.ok) {
          const data = await response.json();
          VIZ.loadData(data);
          VIZ.layoutAndRender();
        }
      } catch (err) {
        console.warn('Failed to reload current cluster:', err);
      }
    }

    if (crossClusterMatches.length > 0 && jumpToFirst) {
      searchIndex = 0;
      jumpToCrossCluster(searchIndex, false);
    } else {
      searchIndex = -1;
    }

    updateMatchCount();
  }

  function jumpToCurrentCluster(i, wrap = true) {
    if (!searchMatches.length) return;

    if (wrap !== false) {
      if (i < 0) i = searchMatches.length - 1;
      if (i >= searchMatches.length) i = 0;
    } else {
      i = Math.max(0, Math.min(searchMatches.length - 1, i));
    }

    searchIndex = i;
    const node = VIZ.getPlacedNode(searchMatches[searchIndex]);
    centerOnNode(node);
    updateMatchCount();
  }

  async function jumpToCrossCluster(i, wrap = true) {
    if (!crossClusterMatches.length) return;

    if (wrap !== false) {
      if (i < 0) i = crossClusterMatches.length - 1;
      if (i >= crossClusterMatches.length) i = 0;
    } else {
      i = Math.max(0, Math.min(crossClusterMatches.length - 1, i));
    }

    searchIndex = i;
    const match = crossClusterMatches[searchIndex];

    // Load the cluster if it's different from current
    if (match.clusterId !== ui.clusterSel?.value) {
      ui.loadingSpinner.style.display = 'flex';

      try {
        const response = await fetch(resolvePath(`cluster_json/${match.clusterId}.json`));
        if (response.ok) {
          const data = await response.json();
          VIZ.loadData(data);
          lastBBox = VIZ.layoutAndRender();

          // Update cluster dropdown
          if (ui.clusterSel) {
            ui.clusterSel.value = match.clusterId;
            setClusterInUrl(match.clusterId, { clearView: true });
          }
        }
      } catch (err) {
        console.error(`Failed to load cluster ${match.clusterId}:`, err);
      } finally {
        ui.loadingSpinner.style.display = 'none';
      }
    }

    // Center on the node
    centerOnNode(match.node);
    updateMatchCount();
  }

  // Override the simple jumpTo function to use the appropriate mode
  function jumpTo(i, wrap = true) {
    if (currentSearchScope === 'all') {
      jumpToCrossCluster(i, wrap);
    } else {
      jumpToCurrentCluster(i, wrap);
    }
  }

  /* ---------- Export ---------- */
  ui.saveBtn.addEventListener('click', async () => {
    if (!lastBBox) {
      lastBBox = VIZ.layoutAndRender();
    }

    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = 'Saving PDF...';

    try {
      await PDF_EXPORT.savePDF({ includeLegend: true });
      console.log('PDF saved successfully');
    } catch (error) {
      console.error('PDF generation failed:', error);
      alert('PDF generation failed: ' + error.message);
    } finally {
      ui.saveBtn.textContent = 'Save PDF';
      ui.saveBtn.disabled = false;
    }
  });

  /* ---------- Share View ---------- */
  if (ui.shareBtn) {
    ui.shareBtn.addEventListener('click', async () => {
      // Ensure URL reflects the current view
      const t = d3.zoomTransform(svgEl);
      const view = currentViewFromTransform(t);
      const clusterId = ui.clusterSel?.value || getUrlClusterId();
      writeViewToUrl(view, clusterId);

      const url = window.location.href;

      try {
        if (navigator.share) {
          await navigator.share({ title: 'Token Graph View', url });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          ui.shareBtn.textContent = 'Copied!';
          setTimeout(() => ui.shareBtn.textContent = 'Share View', 1200);
        } else {
          prompt('Copy this link:', url); // fallback
        }
      } catch (err) {
        console.error('Share failed:', err);
      }
    });
  }

  /* ---------- Cluster Management ---------- */
  function cleanClusterLabel(label) {
    // Clean up cluster labels for display using meta.title from GRAPH_V1 JSON
    if (!label) return '';
    return label
      .trim()
      .replace(/^\[?\[?(.+?)\]?\]?$/, '$1') // Remove outer [ ] brackets, replace whole thing with content
      .replace(/^\[.*?:\s*/, '')  // Remove [PREFIX: ] headers
      .trim();
  }

  function loadCluster(clusterId) {
    ui.loadingSpinner.style.display = 'flex';

    fetch(resolvePath(`cluster_json/${clusterId}.json`))
      .then(r => r.json())
      .then(data => {
        VIZ.loadData(data);
        lastBBox = VIZ.layoutAndRender();

        // Try deep link; if none, center on cluster bounds with mobile-responsive zoom
        const usedDeepLink = applyHashViewAfterLayout();
        if (!usedDeepLink) {
          // Detect mobile viewport and use appropriate initial zoom
          const isMobile = window.innerWidth <= 720;
          const initialZoom = isMobile ? 0.05 : 0.1; // 5% on mobile, 10% on desktop

          // Center on cluster bounds at appropriate zoom level
          const cxY = lastBBox.minY + lastBBox.width / 2;  // horizontal center in content coords
          const cxX = (lastBBox.minX + lastBBox.maxX) / 2; // vertical center in content coords
          centerOnXY(cxY, cxX, initialZoom);
        }

        updateZoomUI(d3.zoomTransform(svgEl).k);
      })

      .catch(err => {
        console.error(`Failed to load cluster ${clusterId}:`, err);
        alert(`Failed to load cluster ${clusterId}. Please try another cluster.`);
      })
      .finally(() => {
        ui.loadingSpinner.style.display = 'none';
      });
  }



  async function initializeClusters() {
    ui.loadingSpinner.style.display = 'flex';

    try {
      // Discover all cluster files in cluster_json directory
      const clusterFiles = await discoverClusterFiles();

      if (clusterFiles.length === 0) {
        throw new Error('No cluster files found');
      }

      // Populate dropdown with cluster names (no IDs or colons)
      ui.clusterSel.innerHTML = '';
      clusterFiles.forEach(cluster => {
        const option = document.createElement('option');
        option.value = cluster.id;
        option.textContent = cluster.label; // Just the cluster name, no ID or colon
        ui.clusterSel.appendChild(option);
      });

      // Set initial selection
      const urlClusterId = getUrlClusterId();
      const initialId = urlClusterId && clusterFiles.find(c => c.id == urlClusterId)
        ? urlClusterId
        : clusterFiles[0].id;

      ui.clusterSel.value = initialId;
      loadCluster(initialId);

    } catch (err) {
      console.error('Failed to initialize clusters:', err);
      // Fallback to legacy data.json if available
      try {
        const response = await fetch(resolvePath('data.json'));
        if (response.ok) {
          const data = await response.json();
          VIZ.loadData(data);

          // Use mobile-responsive zoom for legacy data as well
          lastBBox = VIZ.layoutAndRender();
          const isMobile = window.innerWidth <= 720;
          const initialZoom = isMobile ? 0.05 : 0.1; // 5% on mobile, 10% on desktop

          // Center on cluster bounds at appropriate zoom level
          const cxY = lastBBox.minY + lastBBox.width / 2;  // horizontal center in content coords
          const cxX = (lastBBox.minX + lastBBox.maxX) / 2; // vertical center in content coords
          centerOnXY(cxY, cxX, initialZoom);

          updateZoomUI(d3.zoomTransform(svgEl).k);

          // Hide cluster dropdown if using legacy mode
          if (ui.clusterSel && ui.clusterSel.parentElement) {
            ui.clusterSel.parentElement.style.display = 'none';
          }
        }
      } catch (legacyErr) {
        console.error('Failed to load legacy data.json:', legacyErr);
        alert('Failed to load any data. Please check that cluster files or data.json exist.');
      }
    } finally {
      ui.loadingSpinner.style.display = 'none';
    }
  }

  async function discoverClusterFiles() {
    // Load manifest.json for cluster metadata
    const response = await fetch(resolvePath('cluster_json/manifest.json'));
    if (!response.ok) {
      throw new Error('Failed to load manifest.json');
    }

    const manifest = await response.json();

    // Convert manifest format to expected format
    return manifest.clusters.map(cluster => ({
      id: cluster.id,
      label: cluster.label,
      filename: `${cluster.id}.json`
    }));
  }

  // Cluster dropdown change handler
  if (ui.clusterSel) {
    ui.clusterSel.addEventListener('change', (e) => {
      const clusterId = e.target.value;
      if (clusterId) {
        // If searching in "current cluster" mode, clear the search when switching clusters
        // If in "all clusters" mode, preserve the search
        if (currentSearchScope === 'current') {
          const hadSearch = (ui.searchInp.value || '').trim().length > 0;
          if (hadSearch) {
            // Clear search input
            ui.searchInp.value = '';
            // Clear search state
            searchMatches = [];
            crossClusterMatches = [];
            searchIndex = -1;
            // Clear highlights
            VIZ.runSearch('');
            // Hide match count
            if (ui.matchCount) {
              ui.matchCount.style.display = 'none';
            }
          }
        }
        // For "all clusters" mode, search state is preserved
        
        setClusterInUrl(clusterId, { clearView: true });   // wipe k/cx/cy
        loadCluster(clusterId);
      }
    });
  }

  /* ---------- Back/Forward Navigation ---------- */
  window.addEventListener('popstate', () => {
    // If the cluster changed via history, reload it
    const newCluster = getUrlClusterId();
    if (newCluster && ui.clusterSel && ui.clusterSel.value !== newCluster) {
      ui.clusterSel.value = newCluster;
      loadCluster(newCluster);
      return;
    }
    // Otherwise just update view if we can
    const v = readViewFromUrl();
    if (v) centerOnXY(v.cx, v.cy, v.k);
  });

  /* ---------- Initialize ---------- */
  // Initialize theme first
  initializeTheme();

  // Load token index first, then initialize clusters
  loadTokenIndex().then(() => {
    initializeClusters().then(() => {
      // Initialize search from URL parameters after clusters are loaded
      initializeSearchFromUrl();
    });
  });

  // Initialize search state from URL parameters
  function initializeSearchFromUrl() {
    const urlQuery = getUrlSearchQuery();
    const urlScope = getUrlSearchScope();
    const urlMatch = getUrlSearchMatch();

    if (urlQuery) {
      // Set search input value
      if (ui.searchInp) {
        ui.searchInp.value = urlQuery;
      }

      // Set search scope
      if (urlScope && (urlScope === 'current' || urlScope === 'all')) {
        currentSearchScope = urlScope;
        updateSearchScopeUI();
      }

      // Run search and jump to specified match
      runSearch(false).then(() => {
        if (urlMatch >= 0) {
          jumpTo(urlMatch, false);
        }
      });
    }
  }
})();
