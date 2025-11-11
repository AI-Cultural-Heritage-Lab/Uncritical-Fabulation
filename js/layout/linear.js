/* ---------- Linear Layout (GRAPH_V1-aware) ---------- */
function layoutLinear(
  matOrGraph,
  { S, placedNodes, placedLinks, bestChildPack, nodeW, nodeH, key: keyFn },
  d3
){
  // If we were given GRAPH_V1, convert it to a d3.hierarchy first
  let mat = matOrGraph;
  if (Array.isArray(matOrGraph?.nodes) && Array.isArray(matOrGraph?.edges)) {
    mat = graphV1ToHierarchy(matOrGraph, d3, { includeGhosts: (window.APP_CONFIG?.SHOW_PREDICTED_PATHS ?? true) });
  }
  if (!mat) return;

  // Safe key fallback (matches your VIZ.key logic)
  const defaultKey = (n) => {
    const p = n?.data?.path;
    return Array.isArray(p) ? p.join('\u241F') : (String(n?.data?.token ?? '') + ':' + (n?.depth ?? 0));
  };
  const getKey = typeof keyFn === 'function' ? keyFn : defaultKey;

  buildProfiles(mat, { S, nodeW, nodeH, bestChildPack });

  // Column spacing
  const firstGap = Math.max(S.GAP_X || 0, _clampDim(mat._w) + 100);
  const colX = d => (d === 0 ? 0 : firstGap + (d - 1) * (S.GAP_X || 0));

  const sky = new Map();
  const nodeShifts = new Map(); // Track horizontal shifts applied to subtrees
  const depthShift = new Map(); // depth -> accumulated right shift for that column
  placedNodes.length = 0;
  placedLinks.length = 0;

  placeSubtree(mat, 0, 0);

  function placeSubtree(n, baseY, absDepth) {
    const w = _clampDim(n._w), h = _clampDim(n._h);
    const x = baseY;
    const baseY_pos = colX(absDepth);
    const shift = nodeShifts.get(n) || 0;
    const y = baseY_pos + shift;

    placedNodes.push({ x, y, w, h, hnode: n, data: n.data, depth: n.depth, key: getKey(n) });
    sky.set(absDepth, Math.max(sky.get(absDepth) ?? -Infinity, x + h / 2));

    const kids = n.children || [];
    const m = bestChildPack ? bestChildPack(n) : (kids[0] || null);
    const alts = kids.filter(c => c !== m);

    function placeChild(c, localOff) {
      const prof = c._profile;
      let need = 0;
      for (let j = 0; j < prof.span; j++) {
        const col = absDepth + 1 + j;
        const skybot = sky.get(col) ?? -Infinity;
        const topAtCol = baseY + localOff + prof.top[j];
        need = Math.max(need, (skybot + (S.ALT_GAP || 0)) - topAtCol);
      }
      if (need < 0) need = 0;
      const childBase = baseY + localOff + need;

      let sx = y + w, sy = x;
      let tx = colX(absDepth + 1) + (depthShift.get(absDepth + 1) || 0), ty = childBase;

      // Angle constraint for non-main children (column-wide shift)
      const isMain = (c === m);
      const deg = +S.ANG_MAX_DEG || 0;
      const TAN_MAX = Math.tan((deg * Math.PI) / 180);
      if (!isMain && Number.isFinite(TAN_MAX) && TAN_MAX > 0) {
        // Required horizontal run for this edge
        const dx0 = tx - sx;
        const dy  = Math.abs(ty - sy);
        const minDx = dy / TAN_MAX;

        if (dx0 < minDx) {
          const add = (minDx - dx0);
          // Accumulate at the next depth so all children use the same column
          const prev = depthShift.get(absDepth + 1) || 0;
          depthShift.set(absDepth + 1, prev + add);
          tx += add;
          _applyShiftToSubtree(c, add); // keep subtree horizontally aligned with the depth column
        }
      }

      placedLinks.push({
        sx, sy, tx, ty,
        ghost: !!c.data?.isGhost,
        p: c.data?.isGhost ? (c.data?.model_prob_here ?? 0) : (c.data?.emp_freq_here ?? 0),
        skey: getKey(n),       // ← stable source key
        tkey: getKey(c)        // ← stable target key
      });

      placeSubtree(c, childBase, absDepth + 1);

      for (let j = 0; j < prof.span; j++) {
        const col = absDepth + 1 + j;
        const bottomAtCol = childBase + prof.bottom[j];
        sky.set(col, Math.max(sky.get(col) ?? -Infinity, bottomAtCol));
      }
    }

    if (m) placeChild(m, 0);
    for (const c of alts) placeChild(c, n._childOffsets.get(c));
  }

  function _applyShiftToSubtree(node, shift) {
    const cur = nodeShifts.get(node) || 0;
    nodeShifts.set(node, cur + shift);
    (node.children || []).forEach(ch => _applyShiftToSubtree(ch, shift));
  }

  function _clampDim(v) {
    return (Number.isFinite(v) && v > 0) ? Math.max(8, v) : 24;
  }
}

/* ---------- Profiles ---------- */
function buildProfiles(n, { S, nodeW, nodeH, bestChildPack }){
  n._w = _clampDim(+nodeW(n));
  n._h = _clampDim(+nodeH(n));
  const kids = n.children || [];
  kids.forEach(c => buildProfiles(c, { S, nodeW, nodeH, bestChildPack }));

  const main = bestChildPack ? bestChildPack(n) : (kids[0] || null);
  const alts = kids.filter(c => c !== main);

  n._childOffsets = new Map();
  if (main) n._childOffsets.set(main, 0);
  let altStart = n._h/2 + (S.ALT_GAP || 0);
  for (const c of alts){
    n._childOffsets.set(c, altStart);
    altStart += (c._down ?? 0) + (S.ALT_GAP || 0);
  }

  let span = 1;
  if (main) span = Math.max(span, (main._profile?.span || 1) + 1);
  for (const c of alts) span = Math.max(span, (c._profile?.span || 1) + 1);

  const top = new Array(span).fill( Infinity);
  const bot = new Array(span).fill(-Infinity);

  top[0] = Math.min(top[0], -n._h/2);
  bot[0] = Math.max(bot[0],  n._h/2);

  function mergeChild(c, off){
    const cp = c._profile; const clen = cp.span;
    for (let j=0;j<clen;j++){
      const col = j+1;
      top[col] = Math.min(top[col], off + cp.top[j]);
      bot[col] = Math.max(bot[col], off + cp.bottom[j]);
    }
  }
  if (main) mergeChild(main, 0);
  for (const c of alts) mergeChild(c, n._childOffsets.get(c));

  for (let i=0;i<span;i++){
    if (!isFinite(top[i])) top[i]=0;
    if (!isFinite(bot[i])) bot[i]=0;
  }

  n._profile = { top, bottom: bot, span };
  n._down = Math.max(n._h/2, ...bot);

  function _clampDim(v) {
    return (Number.isFinite(v) && v > 0) ? Math.max(8, v) : 24;
  }
}

/* ---------- GRAPH_V1 → tree (hierarchy) ---------- */
function graphV1ToHierarchy(graphV1, d3, { includeGhosts = (window.APP_CONFIG?.SHOW_PREDICTED_PATHS ?? true) } = {}) {
  const nodes = graphV1.nodes || [];
  const edges = graphV1.edges || [];
  const byId = new Map(nodes.map(n => [String(n.id), { ...n, id: String(n.id) }]));

  // Outgoing empirical edges (exclude ghosts)
  const out = new Map(); // id -> [{to, prob, edge}]
  const indeg = new Map();
  for (const n of nodes) { out.set(n.id, []); indeg.set(n.id, 0); }

  for (const e of edges) {
    const kind = e.kind || 'emp';
    const src = String(e.source), dst = String(e.target);
    if (!byId.has(src) || !byId.has(dst)) continue;
    if (kind === 'ghost') continue;                // exclude ghost edges
    if (byId.get(dst).isGhost) continue;           // exclude ghost nodes
    out.get(src).push({ to: dst, prob: (e.prob ?? null), edge: e });
    indeg.set(dst, (indeg.get(dst) || 0) + 1);
  }

  // Choose a root: anchor_root_id → is_root → indegree 0 → first node
  let rootId = null;
  if (graphV1.anchor_root_id && byId.has(String(graphV1.anchor_root_id))) {
    rootId = String(graphV1.anchor_root_id);
  } else {
    const explicitRoot = nodes.find(n => n.is_root);
    if (explicitRoot) rootId = explicitRoot.id;
    else {
      const indeg0 = nodes.find(n => (indeg.get(n.id) || 0) === 0 && !n.isGhost);
      rootId = (indeg0 ? indeg0.id : (nodes[0]?.id));
    }
  }
  if (!rootId) throw new Error('GRAPH_V1 has no nodes');

  // Sort children by prob desc, fallback to parent emp_children counts
  function sortedChildren(pid) {
    const parent = byId.get(pid);
    const emp = parent?.emp_children || {};
    return (out.get(pid) || [])
      .map(({ to, prob }) => {
        const tok = byId.get(to)?.token;
        const fallback = (tok != null) ? (emp[tok] || 0) : 0;
        return { to, score: (prob != null ? prob : fallback) };
      })
      .sort((a, b) => (b.score - a.score))
      .map(x => x.to);
  }

  // DFS to build a *tree* (first parent wins), avoid cycles
  const visited = new Set();
  function build(id, parentPath = []) {
    if (visited.has(id)) return null; // break cycles / multi-parent
    visited.add(id);

    const data = { ...byId.get(id) };
    // Ensure path/position exist if missing
    const tok = data.token ?? '';
    const path = Array.isArray(data.path) ? data.path.slice()
               : (parentPath.length ? [...parentPath, tok] : (tok ? [tok] : []));
    data.path = path;
    if (!Number.isFinite(+data.position)) {
      const parentPos = (parentPath && parentPath.length) ? (parentPath.length - 1) : (data.is_root ? 0 : (data.position || 0));
      data.position = parentPos;
    }

    const kids = [];
    for (const cid of sortedChildren(id)) {
      const child = byId.get(cid);
      if (!child || child.isGhost) continue; // keep empirical-only here
      const built = build(cid, path);
      if (built) kids.push(built);
    }

    // --- Inject ghost predictions for linear, if desired ---
    if (includeGhosts) {
      const te = Array.isArray(data.theoretical_edges) ? data.theoretical_edges : [];
      const ghosts = te.slice(0, 3).map((g, i) => ({
        token: g.token,
        model_prob_here: g.avg_prob ?? null,
        emp_parent_total: 0,
        emp_count_here: 0,
        emp_freq_here: null,
        isGhost: true,
        position: (data.position ?? -1) + 1,
        path: [...path, g.token],
        children: []
      }));
      ghosts.forEach(g => kids.push(g));
    }
    // -------------------------------------------------------

    // Return plain nested node
    return { ...data, children: kids };
  }

  const nestedRoot = build(rootId) || { ...byId.get(rootId), children: [] };
  return d3.hierarchy(nestedRoot, d => d.children || []);
}

/* ---------- Export ---------- */
if (typeof window !== 'undefined') {
  window.LAYOUT_LINEAR = { layoutLinear, buildProfiles, graphV1ToHierarchy };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { layoutLinear, buildProfiles, graphV1ToHierarchy };
}
