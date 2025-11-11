// VIZ: data, layout, rendering, virtualization
window.VIZ = (function(){
  /* DOM + D3 */
  let stageEl, svgEl, svg, gRoot, gLinks, gNodes;

  /* Settings */
  let S = {
    LAYOUT: "branched",   // "branched" | "linear"
    GAP_X: 400,
    ALT_GAP: 45,
    TOKEN_FPX: 16,
    META_FPX: 12,
    PAD_T: 10,
    PAD_B: 10,
    PAD_X: 10,
    LABEL_MAX: 520,
    LINK_PX: 1.6,
    COLOR_FLOOR: 0.02,
    COLOR_CAP: 0.60,
    MAIN_METRIC: "emp",
    PACKING_METRIC: "emp",
    ANG_MAX_DEG: 60,  // Maximum edge angle to prevent near-vertical links
    // DAG layout settings
    RANK_SEP: 200,    // Horizontal separation between ranks
    NODE_SEP: 45,     // Vertical separation between nodes in same rank
    FAN_RANK_SEP: 180, // Smaller separation for fan ranks
  };

  /* Data & layout state */
  let rawData, sourceData, root;
  let placedNodes = [];
  let placedLinks = [];
  let curTransform = d3.zoomIdentity; // provided by UI

  /* Search state */
  let matchKeySet = new Set();
  let searchMatches = []; // indices into placedNodes

  /* Draw throttle */
  let drawScheduled = false;

  /* ---------- Public: init ---------- */
  function init({stageEl:st, svgEl:sv}){
    // Load layout modules
    loadLayoutModules();

    stageEl = st; svgEl = sv;
    svg = d3.select(svgEl);
    gRoot  = d3.select('#viewport');
    gLinks = d3.select('#links');
    gNodes = d3.select('#nodes');
  }

  /* ---------- Public: settings ---------- */
  function setSettings(partial){
    S = {...S, ...partial};
  }

  function getSettings(){
    return {...S};
  }

  /* ---------- Data transforms ---------- */
  function buildFanHierarchy(bundle) {
    // Build fan trie from bundle, excluding anchor connections
    const { root, nodes_by_id, anchor_root_id } = bundle;
    
    function buildFanNode(nodeRef) {
      const nodeId = typeof nodeRef === 'string' ? nodeRef : nodeRef.id;
      const originalNode = nodes_by_id[nodeId];
      if (!originalNode) return null;
      
      // Only include prefix nodes in fan
      if (!originalNode.is_prefix && !originalNode.is_root) return null;
      
      const fanNode = { ...originalNode };
      
      // Filter children: exclude anchor connections, keep only prefix children
      fanNode.children = (originalNode.children || [])
        .map(childRef => {
          const childId = typeof childRef === 'string' ? childRef : childRef.id;
          if (childId === anchor_root_id) return null; // Skip anchor connection
          return buildFanNode(childRef);
        })
        .filter(child => child !== null);
      
      return fanNode;
    }
    
    return buildFanNode(root);
  }
  
  function buildAnchorHierarchy(bundle) {
    // Build anchor tree from bundle starting at anchor_root_id
    const { nodes_by_id, anchor_root_id } = bundle;
    
    if (!anchor_root_id || !nodes_by_id[anchor_root_id]) return null;
    
    function buildAnchorNode(nodeRef) {
      const nodeId = typeof nodeRef === 'string' ? nodeRef : nodeRef.id;
      const originalNode = nodes_by_id[nodeId];
      if (!originalNode) return null;
      
      // Only include non-prefix nodes in anchor tree
      if (originalNode.is_prefix) return null;
      
      const anchorNode = { ...originalNode };
      
      // Include all children (they should all be non-prefix)
      anchorNode.children = (originalNode.children || [])
        .map(childRef => buildAnchorNode(childRef))
        .filter(child => child !== null);
      
      return anchorNode;
    }
    
    return buildAnchorNode(anchor_root_id);
  }
  
  function resolveBundleToTree(bundle) {
    // Legacy fallback: Convert DAG bundle to tree (for backward compatibility)
    const { root, nodes_by_id } = bundle;
    
    function cloneNodeWithChildren(nodeRef, pathStack = new Set()) {
      const nodeId = typeof nodeRef === 'string' ? nodeRef : nodeRef.id;
      if (pathStack.has(nodeId)) {
        return { ...nodes_by_id[nodeId], children: [], cycleDetected: true };
      }
      
      const originalNode = nodes_by_id[nodeId];
      if (!originalNode) return null;
      
      const clonedNode = { ...originalNode };
      const newPathStack = new Set(pathStack);
      newPathStack.add(nodeId);
      
      clonedNode.children = (originalNode.children || []).map(childRef => {
        return cloneNodeWithChildren(childRef, newPathStack);
      }).filter(child => child !== null);
      
      return clonedNode;
    }
    
    return cloneNodeWithChildren(root);
  }

  function promoteGhosts(n){
    const kids = (n.children||[]).map(promoteGhosts);
    
    // Original theoretical_edges ghosts
    const theoreticalGhosts = (n.theoretical_edges||[]).map(g=>({
      token: g.token,
      position: (n.position ?? -1) + 1,
      path: [...(n.path||[]), g.token],
      emp_parent_total: 0,
      emp_count_here: 0,
      emp_freq_here: null,
      model_prob_here: g.avg_prob ?? null,
      children: [],
      isGhost: true
    }));
    
    // Synthesize additional ghosts from model_children if theoretical_edges is empty
    let syntheticGhosts = [];
    if ((!n.theoretical_edges || n.theoretical_edges.length === 0) && n.model_children &&
        (window.APP_CONFIG?.SHOW_PREDICTED_PATHS !== false)) {
      // Get empirical children tokens to avoid duplicating real children as ghosts
      const empChildrenTokens = new Set(Object.keys(n.emp_children || {}));

      // Create ghosts for model predictions that aren't empirically observed
      syntheticGhosts = Object.entries(n.model_children)
        .filter(([token, data]) => !empChildrenTokens.has(token))
        .slice(0, 3) // Limit to top 3 to avoid clutter
        .map(([token, data]) => ({
          token: token,
          position: (n.position ?? -1) + 1,
          path: [...(n.path||[]), token],
          emp_parent_total: 0,
          emp_count_here: 0,
          emp_freq_here: null,
          model_prob_here: data.avg_prob ?? null,
          children: [],
          isGhost: true,
          synthetic: true // Mark as synthetic for potential different styling
        }));
    }
    
    const allGhosts = theoreticalGhosts.concat(syntheticGhosts);
    return {...n, isGhost: n.isGhost||false, children: kids.concat(allGhosts)};
  }

  function rebuildSource(){
    sourceData = promoteGhosts(structuredClone(rawData));
  }

  function buildHierarchy(){
    const filter = d => (d.children||[]);
    // preserve collapsed if we ever add collapsing again
    root = d3.hierarchy(sourceData, filter);
  }

  function key(n){
    const p=n.data.path; return Array.isArray(p)? p.join('\u241F') : (String(n.data.token??'')+':'+n.depth);
  }

  /* ---------- Label + sizing ---------- */
  function parts(d){
    if (d.data.position < 0) {
      // For clusters, don't show "Prompt:" prefix
      const raw = d.data.cluster_label || d.data.prompt || d.data.token || '';
      // Clean up the label the same way as the dropdown
      const cleaned = raw.replace(/^\[?\[?(.+?)\]?\]?$/, '$1').replace(/^\[.*?:\s*/, '').trim();
      return { tok: cleaned, metaEmp:'', metaModel:'' };
    }
    const tok = String(d.data.token ?? '');
    const metaEmp   = (d.data.emp_freq_here!=null)
      ? `Observed frequency: ${(d.data.emp_freq_here*100).toFixed(1)}% (${d.data.emp_count_here}/${d.data.emp_parent_total})`
      : '';
    
    let metaModel = '';
    if (d.data.model_prob_here != null) {
      const mean = d.data.model_prob_here;
      const std = d.data.model_prob_std;
      const n = d.data.model_prob_n;
      
      const displayMode = S.PROB_DISPLAY || 'mean_sd';
      
      if (displayMode === 'mean') {
        metaModel = `Predicted probability: ${(mean*100).toFixed(1)}%`;
      } else if (displayMode === 'mean_sd' && std != null && n >= 2) {
        metaModel = `Predicted probability: ${(mean*100).toFixed(1)}% ± ${(std*100).toFixed(1)}% (n=${n})`;
      } else if (displayMode === 'range' && std != null && n >= 2) {
        const lo = Math.max(0, mean - 2*std);
        const hi = Math.min(1, mean + 2*std);
        metaModel = `Predicted probability: ~[${(lo*100).toFixed(1)}%–${(hi*100).toFixed(1)}%] (n=${n})`;
      } else {
        // Fallback to mean-only if no std or insufficient samples
        metaModel = `Predicted probability: ${(mean*100).toFixed(1)}%`;
      }
    }
    
    return { tok, metaEmp, metaModel };
  }
  function estimateWidth(text, px){ return 0.6*px*(text?.length||0); }
  function wrapLines(text, maxPx, px){
    const words = String(text||"").split(/\s+/);
    const lines = []; let cur = "";
    for (const w of words){
      const trial = cur ? (cur + " " + w) : w;
      if (estimateWidth(trial, px) <= maxPx) cur = trial;
      else {
        if (cur) lines.push(cur);
        if (estimateWidth(w, px) > maxPx){
          let chunk = "";
          for (const ch of w){
            const t = chunk + ch;
            if (estimateWidth(t, px) <= maxPx) chunk = t;
            else { lines.push(chunk); chunk = ch; }
          }
          cur = chunk;
        }else cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function nodeW(n){
    const p=parts(n);
    const wTok  = S.PAD_X*2 + estimateWidth(p.tok,  S.TOKEN_FPX);
    const wMeta1 = p.metaEmp   ? S.PAD_X*2 + estimateWidth(p.metaEmp,   S.META_FPX) : 0;
    const wMeta2 = p.metaModel ? S.PAD_X*2 + estimateWidth(p.metaModel, S.META_FPX) : 0;
    const wMeta = Math.max(wMeta1, wMeta2);
    return Math.min(S.LABEL_MAX, Math.max(wTok, wMeta));
  }
  function nodeH(n){
    const p=parts(n);
    if (n.data.position < 0){
      const maxW = S.LABEL_MAX - 2*S.PAD_X;
      const lines = wrapLines(p.tok, maxW, S.TOKEN_FPX);
      const linesBlock = lines.length*S.TOKEN_FPX + (lines.length-1)*4;
      return S.PAD_T + linesBlock + S.PAD_B;
    }
    // Fixed height for regular nodes to ensure consistent vertical spacing in linear layout
    return 70;
  }

 /* ---------- Path scoring ---------- */
  function scoreBy(metric, n){
  const e = n.data.emp_freq_here, p = n.data.model_prob_here;
  if (metric === "prob") return (p != null ? p : (e != null ? e*0.5 : -1));
  if (metric === "emp")  return (e != null ? e : (p != null ? p*0.5 : -1));
  // "data": preserve input order; used only to pick "first" child
  return 0;
}

function bestChildBy(metric, n){
  const kids = n.children || [];
  if (!kids.length) return null;
  if (metric === "data") return kids[0] || null;
  return kids.slice().sort((a,b)=> scoreBy(metric,b) - scoreBy(metric,a))[0];
}


  // Keep this as your display/highlight scorer:
function bestChild(n){
  return bestChildBy(S.MAIN_METRIC, n);
}

// New: packing choice (used only by linear layout & profiles)
function bestChildPack(n){
  return bestChildBy(S.PACKING_METRIC, n);
}

  /* ---------- Viridis + text contrast ---------- */
  const norm = (v)=> {
    if (v==null) return 0;
    const t = (v - S.COLOR_FLOOR) / Math.max(1e-9, (S.COLOR_CAP - S.COLOR_FLOOR));
    return Math.max(0, Math.min(1, t));
  };
  const viridis = t => d3.interpolateViridis(t);
  function luminanceFromColor(c){
    let r,g,b;
    if (c.startsWith('#')){
      const n = c.length===7 ? parseInt(c.slice(1),16) : 0;
      r = (n>>16)&255; g = (n>>8)&255; b = n&255;
    } else {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      r = +m[1]; g = +m[2]; b = +m[3];
    }
    const sr=r/255, sg=g/255, sb=b/255;
    const lin = (u)=> (u<=0.04045) ? u/12.92 : Math.pow((u+0.055)/1.055, 2.4);
    const R=lin(sr), G=lin(sg), B=lin(sb);
    return 0.2126*R + 0.7152*G + 0.0722*B;
  }
  function pickTextColor(bg){ return (luminanceFromColor(bg) < 0.5) ? '#fff' : '#000'; }

/* ---------- Layout Modules ---------- */
// Load layout modules
let layoutModules = {
  linear: null,
  branched: null,
  dagre: null,
};

let graphV1 = null; // holds {nodes, edges, ...} when provided

// Function to load layout modules
function loadLayoutModules() {
  // Assume layout modules are defined globally or loaded via script tags
  if (typeof window.LAYOUT_LINEAR !== 'undefined') {
    layoutModules.linear = window.LAYOUT_LINEAR;
  }
  if (typeof window.LAYOUT_BRANCHED !== 'undefined') {
    layoutModules.branched = window.LAYOUT_BRANCHED;
  }
  if (typeof window.LAYOUT_DAGRE !== 'undefined') {
    layoutModules.dagre = window.LAYOUT_DAGRE;
  }
}

  /* ---------- Dynamic fan sizing ---------- */
  function calculateFanDimensions(fanHierarchy) {
    // Do a trial layout to calculate actual fan dimensions
    const trialNodes = [];
    const trialLinks = [];

    // Temporarily store original placedNodes/Links
    const originalNodes = placedNodes.slice();
    const originalLinks = placedLinks.slice();

    // Clear arrays for trial layout
    placedNodes = [];
    placedLinks = [];

    // Layout fan at origin to measure dimensions
    if (S.LAYOUT === 'linear') {
      layoutLinearSubtree(fanHierarchy, 0);
    } else {
      layoutBranchedSubtree(fanHierarchy, 0);
    }

    // Calculate dimensions
    const minX = d3.min(placedNodes, d => d.x - d.h/2) ?? 0;
    const maxX = d3.max(placedNodes, d => d.x + d.h/2) ?? 0;
    const minY = d3.min(placedNodes, d => d.y) ?? 0;
    const maxY = d3.max(placedNodes, d => d.y + d.w) ?? 0;

    const dimensions = {
      width: maxY - minY,
      height: maxX - minX,
      nodeCount: placedNodes.length
    };

    // Restore original arrays
    placedNodes = originalNodes;
    placedLinks = originalLinks;

    return dimensions;
  }

  /* ---------- Enhanced collision resolution ---------- */
  function resolveCollisionsWithForce() {
    // Separate nodes into different groups for better collision handling
    const fanNodes = placedNodes.filter(n => n.y < 0);
    const anchorNodes = placedNodes.filter(n => n.y >= 0);
    
    if (fanNodes.length === 0) return; // No fan nodes to resolve

    // Enhanced collision resolution with separate handling for ghosts and regular nodes
    const ghostNodes = fanNodes.filter(n => n.data.isGhost);
    const regularFanNodes = fanNodes.filter(n => !n.data.isGhost);

    // First, resolve collisions among all fan nodes (ghosts and regular)
    const fanSimulation = d3.forceSimulation(fanNodes)
      .force("collide", d3.forceCollide()
        .radius(d => {
          // Larger collision radius for ghost nodes to prevent overlap
          const baseRadius = Math.max(d.w, d.h) / 2;
          return d.data.isGhost ? baseRadius + 35 : baseRadius + 25;
        })
        .strength(1.0)
      )
      .force("x", d3.forceX()
        .x(d => d.y) // Maintain horizontal position
        .strength(0.4) // Stronger positioning for structure
      )
      .force("y", d3.forceY()
        .y(d => d.x) // Maintain vertical position  
        .strength(0.4)
      )
      .stop();

    // Run simulation for convergence
    for (let i = 0; i < 120; i++) {
      fanSimulation.tick();
    }

    // Update placedNodes with new positions
    fanNodes.forEach(node => {
      const placedNode = placedNodes.find(n => n.key === node.key);
      if (placedNode) {
        placedNode.x = node.x;
        placedNode.y = node.y;
      }
    });

    // Update corresponding links to maintain connectivity
    placedLinks.forEach(link => {
      // Update source positions
      const sourceNode = placedNodes.find(n => 
        Math.abs(n.y + n.w - link.sx) < 1 && Math.abs(n.x - link.sy) < 1
      );
      if (sourceNode) {
        link.sx = sourceNode.y + sourceNode.w;
        link.sy = sourceNode.x;
      }

      // Update target positions  
      const targetNode = placedNodes.find(n =>
        Math.abs(n.y - link.tx) < 1 && Math.abs(n.x - link.ty) < 1
      );
      if (targetNode) {
        link.tx = targetNode.y;
        link.ty = targetNode.x;
      }
    });
  }

  /* ---------- Data transformation functions for Dagre-ES ---------- */

  function normalizeNonNegativeY(placedNodes, placedLinks) {
  if (!placedNodes.length) return;
  let minY = Infinity;
  for (const n of placedNodes) minY = Math.min(minY, n.y);
  if (!Number.isFinite(minY) || minY >= 0) return;
  const delta = -minY + 1; // small margin
  placedNodes.forEach(n => { n.y += delta; });
  placedLinks.forEach(l => { l.sx += delta; l.tx += delta; });
}


  function convertTreeToDAGre(treeRoot) {
    // Convert regular tree data (d3.hierarchy) to Dagre graph
    const g = new dagre.graphlib.Graph();
    
    // Configure graph for left-to-right layout
    g.setGraph({
      rankdir: 'LR',
      ranksep: S.RANK_SEP,
      nodesep: S.NODE_SEP,
      edgesep: 10,
      marginx: 20,
      marginy: 20
    });
    
    // Set default edge label with weight property required by Dagre
    g.setDefaultEdgeLabel(() => ({ weight: 1 }));
    
    // Traverse tree and add nodes
    treeRoot.each(node => {
      const width = nodeW(node);
      const height = nodeH(node);
      
      g.setNode(key(node), {
        label: node.data.token || '',
        width: width,
        height: height,
        data: node.data,
        isGhost: !!node.data.isGhost,
        hnode: node
      });
      
      // Add edge from parent if exists with weight
      if (node.parent) {
        g.setEdge(key(node.parent), key(node), { weight: 1 });
      }
    });
    
    return g;
  }
  
  function convertBundleToDAGre(bundleData) {
    const { nodes_by_id, anchor_root_id, root } = bundleData;
    
    // Create new Dagre graph
    const g = new dagre.graphlib.Graph();
    
    // Configure graph for left-to-right layout
    g.setGraph({
      rankdir: 'LR',  // Left-to-Right direction
      ranksep: S.RANK_SEP,  // Horizontal separation between ranks
      nodesep: S.NODE_SEP,  // Vertical separation between nodes in same rank
      edgesep: 10,    // Separation between edges
      marginx: 20,    // Graph margin
      marginy: 20
    });
    
    // Set default edge label with weight property required by Dagre
    g.setDefaultEdgeLabel(() => ({ weight: 1 }));
    
    // Add real nodes to graph
    for (const [nodeId, nodeData] of Object.entries(nodes_by_id)) {
      // Create temporary hierarchy node for sizing
      const tempHNode = { data: nodeData };
      const width = nodeW(tempHNode);
      const height = nodeH(tempHNode);
      
      g.setNode(nodeId, {
        label: nodeData.token || nodeId,
        width: width,
        height: height,
        data: nodeData,
        isGhost: false
      });
    }
    
    // Add ghost nodes for theoretical edges - for ALL nodes that have them
    let ghostCounter = 0;
    for (const [nodeId, nodeData] of Object.entries(nodes_by_id)) {
      if (nodeData.theoretical_edges && nodeData.theoretical_edges.length > 0) {
        for (const theoreticalEdge of nodeData.theoretical_edges) {
          const ghostId = `ghost_${nodeId}_${theoreticalEdge.token}_${ghostCounter++}`;
          
          // Create ghost node data
          const ghostData = {
            token: theoreticalEdge.token,
            model_prob_here: theoreticalEdge.avg_prob,
            isGhost: true,
            position: (nodeData.position || 0) + 1,
            id: ghostId
          };
          
          // Create temporary hierarchy node for sizing
          const tempGhostHNode = { data: ghostData };
          const ghostWidth = nodeW(tempGhostHNode);
          const ghostHeight = nodeH(tempGhostHNode);
          
          g.setNode(ghostId, {
            label: theoreticalEdge.token,
            width: ghostWidth,
            height: ghostHeight,
            data: ghostData,
            isGhost: true
          });
          
          // Add edge from parent to ghost node
          g.setEdge(nodeId, ghostId, { weight: 1 });
        }
      }
    }
    
    // Add real edges to graph
    for (const [nodeId, nodeData] of Object.entries(nodes_by_id)) {
      if (nodeData.children) {
        for (const childRef of nodeData.children) {
          const childId = typeof childRef === 'string' ? childRef : childRef.id;
          if (nodes_by_id[childId]) {
            g.setEdge(nodeId, childId, { weight: 1 });
          }
        }
      }
    }
    
    return g;
  }
  
  function convertDagreToPlacedNodes(dagreGraph) {
    const { nodes_by_id } = bundleData;
    
    // Clear existing arrays
    placedNodes = [];
    placedLinks = [];
    
    // Convert nodes (both real and ghost)
    dagreGraph.nodes().forEach(nodeId => {
      const dagreNode = dagreGraph.node(nodeId);
      
      if (!dagreNode) return;
      
      // Check if this is a ghost node or real node
      const isGhostNode = dagreNode.isGhost;
      let nodeData, hnode;
      
      if (isGhostNode) {
        // Ghost node - use data from Dagre node
        nodeData = dagreNode.data;
        hnode = { data: nodeData };
      } else {
        // Real node - use data from nodes_by_id
        nodeData = nodes_by_id[nodeId];
        if (!nodeData) return;
        hnode = { data: nodeData };
      }
      
      // Dagre coordinates: x is horizontal (left-to-right), y is vertical
      // Our coordinate system: x is vertical, y is horizontal
      placedNodes.push({
        x: dagreNode.y,  // Dagre y becomes our x (vertical position)
        y: dagreNode.x,  // Dagre x becomes our y (horizontal position)
        w: dagreNode.width,
        h: dagreNode.height,
        hnode: hnode,
        data: nodeData,
        depth: isGhostNode ? (nodeData.position || 0) : calculateNodeDepth(nodeId, nodes_by_id),
        key: isGhostNode ? nodeData.id : (nodeData.id || `${nodeData.token}:${calculateNodeDepth(nodeId, nodes_by_id)}`)
      });
    });
    
    // After convertDagreToPlacedNodes(...) and enforceFanAnchorSpacingAndMinAngle(...)
    normalizeNonNegativeY(placedNodes, placedLinks);

    const bbox = sizeSvgToContent(placedNodes); // or your wrapper
    return bbox;


    // Convert edges
    dagreGraph.edges().forEach(edgeObj => {
      const sourceId = edgeObj.v;
      const targetId = edgeObj.w;
      
      const sourceNode = placedNodes.find(n => {
        return n.data.id === sourceId || (n.hnode.data.id === sourceId);
      });
      const targetNode = placedNodes.find(n => {
        return n.data.id === targetId || (n.hnode.data.id === targetId);
      });
      
      if (sourceNode && targetNode) {
        const sx = sourceNode.y + sourceNode.w;
        const sy = sourceNode.x;
        const tx = targetNode.y;
        const ty = targetNode.x;
        
        // Determine if this is a ghost edge
        const isGhostEdge = targetNode.data.isGhost;
        
        // Calculate edge probability
        let prob = 0;
        if (isGhostEdge) {
          // Ghost edge - use model probability
          prob = targetNode.data.model_prob_here || 0;
        } else {
          // Real edge - calculate from empirical data
          const sourceData = sourceNode.data;
          const targetToken = targetNode.data.token;
          const empChildren = sourceData.emp_children || {};
          const parentTotal = Object.values(empChildren).reduce((sum, count) => sum + count, 0);
          const targetCount = empChildren[targetToken] || 0;
          prob = parentTotal > 0 ? targetCount / parentTotal : 0;
        }
        
        placedLinks.push({
          sx, sy, tx, ty,
          ghost: isGhostEdge,
          p: prob
        });
      }
    });
  }
  
  function calculateNodeDepth(nodeId, nodes_by_id) {
    // Calculate depth based on node type and position
    const nodeData = nodes_by_id[nodeId];
    if (!nodeData) return 0;
    
    if (nodeData.is_root) {
      return 0;
    } else if (nodeData.is_prefix) {
      // Fan nodes: depth based on path length
      return Array.isArray(nodeData.path) ? nodeData.path.length : 0;
    } else {
      // Tree nodes: use position
      return (nodeData.position || 0) + 1;
    }
  }

  /* ---------- Fan-Anchor Spacing and Angle Enforcement ---------- */
  function enforceFanAnchorSpacingAndMinAngle(bundleData, S, placedNodes, placedLinks) {
  // Identify fan (prefix/root) vs anchor nodes by key
  const fanNodeKeys = new Set();
  placedNodes.forEach(n => {
    if (n.data.is_prefix || n.data.is_root) fanNodeKeys.add(n.key);
  });

  // Compute required right-shift so fan→anchor links are not too steep
  let maxRequiredShift = 0;
  const TAN_MAX = Math.tan((S.ANG_MAX_DEG || 60) * Math.PI / 180);

  placedLinks.forEach(link => {
    // Re-find endpoints from placedNodes (tolerant match)
    const sourceNode = placedNodes.find(n =>
      Math.abs(n.y + n.w - link.sx) < 1 && Math.abs(n.x - link.sy) < 1
    );
    const targetNode = placedNodes.find(n =>
      Math.abs(n.y - link.tx) < 1 && Math.abs(n.x - link.ty) < 1
    );
    if (!sourceNode || !targetNode) return;

    // We only care about fan → anchor edges
    const sourceFan = fanNodeKeys.has(sourceNode.key);
    const targetAnchor = !fanNodeKeys.has(targetNode.key);
    if (!sourceFan || !targetAnchor) return;

    if (!(Number.isFinite(TAN_MAX) && TAN_MAX > 0)) return;

    const dx = link.tx - link.sx;
    const dy = Math.abs(link.ty - link.sy);
    const minDx = dy / TAN_MAX;

    if (dx < minDx) {
      maxRequiredShift = Math.max(maxRequiredShift, (minDx - dx));
    }
  });

  if (maxRequiredShift <= 0) return;

  // Cap shift to something reasonable relative to rank separation
  const cap = Math.max(200, (S.RANK_SEP || 200) * 1.5);
  const totalShift = Math.min(maxRequiredShift + 20, cap); // +padding

  // Shift ANCHOR nodes to the RIGHT (do not move the fan/root left)
  placedNodes.forEach(n => {
    if (!fanNodeKeys.has(n.key)) {
      n.y += totalShift;
    }
  });

  // Update link endpoints to reflect shifted anchor nodes
  placedLinks.forEach(link => {
    const sourceNode = placedNodes.find(n =>
      Math.abs(n.y + n.w - link.sx) < 1 && Math.abs(n.x - link.sy) < 1
    );
    const targetNode = placedNodes.find(n =>
      Math.abs(n.y - link.tx) < 1 && Math.abs(n.x - link.ty) < 1
    );
    if (sourceNode) {
      link.sx = sourceNode.y + sourceNode.w;
      link.sy = sourceNode.x;
    }
    if (targetNode) {
      link.tx = targetNode.y;
      link.ty = targetNode.x;
    }
  });
}

  /* ---------- DAG Sugiyama Layout with Dagre-ES ---------- */
  function layoutDagSugiyama() {
    const { nodes_by_id, anchor_root_id } = bundleData;
    
    placedNodes = [];
    placedLinks = [];

    // Check if Dagre-ES is available
    if (typeof dagre === 'undefined') {
      console.error('Dagre-ES library not loaded properly. Cannot proceed without Dagre.');
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, pad: 40, width: 400, height: 300 };
    }

    console.log('Using Dagre layout (no fallback)');

    try {
      // Convert bundle data to Dagre graph
      const dagreGraph = convertBundleToDAGre(bundleData);
      
      // Apply Dagre layout
      dagre.layout(dagreGraph);
      
      // Convert Dagre results back to placed nodes and links
      convertDagreToPlacedNodes(dagreGraph);
      
      // Enforce fan-anchor spacing and minimum angle constraints
      enforceFanAnchorSpacingAndMinAngle();

      const bbox = sizeSvgToContent();
      renderVisible();
      return bbox;
      
    } catch (error) {
      console.error('Dagre-ES layout failed:', error);
      // Return empty layout instead of falling back
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, pad: 40, width: 400, height: 300 };
    }
  }



  /* ---------- Size SVG ---------- */
  function sizeSvgToContent(){
    const minX = d3.min(placedNodes, d => d.x - d.h/2) ?? -50;
    const maxX = d3.max(placedNodes, d => d.x + d.h/2) ??  50;
    const minY = d3.min(placedNodes, d => d.y) ?? 0;
    const maxY = d3.max(placedNodes, d => d.y + d.w) ?? 0;
    const pad = 40;
    const width  = (maxY - minY) + 2*pad;
    const height = (maxX - minX) + 2*pad;

    svg.attr('width',  Math.max(400, Math.ceil(width)));
    svg.attr('height', Math.max(300, Math.ceil(height)));

    // UI owns the zoom transform; we only size the canvas here.
    return {minX, maxX, minY, maxY, pad, width, height};
  }

  /* ---------- Render (virtualized) ---------- */
  function renderVisible(){
    const k = curTransform.k || 1;
    const offX = curTransform.x;
    const offY = curTransform.y;
    const hideAllText = k < 0.05;           // Hide everything below 5%
    const hideMetaOnly = k >= 0.05 && k < 0.25;  // Show only token between 5-25%
    const simplifyLines = k < 0.3;

    const viewLeft = stageEl.scrollLeft;
    const viewRight = viewLeft + stageEl.clientWidth;
    const viewTop = stageEl.scrollTop;
    const viewBot = viewTop + stageEl.clientHeight;
    const pad = 300;

    const nodeVisible = (n)=>{
      const sx1 = n.y * k + offX;
      const sx2 = sx1 + n.w * k;
      const sy1 = (n.x - n.h/2) * k + offY;
      const sy2 = (n.x + n.h/2) * k + offY;
      return (sx2 >= viewLeft - pad && sx1 <= viewRight + pad &&
              sy2 >= viewTop  - pad && sy1 <= viewBot   + pad);
    };

    const linkVisible = (l)=>{
      const sx = l.sx * k + offX, tx = l.tx * k + offX;
      const sy = l.sy * k + offY, ty = l.ty * k + offY;
      const minX = Math.min(sx, tx), maxX = Math.max(sx, tx);
      const minY = Math.min(sy, ty), maxY = Math.max(sy, ty);
      return (maxX >= viewLeft - pad && minX <= viewRight + pad &&
              maxY >= viewTop  - pad && minY <= viewBot   + pad);
    };

    // Build a map from node key -> placed node
    const byKey = new Map(placedNodes.map(n => [n.key, n]));

    // Only keep links whose endpoints are visible AND recompute endpoints from nodes
    function resolveLink(l){
      const s = byKey.get(l.skey), t = byKey.get(l.tkey);
      if (!s || !t) return null;
      return {
        ...l,
        sx: s.y + s.w,
        sy: s.x,
        tx: t.y,
        ty: t.x
      };
    }

    const nodesV = placedNodes.filter(nodeVisible);
    const visibleKeys = new Set(nodesV.map(n => n.key));

    const linksV = placedLinks
      .filter(l => visibleKeys.has(l.skey) && visibleKeys.has(l.tkey))
      .map(resolveLink)
      .filter(Boolean);

    // LINKS (black; dashed for ghosts unless simplified)
    const linkSel = gLinks.selectAll('path.link').data(linksV, d => (d.skey && d.tkey) ? `${d.skey}->${d.tkey}` : `${d.sx},${d.sy}->${d.tx},${d.ty}`);
    linkSel.enter().append('path')
      .attr('class', d => 'link' + (d.ghost && !simplifyLines ? ' ghost' : ''))
      .merge(linkSel)
      .attr('d', d => {
        const sx = d.sx, sy = d.sy, tx = d.tx, ty = d.ty;
        if (sy === ty) return `M${sx},${sy} L${tx},${ty}`;
        const dx = tx - sx;
        const c1x = sx + dx*0.45, c1y = sy;
        const c2x = sx + dx*0.55, c2y = ty;
        return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
      })
      .attr('stroke-width', simplifyLines ? 1 : S.LINK_PX)
      .attr('stroke', 'var(--fg)');
    linkSel.exit().remove();

    // NODES (Viridis fill; ghosts muted)
    const nodeSel = gNodes.selectAll('g.node').data(nodesV, d => d.key);
    const enter = nodeSel.enter().append('g')
      .attr('class', d => 'node' + (d.data.isGhost ? ' ghost' : ''))
      .on('click', (ev,d) => {
        // optional collapse/expand can be wired here in the future
      });

    enter.append('rect');
    const tt = enter.append('text').attr('text-anchor','start');
    tt.append('tspan').attr('class','tok');
    tt.append('tspan').attr('class','meta meta1');
    tt.append('tspan').attr('class','meta meta2');

    nodeSel.merge(enter)
      .attr('class', d => `node${d.data.isGhost?' ghost':''}${matchKeySet.has(d.key)?' match':''}`)
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .each(function(d){
        const rect = d3.select(this).select('rect');
        const textEl = d3.select(this).select('text');
        const p = parts(d.hnode);

        if (d.hnode.data.position < 0){
          textEl.selectAll('tspan').remove();
          const maxW = d.w - S.PAD_X*2;
          const lines = wrapLines(p.tok, maxW, S.TOKEN_FPX);
          const startY = -d.h/2 + S.PAD_T + S.TOKEN_FPX*0.8;
          lines.forEach((line, i) => {
            textEl.append('tspan')
              .attr('class','tok')
              .attr('text-anchor','end')
              .attr('x', d.w - S.PAD_X)
              .attr('y', startY + i*(S.TOKEN_FPX + 4))
              .style('font-size', S.TOKEN_FPX+'px')
              .style('fill', '#111')
              .text(line);
          });
          rect.attr('x',0).attr('y',-d.h/2).attr('width',d.w).attr('height',d.h)
              .style('fill', '#ffffff');
          return;
        }

        const tokSpan  = textEl.select('tspan.tok').style('font-size', S.TOKEN_FPX+'px');
        const meta1    = textEl.select('tspan.meta1').style('font-size', S.META_FPX+'px');
        const meta2    = textEl.select('tspan.meta2').style('font-size', S.META_FPX+'px');

        const metaCount = (p.metaEmp?1:0) + (p.metaModel?1:0);
        const metaBlock = metaCount ? (metaCount*S.META_FPX + (metaCount-1)*4) : 0;

        const yTok   = - (metaBlock ? (metaBlock/2) : 0);
        let   yMeta1 = (S.TOKEN_FPX/2 + 6) - (metaBlock ? (metaBlock/2) : 0);
        const lineStep = S.META_FPX + 4;

        // Handle three zoom levels: hide all, token only, or full details
        if (hideAllText) {
          // Below 5% zoom: hide all text
          tokSpan.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', yTok).text('');
          meta1.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=1 ? yMeta1 : yTok).text('');
          meta2.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=2 ? (yMeta1 + lineStep) : yMeta1).text('');
        } else if (hideMetaOnly) {
          // 5-25% zoom: show only token, scaled up to fill rectangle
          const scaledFontSize = Math.min(S.TOKEN_FPX * 3, d.h * 0.8); // Scale up but don't exceed rectangle height
          const scaledY = scaledFontSize * 0.35; // Center vertically (approximate font baseline offset)

          tokSpan.attr('text-anchor','middle').attr('x', d.w / 2).attr('y', scaledY).text(p.tok);
          tokSpan.style('font-size', scaledFontSize + 'px');

          // Hide metadata
          meta1.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=1 ? yMeta1 : yTok).text('');
          meta2.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=2 ? (yMeta1 + lineStep) : yMeta1).text('');
        } else {
          // Above 25% zoom: show full details
          tokSpan.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', yTok).text(p.tok);
          tokSpan.style('font-size', S.TOKEN_FPX + 'px');
          meta1.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=1 ? yMeta1 : yTok).text(p.metaEmp || '');
          meta2.attr('text-anchor','start').attr('x', S.PAD_X).attr('y', metaCount>=2 ? (yMeta1 + lineStep) : yMeta1).text(p.metaModel || '');
        }

        const isGhost = !!d.data.isGhost;
        const prob = isGhost ? d.hnode.data.model_prob_here : d.hnode.data.emp_freq_here;
        let fillColor = viridis(norm(prob ?? 0));
        if (isGhost) fillColor = d3.interpolateRgb(fillColor, '#e5e5e5')(0.65); // was 0.85; make less washed out

        rect.attr('x',0).attr('y',-d.h/2).attr('width', d.w).attr('height', d.h).style('fill', fillColor);

        const textColor = pickTextColor(fillColor);
        tokSpan.style('fill', textColor);
        meta1.style('fill', textColor);
        meta2.style('fill', textColor);
      });

    nodeSel.exit().remove();
  }

  function scheduleRenderVisible(){
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(()=>{ drawScheduled=false; renderVisible(); });
  }

  /* ---------- Public: transform control from UI ---------- */
  function setTransform(t){
    curTransform = t;
    gRoot.attr('transform', t.toString());
    scheduleRenderVisible();
  }

  /* ---------- Public: data/load/layout ---------- */
  let bundleData = null; // Store original bundle for DAG layout

  function loadData(data){
    // Reset state
    bundleData = null;   // legacy bundle
    graphV1 = null;      // graph v1
    rawData = null;
    sourceData = null;
    root = null;

    if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
      // GRAPH_V1
      graphV1 = data;
      // No rebuildSource/buildHierarchy here; Dagre will consume graphV1 directly.
    } else if (data && data.root && data.nodes_by_id) {
      // Legacy DAG bundle
      bundleData = data;
      rawData = resolveBundleToTree(data);  // keep legacy tree fallback for non-Dagre layouts
    } else {
      // Plain nested tree data (already has children)
      rawData = data;
    }

    // Only prepare hierarchy paths for non-GRAPH_V1 inputs
    if (!graphV1 && rawData) {
      rebuildSource();
      buildHierarchy();
    }
  }

function layoutAndRender(){
  // Clear arrays before layout switch to prevent carryover
  placedNodes.length = 0;
  placedLinks.length = 0;

  if (S.LAYOUT === 'dagre') {
    if (typeof dagre === 'undefined') {
      console.error('Dagre library not loaded. Falling back to branched layout.');
      // existing fallback block stays the same...
      if (root) {
        const mat = d3.hierarchy(root.data, d => (d.children||[]));
        if (layoutModules.branched && typeof layoutModules.branched.layoutBranched === 'function') {
          layoutModules.branched.layoutBranched(mat, { S, placedNodes, placedLinks, nodeW, nodeH }, d3);
        }
      } else {
        console.warn('[VIZ] No tree root available for branched layout fallback.');
      }
      const bbox = sizeSvgToContent();
      renderVisible();
      return bbox;
    }

    // >>> NEW: prefer GRAPH_V1
    if (graphV1 && layoutModules.dagre && typeof layoutModules.dagre.layoutDagSugiyama === 'function') {
      const bbox = layoutModules.dagre.layoutDagSugiyama(graphV1, {
        key, S, placedNodes, placedLinks, nodeW, nodeH, sizeSvgToContent
      });
      renderVisible();
      return bbox;
    }

    // Legacy bundle path (unchanged)
    if (bundleData && layoutModules.dagre && typeof layoutModules.dagre.layoutDagSugiyama === 'function') {
      const bbox = layoutModules.dagre.layoutDagSugiyama(bundleData, {
        key, S, placedNodes, placedLinks, nodeW, nodeH, sizeSvgToContent
      });
      renderVisible();
      return bbox;
    }

    // Plain tree → Dagre path (unchanged)
    try {
      const mat = d3.hierarchy(root.data, d => (d.children||[]));
      const dagreGraph = convertTreeToDAGre(mat);
      dagre.layout(dagreGraph);

      placedNodes = [];
      placedLinks = [];

      dagreGraph.nodes().forEach(nodeKey => {
        const dagreNode = dagreGraph.node(nodeKey);
        if (!dagreNode) return;
        placedNodes.push({
          x: dagreNode.y,
          y: dagreNode.x,
          w: dagreNode.width,
          h: dagreNode.height,
          hnode: dagreNode.hnode,
          data: dagreNode.data,
          depth: dagreNode.hnode.depth,
          key: nodeKey
        });
      });

      dagreGraph.edges().forEach(edgeObj => {
        const sourceKey = edgeObj.v;
        const targetKey = edgeObj.w;
        const sourceNode = placedNodes.find(n => n.key === sourceKey);
        const targetNode = placedNodes.find(n => n.key === targetKey);
        if (!sourceNode || !targetNode) return;
        placedLinks.push({
          sx: sourceNode.y + sourceNode.w,
          sy: sourceNode.x,
          tx: targetNode.y,
          ty: targetNode.x,
          ghost: !!targetNode.data.isGhost,
          p: targetNode.data.isGhost
              ? (targetNode.data.model_prob_here || 0)
              : (targetNode.data.emp_freq_here || 0)
        });
      });

      const bbox = sizeSvgToContent();
      renderVisible();
      return bbox;
    } catch (error) {
      console.error('Dagre tree layout failed:', error);
      const mat = d3.hierarchy(root.data, d => (d.children||[]));
      if (layoutModules.branched && typeof layoutModules.branched.layoutBranched === 'function') {
        layoutModules.branched.layoutBranched(mat, { S, placedNodes, placedLinks, nodeW, nodeH }, d3);
      }
      const bbox = sizeSvgToContent();
      renderVisible();
      return bbox;
    }
  }

  // Existing non-Dagre path (unchanged)
  if (S.LAYOUT === 'linear') {
    if (layoutModules.linear && typeof layoutModules.linear.layoutLinear === 'function') {
      if (graphV1) {
        // GRAPH_V1 path (no d3.hierarchy needed)
        layoutModules.linear.layoutLinear(
          graphV1,
          { S, placedNodes, placedLinks, bestChildPack, nodeW, nodeH, key },
          d3
        );
      } else if (root) {
        // Tree path (existing behavior) - only create mat if root exists
        const mat = d3.hierarchy(root.data, d => (d.children || []));
        layoutModules.linear.layoutLinear(
          mat,
          { S, placedNodes, placedLinks, bestChildPack, nodeW, nodeH, key },
          d3
        );
      } else {
        console.warn('[VIZ] No data available for linear layout.');
      }
    } else {
      console.error('Linear layout module not available');
    }

    const bbox = sizeSvgToContent();
    renderVisible();
    return bbox;
  }

  // Branched layout (explicit selection)
  if (S.LAYOUT === 'branched') {
    if (layoutModules.branched && typeof layoutModules.branched.layoutBranched === 'function') {
      if (graphV1) {
        // For GRAPH_V1, we need to convert to hierarchy first
        // Use the graphV1ToHierarchy function from linear.js if available
        if (layoutModules.linear && layoutModules.linear.graphV1ToHierarchy) {
          const mat = layoutModules.linear.graphV1ToHierarchy(graphV1, d3);
          layoutModules.branched.layoutBranched(mat, { S, placedNodes, placedLinks, nodeW, nodeH }, d3);
        } else {
          console.warn('[VIZ] Cannot convert GRAPH_V1 to hierarchy for branched layout.');
        }
      } else if (root) {
        // Tree path (existing behavior) - only create mat if root exists
        const mat = d3.hierarchy(root.data, d => (d.children || []));
        layoutModules.branched.layoutBranched(mat, { S, placedNodes, placedLinks, nodeW, nodeH }, d3);
      } else {
        console.warn('[VIZ] No data available for branched layout.');
      }
    } else {
      console.error('Branched layout module not available');
    }

    const bbox = sizeSvgToContent();
    renderVisible();
    return bbox;
  }

}
function syncLayoutSelectWithViz() {
  const s = VIZ.getSettings();
  if (ui.selLayout && s && s.LAYOUT) {
    if (ui.selLayout.value !== s.LAYOUT) {
      console.warn(`[UI] Layout switched to "${s.LAYOUT}" (GRAPH_V1 requires Dagre).`);
    }
    ui.selLayout.value = s.LAYOUT;
  }
}


  /* ---------- Public: search ---------- */
  function runSearch(query){
    const q=(query||'').toLowerCase().trim();
    searchMatches = [];
    matchKeySet.clear();
    if (!q){
      scheduleRenderVisible();
      return {count:0};
    }
    placedNodes.forEach((n, idx) => {
      const tok = String(n.hnode.data.token ?? '').toLowerCase();
      if (tok.includes(q)) {
        searchMatches.push(idx);
        matchKeySet.add(n.key);
      }
    });
    scheduleRenderVisible();
    return {count: searchMatches.length};
  }

  function getSearchMatches(){ return [...searchMatches]; }
  function getPlacedNode(idx){ return placedNodes[idx]; }
  function getPromptNode(){ return placedNodes.find(n => n.data.position < 0) || null; }
  function getAllPlaced(){ return placedNodes; }
  function getPlacedLinks(){ return placedLinks; }

  /* ---------- Export functions ---------- */
  function buildStandaloneSVG(options = {}) {
    const {
      includeLegend = true,
      background = '#fff',
      margin = 40,
      legendHeight = 80
    } = options;

    if (!placedNodes.length) return { svgString: '', width: 0, height: 0 };

    // Calculate content bounds
    const minX = d3.min(placedNodes, d => d.x - d.h/2) ?? -50;
    const maxX = d3.max(placedNodes, d => d.x + d.h/2) ?? 50;
    const minY = d3.min(placedNodes, d => d.y) ?? 0;
    const maxY = d3.max(placedNodes, d => d.y + d.w) ?? 0;

    const contentWidth = (maxY - minY) + 2 * margin;
    const contentHeight = (maxX - minX) + 2 * margin;
    const totalHeight = contentHeight + (includeLegend ? legendHeight : 0);

    // Create SVG string
    let svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${contentWidth}" height="${totalHeight}" viewBox="0 0 ${contentWidth} ${totalHeight}">`;
    
    // Background
    svgString += `<rect width="100%" height="100%" fill="${background}"/>`;
    
    // Content group with transform to center content
    const offsetX = margin - minY;
    const offsetY = margin - minX;
    svgString += `<g transform="translate(${offsetX}, ${offsetY})">`;

    // Render all links
    for (const link of placedLinks) {
      const sx = link.sx, sy = link.sy, tx = link.tx, ty = link.ty;
      let pathD;
      if (sy === ty) {
        pathD = `M${sx},${sy} L${tx},${ty}`;
      } else {
        const dx = tx - sx;
        const c1x = sx + dx * 0.45, c1y = sy;
        const c2x = sx + dx * 0.55, c2y = ty;
        pathD = `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
      }
      
      const strokeDasharray = link.ghost ? '5,4' : 'none';
      svgString += `<path d="${pathD}" stroke="var(--fg)" stroke-width="${S.LINK_PX}" fill="none" stroke-dasharray="${strokeDasharray}"/>`;
    }

    // Render all nodes
    for (const node of placedNodes) {
      const p = parts(node.hnode);
      const isGhost = !!node.data.isGhost;
      
      // Node group
      svgString += `<g transform="translate(${node.y}, ${node.x})">`;
      
      if (node.data.position < 0 || node.data.is_root) {
        // Root/prompt node - white fill with border
        const fillColor = '#ffffff';
        const textColor = '#000';
        svgString += `<rect x="0" y="${-node.h/2}" width="${node.w}" height="${node.h}" rx="6" ry="6" fill="${fillColor}" stroke="#222" stroke-width="1"/>`;
        
        // Prompt node - multi-line text
        const maxW = node.w - S.PAD_X * 2;
        const lines = wrapLines(p.tok, maxW, S.TOKEN_FPX);
        const startY = -node.h/2 + S.PAD_T + S.TOKEN_FPX * 0.8;
        
        for (let i = 0; i < lines.length; i++) {
          const y = startY + i * (S.TOKEN_FPX + 4);
          svgString += `<text x="${node.w - S.PAD_X}" y="${y}" text-anchor="end" font-size="${S.TOKEN_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(lines[i])}</text>`;
        }
      } else {
        // Regular node - viridis color based on probability with border
        const prob = isGhost ? node.hnode.data.model_prob_here : node.hnode.data.emp_freq_here;
        let fillColor = viridis(norm(prob ?? 0));
        if (isGhost) fillColor = d3.interpolateRgb(fillColor, '#e5e5e5')(0.85);
        const textColor = pickTextColor(fillColor);
        const strokeColor = isGhost ? '#888' : '#222';
        const strokeDasharray = isGhost ? '4,3' : 'none';
        
        svgString += `<rect x="0" y="${-node.h/2}" width="${node.w}" height="${node.h}" rx="6" ry="6" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1" stroke-dasharray="${strokeDasharray}"/>`;
        
        const metaCount = (p.metaEmp ? 1 : 0) + (p.metaModel ? 1 : 0);
        const metaBlock = metaCount ? (metaCount * S.META_FPX + (metaCount - 1) * 4) : 0;
        
        const yTok = -(metaBlock ? (metaBlock / 2) : 0);
        let yMeta1 = (S.TOKEN_FPX / 2 + 6) - (metaBlock ? (metaBlock / 2) : 0);
        const lineStep = S.META_FPX + 4;
        
        // Token text
        svgString += `<text x="${S.PAD_X}" y="${yTok}" text-anchor="start" font-size="${S.TOKEN_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(p.tok)}</text>`;
        
        // Meta text
        if (p.metaEmp) {
          svgString += `<text x="${S.PAD_X}" y="${metaCount >= 1 ? yMeta1 : yTok}" text-anchor="start" font-size="${S.META_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(p.metaEmp)}</text>`;
        }
        if (p.metaModel) {
          svgString += `<text x="${S.PAD_X}" y="${metaCount >= 2 ? (yMeta1 + lineStep) : yMeta1}" text-anchor="start" font-size="${S.META_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(p.metaModel)}</text>`;
        }
      }
      
      svgString += '</g>';
    }
    
    svgString += '</g>'; // Close content group

    // Add legend if requested
    if (includeLegend) {
      const legendY = contentHeight + 60;
      const legendX = margin + 40;
      
      // Create discrete color blocks instead of gradient for better PDF compatibility (4x larger)
      const barWidth = 800;
      const barHeight = 48;
      const numBlocks = 50; // Number of color blocks to simulate gradient
      const blockWidth = barWidth / numBlocks;
      
      for (let i = 0; i < numBlocks; i++) {
        const t = i / (numBlocks - 1);
        const color = viridis(t);
        const x = legendX + i * blockWidth;
        svgString += `<rect x="${x}" y="${legendY}" width="${blockWidth}" height="${barHeight}" fill="${color}" stroke="none"/>`;
      }
      
      // Add border around the color bar
      svgString += `<rect x="${legendX}" y="${legendY}" width="${barWidth}" height="${barHeight}" fill="none" stroke="#000" stroke-width="2"/>`;
      
      // All legend items on one line with proper spacing
      let currentX = legendX + barWidth + 40;
      
      // Probability label
      svgString += `<text x="${currentX}" y="${legendY + barHeight / 2 + 10}" font-size="28px" font-family="Arial, sans-serif" fill="#000">Probability (0% to 100%)</text>`;
      currentX += 600;
      
      // Observed path line sample
      svgString += `<line x1="${currentX}" y1="${legendY + barHeight / 2}" x2="${currentX + 60}" y2="${legendY + barHeight / 2}" stroke="#000" stroke-width="4"/>`;
      svgString += `<text x="${currentX + 75}" y="${legendY + barHeight / 2 + 10}" font-size="24px" font-family="Arial, sans-serif" fill="#000">Observed path</text>`;
      currentX += 320;
      
      // Predicted path dashed line sample
      svgString += `<line x1="${currentX}" y1="${legendY + barHeight / 2}" x2="${currentX + 60}" y2="${legendY + barHeight / 2}" stroke="#000" stroke-width="4" stroke-dasharray="10,8"/>`;
      svgString += `<text x="${currentX + 75}" y="${legendY + barHeight / 2 + 10}" font-size="24px" font-family="Arial, sans-serif" fill="#000">Predicted path</text>`;
    }
    
    svgString += '</svg>';
    
    return { svgString, width: contentWidth, height: totalHeight };
  }

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function savePDF(options = {}) {
    const { filename = 'token-tree.pdf' } = options;
    const { svgString, width, height } = buildStandaloneSVG(options);
    if (!svgString) return Promise.reject(new Error('No SVG content to export'));
    
    return new Promise((resolve, reject) => {
      try {
        // Parse SVG string into DOM element
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgElement = svgDoc.documentElement;
        
        // Convert pixels to points (72 points per inch, 96 pixels per inch)
        const pxToPt = 72 / 96;
        let wPt = width * pxToPt;
        let hPt = height * pxToPt;
        
        // Cap to PDF maximum dimensions (14,400 pt per side)
        const maxPt = 14400;
        if (wPt > maxPt || hPt > maxPt) {
          const scale = maxPt / Math.max(wPt, hPt);
          wPt *= scale;
          hPt *= scale;
        }
        
        // Determine orientation
        const orientation = wPt >= hPt ? 'landscape' : 'portrait';
        
        // Create PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: orientation,
          unit: 'pt',
          format: [wPt, hPt]
        });
        
        // Use the jsPDF svg plugin to render the SVG as vectors into the PDF
        pdf.svg(svgElement, {
          x: 0,
          y: 0,
          width: wPt,
          height: hPt
        }).then(() => {
          // Save the PDF
          pdf.save(filename);
          resolve();
        }).catch(reject);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /* ---------- Expose ---------- */
  return {
    init,
    setSettings, getSettings,
    loadData, layoutAndRender,
    setTransform,
    runSearch, getSearchMatches, getPlacedNode, getPromptNode, getAllPlaced, getPlacedLinks,
    renderVisible, // UI may call on scroll
    buildStandaloneSVG, savePDF, // Export functions
  };
})();
