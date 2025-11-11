// PDF Export Module (jsPDF + svg2pdf) for exporting the D3 visualization
// Requires (load in this order, before this file):
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
//   <script src="https://unpkg.com/svg2pdf.js@2.2.2/dist/svg2pdf.umd.min.js"></script>
window.PDF_EXPORT = (function () {

  /* ---------- Utilities ---------- */

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function luminanceFromColor(c) {
    let r = 0, g = 0, b = 0;
    if (c && c.startsWith('#')) {
      const n = c.length === 7 ? parseInt(c.slice(1), 16) : 0;
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
      const m = (c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
    const sr = r / 255, sg = g / 255, sb = b / 255;
    const lin = u => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
    const R = lin(sr), G = lin(sg), B = lin(sb);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  function pickTextColor(bgCss) { return (luminanceFromColor(bgCss) < 0.5) ? '#fff' : '#000'; }
  function estimateWidth(text, px) { return 0.6 * px * (text?.length || 0); }
  function wrapLines(text, maxPx, px) {
    const words = String(text || "").split(/\s+/);
    const lines = []; let cur = "";
    for (const w of words) {
      const trial = cur ? (cur + " " + w) : w;
      if (estimateWidth(trial, px) <= maxPx) cur = trial;
      else {
        if (cur) lines.push(cur);
        if (estimateWidth(w, px) > maxPx) {
          let chunk = "";
          for (const ch of w) {
            const t = chunk + ch;
            if (estimateWidth(t, px) <= maxPx) chunk = t;
            else { lines.push(chunk); chunk = ch; }
          }
          cur = chunk;
        } else cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ---------- Build SVG from current VIZ state ---------- */
  function buildStandaloneSVG(options = {}) {
    const {
      includeLegend = true,
      background = '#fff',
      margin = 400,
      legendHeight = 400
    } = options;

    const placedNodes = VIZ.getAllPlaced();
    const placedLinks = VIZ.getPlacedLinks();
    const S = VIZ.getSettings();

    if (!placedNodes.length) return { svgString: '', width: 0, height: 0 };

    // Bounds
    const minX = d3.min(placedNodes, d => d.x - d.h / 2) ?? -50;
    const maxX = d3.max(placedNodes, d => d.x + d.h / 2) ??  50;
    const minY = d3.min(placedNodes, d => d.y) ?? 0;
    const maxY = d3.max(placedNodes, d => d.y + d.w) ?? 0;

    let contentWidth  = (maxY - minY) + 2 * margin;
    const contentHeight = (maxX - minX) + 2 * margin;
    const totalHeight   = contentHeight + (includeLegend ? legendHeight : 0) + 40;

    // Ensure legend fits horizontally
    if (includeLegend) {
      const legendMinWidth = margin + 40 + 800 + 40 + 600 + 320 + 320 + margin;
      contentWidth = Math.max(contentWidth, legendMinWidth);
    }

    // Start SVG
    let svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${contentWidth}" height="${totalHeight}" viewBox="0 0 ${contentWidth} ${totalHeight}">`;
    svgString += `<rect width="100%" height="100%" fill="${background}"/>`;

    const offsetX = margin - minY;
    const offsetY = margin - minX;
    svgString += `<g transform="translate(${offsetX}, ${offsetY})">`;

    // Simple inline CSS
    svgString += `<style><![CDATA[
      .node rect { stroke: #222; stroke-width: 1; rx: 6; ry: 6; }
      .node.ghost rect { stroke: #888; stroke-dasharray: 4 3; }
    ]]></style>`;

    // Links
    for (const link of placedLinks) {
      const sx = link.sx, sy = link.sy, tx = link.tx, ty = link.ty;
      let pathD;
      if (sy === ty) pathD = `M${sx},${sy} L${tx},${ty}`;
      else {
        const dx = tx - sx;
        const c1x = sx + dx * 0.45, c1y = sy;
        const c2x = sx + dx * 0.55, c2y = ty;
        pathD = `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
      }
      const strokeDasharray = link.ghost ? '5,4' : 'none';
      svgString += `<path d="${pathD}" stroke="#000" stroke-width="${S.LINK_PX}" fill="none" stroke-dasharray="${strokeDasharray}"/>`;
    }

    function parts(hnode) {
      if (hnode.data.position < 0 || hnode.data.is_root) {
        const raw = hnode.data.cluster_label || hnode.data.prompt || hnode.data.token || '';
        const cleaned = raw.replace(/^\[?\[?(.+?)\]?\]?$/, '$1').replace(/^\[.*?:\s*/, '').trim();
        return { tok: cleaned, metaEmp: '', metaModel: '' };
      }
      const tok = String(hnode.data.token ?? '');
      const metaEmp = (hnode.data.emp_freq_here != null)
        ? `Observed frequency: ${(hnode.data.emp_freq_here * 100).toFixed(1)}% (${hnode.data.emp_count_here}/${hnode.data.emp_parent_total})`
        : '';

      // Match interactive PROB_DISPLAY behavior
      let metaModel = '';
      if (hnode.data.model_prob_here != null) {
        const mean = +hnode.data.model_prob_here;
        const std  = (hnode.data.model_prob_std != null) ? +hnode.data.model_prob_std : null;
        const n    = (hnode.data.model_prob_n != null)   ? +hnode.data.model_prob_n   : null;

        const displayMode = S.PROB_DISPLAY || 'mean_sd';
        if (displayMode === 'mean') {
          metaModel = `Predicted probability: ${(mean * 100).toFixed(1)}%`;
        } else if (displayMode === 'mean_sd' && std != null && (n ?? 0) >= 2) {
          metaModel = `Predicted probability: ${(mean * 100).toFixed(1)}% ± ${(std * 100).toFixed(1)}% (n=${n})`;
        } else if (displayMode === 'range' && std != null && (n ?? 0) >= 2) {
          const lo = Math.max(0, mean - 2 * std);
          const hi = Math.min(1, mean + 2 * std);
          metaModel = `Predicted probability: ~[${(lo * 100).toFixed(1)}%–${(hi * 100).toFixed(1)}%] (n=${n})`;
        } else {
          metaModel = `Predicted probability: ${(mean * 100).toFixed(1)}%`;
        }
      }
      return { tok, metaEmp, metaModel };
    }

    const norm = (v) => {
      if (v == null) return 0;
      const t = (v - S.COLOR_FLOOR) / Math.max(1e-9, (S.COLOR_CAP - S.COLOR_FLOOR));
      return Math.max(0, Math.min(1, t));
    };

    // Nodes
    for (const node of placedNodes) {
      const p = parts(node.hnode);
      const isGhost = !!node.data.isGhost;

      svgString += `<g transform="translate(${node.y}, ${node.x})">`;

      if (node.data.position < 0 || node.data.is_root) {
        const fillColor = '#ffffff';
        svgString += `<rect x="0" y="${-node.h / 2}" width="${node.w}" height="${node.h}" rx="6" ry="6" fill="${fillColor}" stroke="#222" stroke-width="1"/>`;
        const maxW = node.w - S.PAD_X * 2;
        const lines = wrapLines(p.tok, maxW, S.TOKEN_FPX);
        const startY = -node.h / 2 + S.PAD_T + S.TOKEN_FPX * 0.8;
        for (let i = 0; i < lines.length; i++) {
          const y = startY + i * (S.TOKEN_FPX + 4);
          svgString += `<text x="${node.w - S.PAD_X}" y="${y}" text-anchor="end" font-size="${S.TOKEN_FPX}px" font-family="Arial, sans-serif" fill="#000">${escapeXml(lines[i])}</text>`;
        }
      } else {
        let fillColor = d3.interpolateViridis(norm(isGhost ? node.hnode.data.model_prob_here : node.hnode.data.emp_freq_here ?? 0));
        if (isGhost) fillColor = d3.interpolateRgb(fillColor, '#e5e5e5')(0.85);
        const textColor = pickTextColor(fillColor);
        const strokeColor = isGhost ? '#888' : '#222';
        const strokeDasharray = isGhost ? '4,3' : 'none';

        svgString += `<rect x="0" y="${-node.h / 2}" width="${node.w}" height="${node.h}" rx="6" ry="6" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1" stroke-dasharray="${strokeDasharray}"/>`;

        const metaEmp = p.metaEmp;
        const metaModel = p.metaModel;
        const metaCount = (metaEmp ? 1 : 0) + (metaModel ? 1 : 0);
        const metaBlock = metaCount ? (metaCount * S.META_FPX + (metaCount - 1) * 4) : 0;

        const yTok = -(metaBlock ? (metaBlock / 2) : 0);
        let yMeta1 = (S.TOKEN_FPX / 2 + 6) - (metaBlock ? (metaBlock / 2) : 0);
        const lineStep = S.META_FPX + 4;

        svgString += `<text x="${S.PAD_X}" y="${yTok}" text-anchor="start" font-size="${S.TOKEN_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(p.tok)}</text>`;
        if (metaEmp) {
          svgString += `<text x="${S.PAD_X}" y="${metaCount >= 1 ? yMeta1 : yTok}" text-anchor="start" font-size="${S.META_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(metaEmp)}</text>`;
        }
        if (metaModel) {
          svgString += `<text x="${S.PAD_X}" y="${metaCount >= 2 ? (yMeta1 + lineStep) : yMeta1}" text-anchor="start" font-size="${S.META_FPX}px" font-family="Arial, sans-serif" fill="${textColor}">${escapeXml(metaModel)}</text>`;
        }
      }
      svgString += `</g>`;
    }

    svgString += `</g>`; // content group

    if (includeLegend) {
      const legendY = contentHeight + 40;
      const legendX = margin + 40;
      const barWidth = 800, barHeight = 48, numBlocks = 50, blockWidth = barWidth / numBlocks;

      for (let i = 0; i < numBlocks; i++) {
        const t = i / (numBlocks - 1);
        const color = d3.interpolateViridis(t);
        const x = legendX + i * blockWidth;
        svgString += `<rect x="${x}" y="${legendY}" width="${blockWidth}" height="${barHeight}" fill="${color}" stroke="none"/>`;
      }
      svgString += `<rect x="${legendX}" y="${legendY}" width="${barWidth}" height="${barHeight}" fill="none" stroke="#000" stroke-width="2"/>`;

      let currentX = legendX + barWidth + 40;
      svgString += `<text x="${currentX}" y="${legendY + barHeight / 2 + 10}" font-size="28px" font-family="Arial, sans-serif" fill="#000">Probability (0% to 100%)</text>`;
      currentX += 600;
      svgString += `<line x1="${currentX}" y1="${legendY + barHeight / 2}" x2="${currentX + 60}" y2="${legendY + barHeight / 2}" stroke="#000" stroke-width="4"/>`;
      svgString += `<text x="${currentX + 75}" y="${legendY + barHeight / 2 + 10}" font-size="24px" font-family="Arial, sans-serif" fill="#000">Observed path</text>`;
      currentX += 320;
      svgString += `<line x1="${currentX}" y1="${legendY + barHeight / 2}" x2="${currentX + 60}" y2="${legendY + barHeight / 2}" stroke="#000" stroke-width="4" stroke-dasharray="10,8"/>`;
      svgString += `<text x="${currentX + 75}" y="${legendY + barHeight / 2 + 10}" font-size="24px" font-family="Arial, sans-serif" fill="#000">Predicted path</text>`;
    }

    svgString += `</svg>`;

    return { svgString, width: contentWidth, height: totalHeight };
  }

  /* ---------- SVG -> PDF (single page or tiled) ---------- */
  async function renderPDFBlob(options = {}) {
    const {
      includeLegend = true,
      background = '#ffffff',
      margin = 40,
      legendHeight = 80,
      tilePages = 'auto',     // 'auto' → tile when over limit; true → always tile; false → single page (scaled)
      maxPagePt = 14400,      // PDF hard limit (~200 inches at 72 pt/in)
      tileOverlapPt = 4       // small overlap so strokes at edges aren't clipped
    } = options;

    const { svgString, width, height } = buildStandaloneSVG({ includeLegend, background, margin, legendHeight });
    if (!svgString || !width || !height) throw new Error('No content to export');

    const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
    const svg2pdfFn =
      typeof window.svg2pdf === 'function' ? window.svg2pdf
      : typeof window.svg2pdf?.default === 'function' ? window.svg2pdf.default
      : typeof window.svg2pdf?.svg2pdf === 'function' ? window.svg2pdf.svg2pdf
      : undefined;

    if (typeof jsPDFCtor !== 'function' || typeof svg2pdfFn !== 'function') {
      throw new Error('jsPDF and svg2pdf must be loaded before exporting.');
    }

    const PX_TO_PT = 72 / 96;
    const fullPtW = width * PX_TO_PT;
    const fullPtH = height * PX_TO_PT;

    // Parse SVG once
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = svgDoc.documentElement;
    if (!svgEl || svgEl.nodeName !== 'svg') throw new Error('Failed to parse SVG for PDF export.');

    // Decide tiling
    const exceedsLimit = (fullPtW > maxPagePt) || (fullPtH > maxPagePt);
    const doTile = tilePages === true || (tilePages === 'auto' && exceedsLimit);

    if (!doTile) {
      // Single page; scale if needed to stay under PDF size cap
      const maxSide = Math.max(fullPtW, fullPtH);
      const scale = maxSide > maxPagePt ? (maxPagePt / maxSide) : 1;
      const pageW = fullPtW * scale;
      const pageH = fullPtH * scale;

      const doc = new jsPDFCtor({
        orientation: pageW >= pageH ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pageW, pageH],
        compress: true
      });

      svgEl.setAttribute('width',  `${pageW}`);
      svgEl.setAttribute('height', `${pageH}`);
      await svg2pdfFn(svgEl, doc, {
        x: 0, y: 0, width: pageW, height: pageH,
        preserveAspectRatio: 'xMidYMid meet'
      });

      return doc.output('blob');
    }

    // Tiled: keep 1:1 coordinates; draw multiple pages with offsets
    const tileW = Math.min(fullPtW, maxPagePt);
    const tileH = Math.min(fullPtH, maxPagePt);
    const nx = Math.max(1, Math.ceil(fullPtW / (tileW - tileOverlapPt)));
    const ny = Math.max(1, Math.ceil(fullPtH / (tileH - tileOverlapPt)));

    const pageW = tileW;
    const pageH = tileH;
    const orientation = pageW >= pageH ? 'landscape' : 'portrait';

    const doc = new jsPDFCtor({
      orientation,
      unit: 'pt',
      format: [pageW, pageH],
      compress: true
    });

    svgEl.setAttribute('width',  `${fullPtW}`);
    svgEl.setAttribute('height', `${fullPtH}`);

    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (ix !== 0 || iy !== 0) doc.addPage([pageW, pageH], orientation);

        const startX = ix * (tileW - tileOverlapPt);
        const startY = iy * (tileH - tileOverlapPt);

        await svg2pdfFn(svgEl, doc, {
          x: -startX,
          y: -startY,
          width: fullPtW,
          height: fullPtH,
          preserveAspectRatio: 'none' // strict tiling
        });
      }
    }

    return doc.output('blob');
  }

  async function savePDF(options = {}) {
    const { filename = 'token-tree.pdf' } = options;
    const blob = await renderPDFBlob(options);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    savePDF,
    renderPDFBlob,
    buildStandaloneSVG
  };
})();
