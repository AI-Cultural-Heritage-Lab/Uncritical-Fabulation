/* ---------- Branched/Tree Layout ---------- */
function layoutBranched(
  mat,
  { S, placedNodes, placedLinks, nodeW, nodeH, key: keyFn },
  d3
){
  if (!mat) return;

  // Inject ghost nodes if enabled
  const showPredictedPaths = window.APP_CONFIG?.SHOW_PREDICTED_PATHS !== false;
  if (showPredictedPaths && mat.data && Array.isArray(mat.data.theoretical_edges)) {
    _injectGhostsIntoTree(mat);
  }

  // Safe key function fallback (keeps existing keys stable)
  const defaultKey = (n) => {
    const p = n?.data?.path;
    return Array.isArray(p) ? p.join('\u241F') : (String(n?.data?.token ?? '') + ':' + (n?.depth ?? 0));
  };
  const getKey = typeof keyFn === 'function' ? keyFn : defaultKey;

  /* 1) Measure widths and make a provisional compact layout */
  const maxWidthByDepth = new Map();
  mat.each(n => {
    const w = _clampDim(+nodeW(n));
    const d = n.depth || 0;
    maxWidthByDepth.set(d, Math.max(maxWidthByDepth.get(d) ?? 0, w));
  });
  const wMax = Math.max(...(maxWidthByDepth.size ? maxWidthByDepth.values() : [0]));

  const vSpacing = (S.ALT_GAP || 0) + (S.TOKEN_FPX || 0) + (S.PAD_T || 0) + (S.PAD_B || 0);

  // Start sane: use your global spacing (like linear) and a small margin for node width.
  let dynamicGap = Math.max(S.GAP_X || 240, wMax + 24);

  const tree = d3.tree().nodeSize([vSpacing, dynamicGap]);
  let troot = tree(mat);

  /* 2) Find the worst vertical distance between any parent and child */
  let worstDy = 0;
  troot.each(n => {
    if (n.parent) worstDy = Math.max(worstDy, Math.abs((n.x || 0) - (n.parent.x || 0)));
  });

  /* 3) Inflate horizontal gap just enough to satisfy the angle constraint w/o extra shifts */
  const deg = +S.ANG_MAX_DEG || 0;
  const TAN_MAX = Math.tan((deg * Math.PI) / 180);

  if (Number.isFinite(TAN_MAX) && TAN_MAX > 0) {
    const minDxNeeded = worstDy / TAN_MAX;   // horizontal run needed for steepest edge
    // center-to-center gap must exceed parent width + required run
    const desiredGap = wMax + minDxNeeded + 24;
    dynamicGap = Math.max(dynamicGap, desiredGap);

    // Optional cap to avoid runaway widths
    if (Number.isFinite(S.BRANCHED_GAP_MAX)) {
      dynamicGap = Math.min(dynamicGap, S.BRANCHED_GAP_MAX);
    }

    tree.nodeSize([vSpacing, dynamicGap]);
    troot = tree(mat);
  }

  /* 5) First pass: compute node sizes */
  troot.each(n => {
    n._w = _clampDim(+nodeW(n));
    n._h = _clampDim(+nodeH(n));
  });

  /* 6) Second pass: enforce edge-angle constraint by shifting subtrees */
  const enforceAngles = Number.isFinite(TAN_MAX) && TAN_MAX > 0;

  function shiftSubtree(node, delta) {
    node.y += delta;
    if (node.children) node.children.forEach(c => shiftSubtree(c, delta));
  }

  if (enforceAngles) {
    troot.eachBefore(n => {
      if (!n.parent) return;
      const p = n.parent;
      const sx = (p.y || 0) + (p._w || 0);
      const sy = p.x || 0;
      const tx = n.y || 0;
      const ty = n.x || 0;
      const dx = tx - sx;
      const dy = Math.abs(ty - sy);
      const minDx = dy / TAN_MAX;  // required horizontal run for allowed angle

      if (dx < minDx) {
        const shift = (minDx - dx);
        if (shift > 0) shiftSubtree(n, shift);
      }
    });
  }

  /* 7) Emit placed nodes / links */
  placedNodes.length = 0;
  placedLinks.length = 0;

  troot.each(n => {
    const x = n.x || 0;
    const y = n.y || 0;
    placedNodes.push({
      x, y,
      w: n._w, h: n._h,
      hnode: n,
      data: n.data,
      depth: n.depth || 0,
      key: getKey(n),
    });

    if (n.parent) {
      placedLinks.push({
        sx: (n.parent.y || 0) + (n.parent._w || 0),
        sy: (n.parent.x || 0),
        tx: y,
        ty: x,
        ghost: !!n.data?.isGhost,
        p: n.data?.isGhost ? (n.data?.model_prob_here ?? 0) : (n.data?.emp_freq_here ?? 0),
        skey: getKey(n.parent),
        tkey: getKey(n)
      });
    }
  });

  /* Helpers */
  function _clampDim(v) {
    return (Number.isFinite(v) && v > 0) ? Math.max(8, v) : 24;
  }

  function _injectGhostsIntoTree(node) {
    if (!node) return;

    // Process children first (recursive)
    if (node.children) {
      node.children.forEach(_injectGhostsIntoTree);
    }

    // Inject ghosts from theoretical_edges if present
    if (node.data && Array.isArray(node.data.theoretical_edges) && node.data.theoretical_edges.length > 0) {
      const ghostsToAdd = node.data.theoretical_edges.slice(0, 3).map((edge, i) => ({
        token: edge.token,
        model_prob_here: edge.avg_prob ?? null,
        emp_parent_total: 0,
        emp_count_here: 0,
        emp_freq_here: null,
        isGhost: true,
        position: (node.data.position ?? -1) + 1,
        path: [...(node.data.path || []), edge.token],
        children: []
      }));

      // Add ghosts to children array
      if (!node.children) node.children = [];
      node.children.push(...ghostsToAdd);
    }
  }
}

/* ---------- Export ---------- */
if (typeof window !== 'undefined') {
  window.LAYOUT_BRANCHED = { layoutBranched };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { layoutBranched };
}
