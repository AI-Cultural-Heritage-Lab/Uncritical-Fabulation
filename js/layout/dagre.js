/* ---------- DAG / Sugiyama Layout (GRAPH_V1 only) ---------- */

function layoutDagSugiyama(
  graphV1, // { nodes: [{id,...}], edges: [{source,target,kind?,prob?,weight?}], meta?, anchor_root_id? }
  { key, S, placedNodes, placedLinks, nodeW, nodeH, sizeSvgToContent }
) {
  placedNodes.length = 0;
  placedLinks.length = 0;

  if (typeof dagre === "undefined") {
    console.error("Dagre-ES not loaded");
    return _emptyBBox();
  }

  const nodesArray = Array.isArray(graphV1?.nodes) ? graphV1.nodes.map(_coerceNodeId) : [];
  const edgesArray = Array.isArray(graphV1?.edges) ? graphV1.edges.map(_coerceEdgeIds) : [];

  if (nodesArray.length === 0) {
    console.warn("[DAGRE] GRAPH_V1 has 0 nodes.");
    return _emptyBBox();
  }

  try {
    const g = _buildDagreGraph_GraphV1(nodesArray, edgesArray, { S, nodeW, nodeH });
    dagre.layout(g);

    // Use the nodes with ghosts for the conversion
    const showPredictedPaths = window.APP_CONFIG?.SHOW_PREDICTED_PATHS !== false;
    const nodesForConversion = showPredictedPaths ?
      (g._injectedNodes || nodesArray) : nodesArray;

    _toPlaced(g, nodesForConversion, key, { placedNodes, placedLinks });
    _enforceFanAnchorSpacing(S, placedNodes, placedLinks);
    return sizeSvgToContent(placedNodes);
  } catch (err) {
    console.error("Dagre layout failed:", err);
    return _emptyBBox();
  }
}

/* ---------- Build Dagre graph from GRAPH_V1 ---------- */

function _buildDagreGraph_GraphV1(nodesArray, edgesArray, { S, nodeW, nodeH }) {
  // Allow parallel edges, no compounds
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false });

  g.setGraph({
    rankdir: "LR",
    ranksep: S.RANK_SEP,
    nodesep: S.NODE_SEP,
    edgesep: 10,
    marginx: 20,
    marginy: 20
  });

  // Ensure a label object exists with weight
  g.setDefaultEdgeLabel(() => ({ weight: 1 }));

  // Inject ghost nodes from theoretical_edges if enabled
  const showPredictedPaths = window.APP_CONFIG?.SHOW_PREDICTED_PATHS !== false;
  let nodesWithGhosts = [...nodesArray];
  let edgesWithGhosts = [...edgesArray];

  if (showPredictedPaths) {
    const { nodes: injectedNodes, edges: injectedEdges } = _injectGhostNodes(nodesArray, edgesArray);
    nodesWithGhosts = injectedNodes;
    edgesWithGhosts = injectedEdges;
    // Store the injected nodes for later use in conversion
    g._injectedNodes = nodesWithGhosts;
  }

  // Nodes
  for (const n of nodesWithGhosts) {
    const hnode = { data: n };
    const w = _clampDim(+nodeW(hnode));
    const h = _clampDim(+nodeH(hnode));
    g.setNode(n.id, {
      label: n.token || n.id,
      width: w,
      height: h,
      data: n,
      isGhost: !!n.isGhost
    });
  }

  // Edges
  let nameCounter = 0;
  for (const e of edgesWithGhosts) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(
      { v: e.source, w: e.target, name: String(nameCounter++) }, // multigraph-safe
      {
        weight: e.weight ?? 1,
        prob: e.prob ?? null,
        kind: e.kind || "emp"
      }
    );
  }

  return g;
}

/* ---------- Convert Dagre output to placed nodes/links ---------- */

function _toPlaced(dagreGraph, nodesArray, keyFn, { placedNodes, placedLinks }) {
  const nodeMap = new Map(nodesArray.map((n) => [n.id, n]));

  // Nodes
  for (const nodeId of dagreGraph.nodes()) {
    const dnode = dagreGraph.node(nodeId);
    if (!dnode) continue;

    const data = dnode.data || nodeMap.get(nodeId);
    if (!data) continue;

    const hnode = { data };
    const depth = _computeDepth(data);

    placedNodes.push({
      x: dnode.y, // swap axes (your renderer convention)
      y: dnode.x,
      w: dnode.width,
      h: dnode.height,
      hnode,
      data,
      depth,
      key: data.isGhost ? (data.id || nodeId) : (keyFn ? keyFn(hnode) : (data.id || nodeId))
    });
  }

  // Edges
  for (const e of dagreGraph.edges()) {
    const srcId = e.v;
    const dstId = e.w;

    const src = placedNodes.find((n) => n.data.id === srcId);
    const dst = placedNodes.find((n) => n.data.id === dstId);
    if (!src || !dst) continue;

    const label = dagreGraph.edge(e) || {};
    const isGhostEdge = label.kind === "ghost" || !!dst.data.isGhost;

    // Probability: prefer label.prob, else empirical from src.emp_children
    let prob = label.prob ?? null;
    if (prob == null) {
      if (isGhostEdge) {
        prob = dst.data.model_prob_here ?? 0;
      } else {
        const empChildren = src.data.emp_children || {};
        const parentTotal = Object.values(empChildren).reduce((s, c) => s + c, 0);
        const cnt = empChildren[dst.data.token] || 0;
        prob = parentTotal > 0 ? cnt / parentTotal : 0;
      }
    }

    placedLinks.push({
      sx: src.y + src.w,
      sy: src.x,
      tx: dst.y,
      ty: dst.x,
      ghost: isGhostEdge,
      p: prob,
      skey: src.key,
      tkey: dst.key
    });
  }
}

/* ---------- Helpers ---------- */

function _clampDim(v) {
  if (!isFinite(v) || v <= 0) return 24; // avoid invisible nodes
  return Math.max(8, v);
}

function _computeDepth(n) {
  if (!n) return 0;
  if (n.is_root) return 0;
  if (n.is_prefix) return Array.isArray(n.path) ? n.path.length : 0;
  return (n.position || 0) + 1;
}

function _coerceNodeId(n, i) {
  const id = String(n.id ?? i);
  return { ...n, id };
}

function _coerceEdgeIds(e) {
  return {
    source: String(e.source),
    target: String(e.target),
    kind: e.kind || "emp",
    prob: e.prob ?? null,
    weight: e.weight ?? 1
  };
}

function _injectGhostNodes(originalNodes, originalEdges) {
  const nodesMap = new Map(originalNodes.map(n => [n.id, { ...n }]));
  const newNodes = [...originalNodes];
  const newEdges = [...originalEdges];
  let ghostIdCounter = 0;

  // Process each node for ghost injection
  for (const node of originalNodes) {
    if (node.theoretical_edges && node.theoretical_edges.length > 0) {
      // Create ghost nodes for top 3 theoretical edges
      const ghostsToAdd = node.theoretical_edges.slice(0, 3).map(edge => {
        const ghostId = `ghost_${node.id}_${edge.token}_${ghostIdCounter++}`;
        return {
          id: ghostId,
          token: edge.token,
          model_prob_here: edge.avg_prob ?? null,
          emp_parent_total: 0,
          emp_count_here: 0,
          emp_freq_here: null,
          isGhost: true,
          position: (node.position ?? -1) + 1,
          path: [...(node.path || []), edge.token],
          children: [],
          // Add reference to parent for layout purposes
          _parentId: node.id
        };
      });

      // Add ghost nodes to the nodes array
      newNodes.push(...ghostsToAdd);

      // Add edges from parent to ghost nodes
      ghostsToAdd.forEach(ghost => {
        newEdges.push({
          source: node.id,
          target: ghost.id,
          kind: 'ghost',
          prob: ghost.model_prob_here,
          weight: 1
        });
      });
    }
  }

  return { nodes: newNodes, edges: newEdges };
}

function _enforceFanAnchorSpacing(S, placedNodes, placedLinks) {
  if (!S || !isFinite(S.ANG_MAX_DEG)) return;

  const fanKeys = new Set();
  for (const n of placedNodes) {
    if (n?.data?.is_prefix || n?.data?.is_root) fanKeys.add(n.key);
  }

  let maxRequiredShift = 0;
  const TAN_MAX = Math.tan((S.ANG_MAX_DEG * Math.PI) / 180);

  for (const link of placedLinks) {
    const src = placedNodes.find(
      (n) => Math.abs(n.y + n.w - link.sx) < 1 && Math.abs(n.x - link.sy) < 1
    );
    const dst = placedNodes.find(
      (n) => Math.abs(n.y - link.tx) < 1 && Math.abs(n.x - link.ty) < 1
    );
    if (!src || !dst) continue;

    const sourceFan = fanKeys.has(src.key);
    const targetAnchor = !fanKeys.has(dst.key);
    if (!(sourceFan && targetAnchor)) continue;

    const dx = link.tx - link.sx;
    const dy = Math.abs(link.ty - link.sy);
    const minDx = dy / TAN_MAX;

    if (dx < minDx) {
      const requiredShift = minDx - dx;
      if (requiredShift > maxRequiredShift) maxRequiredShift = requiredShift;
    }
  }

  if (maxRequiredShift > 0) {
    const padding = 20;
    const totalShift = maxRequiredShift + padding;

    for (const n of placedNodes) {
      if (fanKeys.has(n.key)) n.y -= totalShift;
    }

    for (const link of placedLinks) {
      const srcFan = placedNodes.find(
        (n) => fanKeys.has(n.key) && Math.abs(n.y + n.w - (link.sx - totalShift)) < 1 && Math.abs(n.x - link.sy) < 1
      );
      if (srcFan) link.sx = srcFan.y + srcFan.w;

      const dstFan = placedNodes.find(
        (n) => fanKeys.has(n.key) && Math.abs(n.y - (link.tx - totalShift)) < 1 && Math.abs(n.x - link.ty) < 1
      );
      if (dstFan) link.tx = dstFan.y;
    }
  }
}

function sizeSvgToContent(placedNodes, svg) {
  const minX = d3.min(placedNodes, (d) => d.x - d.h / 2) ?? -50;
  const maxX = d3.max(placedNodes, (d) => d.x + d.h / 2) ?? 50;
  const minY = d3.min(placedNodes, (d) => d.y) ?? 0;
  const maxY = d3.max(placedNodes, (d) => d.y + d.w) ?? 0;
  const pad = 40;
  const width = maxY - minY + 2 * pad;
  const height = maxX - minX + 2 * pad;

  if (svg) {
    svg.attr("width", Math.max(400, Math.ceil(width)));
    svg.attr("height", Math.max(300, Math.ceil(height)));
  }

  return { minX, maxX, minY, maxY, pad, width, height };
}

function _emptyBBox() {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, pad: 40, width: 400, height: 300 };
}

/* ---------- Export ---------- */
if (typeof window !== "undefined") {
  window.LAYOUT_DAGRE = { layoutDagSugiyama, sizeSvgToContent };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { layoutDagSugiyama, sizeSvgToContent };
}
