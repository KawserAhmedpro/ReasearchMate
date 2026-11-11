/**
 * pdf-export.js - Professional Academic Literature Review PDF Generator (V1.2)
 * Uses layout-aware vector document generation (pdfmake + NotoSans + NotoSansBengali)
 * with crisp high-DPI KaTeX math rendering, IndexedDB image resolution,
 * multi-page repeating-header tables, page numbers, hyperlinks, and full Unicode support.
 *
 * Does NOT screenshot the editor DOM using html2canvas.
 */

(function () {
  'use strict';

  const PRINTABLE_WIDTH_PT = 510;  // A4 595.28pt minus 42pt left & 42pt right margins
  const MAX_IMAGE_HEIGHT_PT = 560; // Guarantees any tall diagram fits comfortably within A4 height

  const SECTIONS = [
    {
      id: 'researchProblem',
      num: '01',
      title: 'Research Problem',
      guiding: 'What problem are the researchers trying to solve?'
    },
    {
      id: 'researchObjective',
      num: '02',
      title: 'Research Objective',
      guiding: 'What is the main objective or goal of this research?'
    },
    {
      id: 'dataset',
      num: '03',
      title: 'Dataset',
      guiding: 'Dataset name, size, source, characteristics, and important data notes.'
    },
    {
      id: 'methodology',
      num: '04',
      title: 'Methodology / Proposed Method',
      guiding: 'Proposed methodology, algorithms or models used, main approach, and implementation details.'
    },
    {
      id: 'evaluationProtocol',
      num: '05',
      title: 'Evaluation Protocol',
      guiding: 'Train/test split, validation strategy, cross-validation, experimental setup, baseline comparison.'
    },
    {
      id: 'evaluationMetrics',
      num: '06',
      title: 'Evaluation Metrics',
      guiding: 'Accuracy, Precision, Recall, F1-score, RMSE, MAE, or other relevant metrics.'
    },
    {
      id: 'keyFindings',
      num: '07',
      title: 'Key Findings',
      guiding: 'Main experimental results, important discoveries, contributions, and observations.'
    },
    {
      id: 'limitations',
      num: '08',
      title: 'Limitations',
      guiding: 'Weaknesses of proposed approach, dataset/experimental limitations, unresolved problems.'
    },
    {
      id: 'futureWork',
      num: '09',
      title: 'Future Work',
      guiding: 'Future research directions suggested by the authors.'
    },
    {
      id: 'criticalAnalysis',
      num: '10',
      title: 'My Critical Analysis & Research Opportunities',
      guiding: 'Personal understanding, learnings, potential improvements, criticisms, research gaps, and ideas.'
    }
  ];

  function sanitizeFilename(title) {
    if (!title) return 'Paper_Analysis';
    const clean = String(title)
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 60);
    return clean || 'Paper_Analysis';
  }

  function formatDate(isoString) {
    if (!isoString) return 'Not available';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return 'Not available';
    }
  }

  /* ========================================================================
     1. Font Setup & Mixed-Script (Latin / Bengali / Mono) Text Splitting
     ======================================================================== */

  function ensurePdfFontsConfigured() {
    if (!window.pdfMake) {
      throw new Error('pdfmake library is not loaded.');
    }
    if (window.ResearchMatePdfVfs) {
      window.pdfMake.vfs = window.ResearchMatePdfVfs;
    }
    window.pdfMake.fonts = {
      NotoSans: {
        normal: 'NotoSans-Regular.ttf',
        bold: 'NotoSans-Bold.ttf',
        italics: 'NotoSans-Italic.ttf',
        bolditalics: 'NotoSans-BoldItalic.ttf'
      },
      NotoSansBengali: {
        normal: 'NotoSansBengali-Regular.ttf',
        bold: 'NotoSansBengali-Bold.ttf',
        italics: 'NotoSansBengali-Regular.ttf',
        bolditalics: 'NotoSansBengali-Bold.ttf'
      },
      NotoSansMono: {
        normal: 'NotoSansMono-Regular.ttf',
        bold: 'NotoSansMono-Regular.ttf',
        italics: 'NotoSansMono-Regular.ttf',
        bolditalics: 'NotoSansMono-Regular.ttf'
      }
    };
  }

  /**
   * Splits mixed Latin / Bengali strings into contiguous OpenType-compatible font runs
   * so English, Bengali conjuncts, numbers, and symbols render accurately in pdfmake.
   */
  function splitMixedScriptRuns(text, baseStyle = {}, defaultFont = 'NotoSans') {
    if (text === null || text === undefined || text === '') {
      return [];
    }
    const str = String(text);
    const bengaliRegex = /([\u0980-\u09FF\u0964\u0965]+(?:[\s\u200C\u200D]+[\u0980-\u09FF\u0964\u0965]+)*)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = bengaliRegex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parts.push(Object.assign({}, baseStyle, { text: str.slice(lastIndex, match.index), font: defaultFont }));
      }
      parts.push(Object.assign({}, baseStyle, { text: match[0], font: 'NotoSansBengali' }));
      lastIndex = bengaliRegex.lastIndex;
    }
    if (lastIndex < str.length) {
      parts.push(Object.assign({}, baseStyle, { text: str.slice(lastIndex), font: defaultFont }));
    }
    return parts.length ? parts : [Object.assign({}, baseStyle, { text: str, font: defaultFont })];
  }

  function makeRichTextNode(text, baseStyle = {}, extraNodeProps = {}, defaultFont = 'NotoSans') {
    const runs = splitMixedScriptRuns(text, baseStyle, defaultFont);
    if (runs.length === 0) return Object.assign({ text: '' }, baseStyle, extraNodeProps);
    return Object.assign({ text: runs }, extraNodeProps);
  }

  /* ========================================================================
     2. KaTeX Equation -> High-DPI PNG Converter (Vector-Crisp Math)
     ======================================================================== */

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }

  let mathStageEl = null;
  function getMathStageElement() {
    if (!mathStageEl || !mathStageEl.isConnected) {
      mathStageEl = document.createElement('div');
      mathStageEl.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(mathStageEl);
    }
    return mathStageEl;
  }

  async function renderLatexToPdfImage(latex, displayMode, cacheMap) {
    const cacheKey = `${displayMode ? 'B' : 'I'}|${latex}`;
    if (cacheMap && cacheMap.has(cacheKey)) {
      return await cacheMap.get(cacheKey);
    }

    const job = (async () => {
      if (typeof window.katex === 'undefined') {
        return null;
      }
      await document.fonts.ready;

      const stage = getMathStageElement();
      stage.innerHTML = '';

      const fontSizePx = displayMode ? 17 : 13;
      const paddingCss = displayMode ? '8px 14px' : '2px 5px';

      const host = document.createElement('div');
      host.style.display = 'inline-block';
      host.style.padding = paddingCss;
      host.style.fontSize = `${fontSizePx}px`;
      host.style.lineHeight = '1.4';
      host.style.color = '#111827';
      host.style.whiteSpace = 'nowrap';
      stage.appendChild(host);

      const mathHtml = window.katex.renderToString(String(latex || ''), {
        displayMode: Boolean(displayMode),
        throwOnError: false,
        output: 'html'
      });
      host.innerHTML = mathHtml;

      await document.fonts.ready;
      const kEl = host.querySelector('.katex-display') || host.querySelector('.katex') || host;
      if (kEl.classList && kEl.classList.contains('katex-display')) {
        kEl.style.margin = '0';
        kEl.style.display = 'inline-block';
      }

      const hostRect = host.getBoundingClientRect();
      const kRect = kEl.getBoundingClientRect();
      const width = Math.max(16, Math.ceil(Math.max(hostRect.width, host.scrollWidth, kRect.width + 28)) + 8);
      const height = Math.max(16, Math.ceil(Math.max(hostRect.height, host.scrollHeight, kRect.height + 16)) + 6);

      const safeCss = (window.ResearchMateKatexCss || '').replace(/\]\]>/g, ']]&gt;');
      const svgXml = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;margin:0;padding:${paddingCss};font-size:${fontSizePx}px;line-height:1.4;color:#111827;display:inline-block;white-space:nowrap;">
      <style>/*<![CDATA[*/${safeCss} .katex-display{margin:0!important;display:inline-block!important;}/*]]>*/</style>
      ${mathHtml}
    </div>
  </foreignObject>
</svg>`;

      const img = new Image();
      const dataUri = 'data:image/svg+xml;base64,' + utf8ToBase64(svgXml);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Equation SVG rasterization failed'));
        img.src = dataUri;
      });

      const scale = 3;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);

      const widthPt = Math.min(PRINTABLE_WIDTH_PT - 20, width * 0.72);
      return {
        dataUrl: canvas.toDataURL('image/png'),
        widthPt: widthPt,
        heightPt: height * (widthPt / width)
      };
    })();

    if (cacheMap) cacheMap.set(cacheKey, job);
    return await job;
  }

  /* ========================================================================
     3. IndexedDB Image Blob Resolution (PNG/JPEG direct, WEBP -> PNG, aspect-safe)
     ======================================================================== */

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image Blob'));
      reader.readAsDataURL(blob);
    });
  }

  async function resolvePdfImageAsset(imageId, cacheMap) {
    if (!imageId) return null;
    if (cacheMap && cacheMap.has(imageId)) {
      return await cacheMap.get(imageId);
    }

    const job = (async () => {
      if (!window.ResearchMateDB || typeof window.ResearchMateDB.getNoteImage !== 'function') {
        return null;
      }
      const record = await window.ResearchMateDB.getNoteImage(imageId);
      if (!record || !record.fileBlob) return null;

      const objUrl = URL.createObjectURL(record.fileBlob);
      try {
        const imgEl = new Image();
        await new Promise((resolve, reject) => {
          imgEl.onload = resolve;
          imgEl.onerror = () => reject(new Error('Failed to decode stored image'));
          imgEl.src = objUrl;
        });

        const naturalW = imgEl.naturalWidth || record.width || 600;
        const naturalH = imgEl.naturalHeight || record.height || 400;
        const mime = (record.fileType || record.fileBlob.type || '').toLowerCase();

        let dataUrl;
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
          dataUrl = await blobToDataUrl(record.fileBlob);
        } else {
          // Convert WEBP or other supported browser formats to lossless PNG for pdfmake
          const canvas = document.createElement('canvas');
          canvas.width = naturalW;
          canvas.height = naturalH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imgEl, 0, 0, naturalW, naturalH);
          dataUrl = canvas.toDataURL('image/png');
        }

        return {
          dataUrl,
          naturalWidth: naturalW,
          naturalHeight: naturalH,
          fileName: record.fileName || imageId
        };
      } finally {
        try { URL.revokeObjectURL(objUrl); } catch (_) {}
      }
    })();

    if (cacheMap) cacheMap.set(imageId, job);
    return await job;
  }

  function computeFittedImageWidth(naturalW, naturalH, widthPct) {
    const pct = Math.max(20, Math.min(100, Number(widthPct) || 75));
    let targetW = (pct / 100) * (PRINTABLE_WIDTH_PT - 16);
    if (naturalW > 0 && naturalH > 0) {
      const scaledH = targetW * (naturalH / naturalW);
      if (scaledH > MAX_IMAGE_HEIGHT_PT) {
        targetW = MAX_IMAGE_HEIGHT_PT * (naturalW / naturalH);
      }
    }
    return Math.max(40, Math.round(targetW));
  }

  /* ========================================================================
     4. Table Cell HTML -> pdfmake Rich Text Spans
     ======================================================================== */

  function tableCellHtmlToPdfSpans(cellHtml, isHeader) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${cellHtml || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const spans = [];

    function walk(node, style) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) {
          const runs = splitMixedScriptRuns(
            node.textContent,
            style,
            style._isCode ? 'NotoSansMono' : 'NotoSans'
          );
          runs.forEach(r => {
            const clean = { ...r };
            delete clean._isCode;
            spans.push(clean);
          });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        spans.push({ text: '\n', ...style });
        return;
      }

      const nextStyle = { ...style };
      if (tag === 'B' || tag === 'STRONG') nextStyle.bold = true;
      if (tag === 'I' || tag === 'EM') nextStyle.italics = true;
      if (tag === 'U') nextStyle.decoration = 'underline';
      if (tag === 'S' || tag === 'STRIKE') nextStyle.decoration = 'lineThrough';
      if (tag === 'CODE') {
        nextStyle._isCode = true;
        nextStyle.fontSize = 8.5;
        nextStyle.background = '#f1f5f9';
      }
      Array.from(node.childNodes).forEach(child => walk(child, nextStyle));
    }

    const base = {
      fontSize: isHeader ? 9.5 : 9,
      bold: isHeader,
      color: isHeader ? '#0f172a' : '#1f2937'
    };
    Array.from(root.childNodes).forEach(child => walk(child, base));
    return spans.length > 0 ? { text: spans } : { text: '' };
  }

  /* ========================================================================
     5. Structured Delta JSON -> Ordered pdfmake Flow Nodes
     ======================================================================== */

  function inlineOpToPdfRuns(op, baseStyle = {}) {
    if (!op || typeof op.insert !== 'string') return [];
    const attrs = op.attributes || {};
    const style = { ...baseStyle };
    if (attrs.bold) style.bold = true;
    if (attrs.italic) style.italics = true;

    const decors = [];
    if (attrs.underline) decors.push('underline');
    if (attrs.strike) decors.push('lineThrough');

    let defaultFont = 'NotoSans';
    if (attrs.code) {
      defaultFont = 'NotoSansMono';
      style.background = '#f1f5f9';
      style.fontSize = (baseStyle.fontSize || 10) - 0.8;
    }

    const extra = {};
    if (attrs.link) {
      const safeHref = /^https?:|^mailto:|^#/i.test(attrs.link) ? attrs.link : null;
      if (safeHref) {
        extra.link = safeHref;
        style.color = '#1e40af';
        if (!decors.includes('underline')) decors.push('underline');
      }
    }
    if (decors.length > 0) {
      style.decoration = decors[0];
    }

    const runs = splitMixedScriptRuns(op.insert, style, defaultFont);
    if (extra.link) {
      runs.forEach(r => { r.link = extra.link; });
    }
    return runs;
  }

  async function convertSectionDeltaToPdfContent(rawSection, caches) {
    const norm = window.ResearchMateDB
      ? window.ResearchMateDB.normalizeSectionContent(rawSection)
      : { format: 'quill-delta-v1', delta: { ops: [] } };
    const ops = norm.delta && Array.isArray(norm.delta.ops) ? norm.delta.ops : [];
    if (ops.length === 0) return [];

    // Parse Delta ops into ordered lines preserving inline equations and block embeds
    const lines = [];
    let currentTokens = [];

    const flushLine = (attrs) => {
      lines.push({ tokens: currentTokens, attrs: attrs || {} });
      currentTokens = [];
    };

    for (const op of ops) {
      if (!op) continue;
      if (op.insert && typeof op.insert === 'object') {
        if (op.insert['research-image']) {
          if (currentTokens.length > 0) flushLine({});
          lines.push({ blockEmbed: 'research-image', value: op.insert['research-image'] });
        } else if (op.insert['research-table']) {
          if (currentTokens.length > 0) flushLine({});
          lines.push({ blockEmbed: 'research-table', value: op.insert['research-table'] });
        } else if (op.insert['hr']) {
          if (currentTokens.length > 0) flushLine({});
          lines.push({ blockEmbed: 'hr' });
        } else if (op.insert['math-equation']) {
          const m = op.insert['math-equation'];
          if (m && m.displayMode) {
            if (currentTokens.length > 0) flushLine({});
            lines.push({ blockEmbed: 'math-block', value: m });
          } else {
            currentTokens.push({ inlineMath: m });
          }
        }
        continue;
      }

      if (typeof op.insert === 'string') {
        const text = op.insert;
        let start = 0;
        let nlIdx;
        while ((nlIdx = text.indexOf('\n', start)) !== -1) {
          const seg = text.slice(start, nlIdx);
          if (seg.length > 0) {
            currentTokens.push({ textOp: { insert: seg, attributes: op.attributes } });
          }
          flushLine(op.attributes || {});
          start = nlIdx + 1;
        }
        if (start < text.length) {
          currentTokens.push({ textOp: { insert: text.slice(start), attributes: op.attributes } });
        }
      }
    }
    if (currentTokens.length > 0) flushLine({});

    // Helper: Emit tokens (potentially containing inline math images) cleanly without broken raw LaTeX
    const buildParagraphNodes = async (tokens, baseStyle, margin) => {
      const hasInlineMath = tokens.some(t => t.inlineMath);
      if (!hasInlineMath) {
        const runs = [];
        tokens.forEach(t => {
          if (t.textOp) runs.push(...inlineOpToPdfRuns(t.textOp, baseStyle));
        });
        if (runs.length === 0) return [];
        return [{ text: runs, margin }];
      }

      const nodes = [];
      let textBuf = [];
      const flushTextBuf = () => {
        if (textBuf.length > 0) {
          nodes.push({ text: textBuf, margin: [margin[0], 2, margin[2], 2] });
          textBuf = [];
        }
      };

      for (const tok of tokens) {
        if (tok.textOp) {
          textBuf.push(...inlineOpToPdfRuns(tok.textOp, baseStyle));
        } else if (tok.inlineMath) {
          flushTextBuf();
          const eqImg = await renderLatexToPdfImage(tok.inlineMath.latex || '', false, caches.mathCache);
          if (eqImg && eqImg.dataUrl) {
            nodes.push({
              image: eqImg.dataUrl,
              width: eqImg.widthPt,
              margin: [margin[0] + 10, 3, margin[2], 4]
            });
          } else {
            nodes.push(makeRichTextNode(tok.inlineMath.latex || '', { italics: true, ...baseStyle }, { margin: [margin[0] + 8, 2, margin[2], 2] }));
          }
        }
      }
      flushTextBuf();
      return nodes;
    };

    // Walk lines in strict sequential order to emit pdfmake blocks
    const contentNodes = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.blockEmbed === 'hr') {
        contentNodes.push({
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: PRINTABLE_WIDTH_PT, y2: 0, lineWidth: 0.8, lineColor: '#cbd5e1' }],
          margin: [0, 8, 0, 8]
        });
        i++;
        continue;
      }

      if (line.blockEmbed === 'math-block') {
        const eqImg = await renderLatexToPdfImage(line.value?.latex || '', true, caches.mathCache);
        if (eqImg && eqImg.dataUrl) {
          contentNodes.push({
            image: eqImg.dataUrl,
            width: eqImg.widthPt,
            alignment: 'center',
            margin: [0, 6, 0, 8]
          });
        }
        i++;
        continue;
      }

      if (line.blockEmbed === 'research-image') {
        const val = line.value || {};
        const asset = await resolvePdfImageAsset(val.imageId, caches.imageCache);
        const align = val.align === 'left' || val.align === 'right' ? val.align : 'center';

        const stackItems = [];
        if (asset && asset.dataUrl) {
          const fittedWidth = computeFittedImageWidth(asset.naturalWidth, asset.naturalHeight, val.widthPct);
          stackItems.push({
            image: asset.dataUrl,
            width: fittedWidth,
            alignment: align
          });
        } else {
          stackItems.push({
            text: splitMixedScriptRuns(`[Image unavailable locally: ${val.fileName || val.imageId || 'figure'}]`, { italics: true, fontSize: 9, color: '#6b7280' }),
            alignment: align
          });
        }

        const captionText = [
          val.caption ? String(val.caption) : '',
          val.source ? `Source: ${val.source}` : ''
        ].filter(Boolean).join(' — ');

        if (captionText) {
          stackItems.push({
            text: splitMixedScriptRuns(captionText, { fontSize: 8.5, italics: true, color: '#475569' }),
            alignment: align,
            margin: [0, 4, 0, 0]
          });
        }

        contentNodes.push({
          stack: stackItems,
          unbreakable: true,
          margin: [0, 6, 0, 10]
        });
        i++;
        continue;
      }

      if (line.blockEmbed === 'research-table') {
        const tbl = line.value || {};
        const rows = Array.isArray(tbl.rows) ? tbl.rows : [];
        if (rows.length > 0) {
          const colCount = Math.max(1, ...rows.map(r => (Array.isArray(r) ? r.length : 1)));
          const body = rows.map((row, rIdx) => {
            const isHead = Boolean(tbl.hasHeader) && rIdx === 0;
            const cells = [];
            for (let c = 0; c < colCount; c++) {
              const cellHtml = Array.isArray(row) && row[c] !== undefined ? row[c] : '';
              const cellObj = tableCellHtmlToPdfSpans(cellHtml, isHead);
              if (isHead) {
                cellObj.fillColor = '#f1f5f9';
              }
              cells.push(cellObj);
            }
            return cells;
          });

          contentNodes.push({
            table: {
              headerRows: tbl.hasHeader ? 1 : 0,
              keepWithHeaderRows: tbl.hasHeader && body.length > 1 ? 1 : 0,
              dontBreakRows: true,
              widths: Array(colCount).fill('*'),
              body: body
            },
            layout: {
              hLineWidth: (idx, node) => (idx === 0 || idx === node.table.body.length ? 0.8 : 0.5),
              vLineWidth: () => 0.5,
              hLineColor: (idx) => (idx === 1 && tbl.hasHeader ? '#94a3b8' : '#cbd5e1'),
              vLineColor: () => '#cbd5e1',
              paddingLeft: () => 6,
              paddingRight: () => 6,
              paddingTop: () => 5,
              paddingBottom: () => 5
            },
            margin: [0, 6, 0, 10]
          });
        }
        i++;
        continue;
      }

      const attrs = line.attrs || {};
      if (attrs.list === 'bullet' || attrs.list === 'ordered') {
        const listType = attrs.list;
        const items = [];
        while (i < lines.length && !lines[i].blockEmbed && lines[i].attrs && lines[i].attrs.list === listType) {
          const itemRuns = [];
          const hasMath = lines[i].tokens.some(t => t.inlineMath);
          if (hasMath) {
            const built = await buildParagraphNodes(lines[i].tokens, { fontSize: 10, color: '#1f2937' }, [0, 0, 0, 2]);
            if (built.length === 1) items.push(built[0]);
            else if (built.length > 1) items.push({ stack: built });
          } else {
            lines[i].tokens.forEach(t => {
              if (t.textOp) itemRuns.push(...inlineOpToPdfRuns(t.textOp, { fontSize: 10, color: '#1f2937' }));
            });
            if (itemRuns.length > 0) items.push({ text: itemRuns });
            else items.push({ text: '' });
          }
          i++;
        }
        if (items.length > 0) {
          contentNodes.push(
            listType === 'ordered'
              ? { ol: items, margin: [6, 3, 0, 6] }
              : { ul: items, margin: [6, 3, 0, 6] }
          );
        }
        continue;
      }

      if (attrs['code-block']) {
        const codeLines = [];
        while (i < lines.length && !lines[i].blockEmbed && lines[i].attrs && lines[i].attrs['code-block']) {
          const lineStr = lines[i].tokens.map(t => (t.textOp ? t.textOp.insert : '')).join('');
          codeLines.push(lineStr);
          i++;
        }
        contentNodes.push({
          table: {
            widths: ['*'],
            body: [[
              {
                text: splitMixedScriptRuns(codeLines.join('\n'), { fontSize: 8.8, color: '#1e293b', preserveLeadingSpaces: true }, 'NotoSansMono'),
                fillColor: '#f8fafc'
              }
            ]]
          },
          layout: {
            hLineWidth: () => 0.6,
            vLineWidth: (idx) => (idx === 0 ? 2.5 : 0.6),
            hLineColor: () => '#e2e8f0',
            vLineColor: (idx) => (idx === 0 ? '#64748b' : '#e2e8f0'),
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 6,
            paddingBottom: () => 6
          },
          margin: [0, 4, 0, 8]
        });
        continue;
      }

      if (attrs.header && [1, 2, 3].includes(Number(attrs.header))) {
        const lvl = Number(attrs.header);
        const fontSize = lvl === 1 ? 13.5 : lvl === 2 ? 12 : 11;
        const pNodes = await buildParagraphNodes(
          line.tokens,
          { fontSize, bold: true, color: '#0f172a' },
          [0, 6, 0, 3]
        );
        contentNodes.push(...pNodes);
        i++;
        continue;
      }

      if (attrs.blockquote) {
        const quoteParagraphs = await buildParagraphNodes(
          line.tokens,
          { fontSize: 9.8, italics: true, color: '#475569' },
          [0, 0, 0, 0]
        );
        if (quoteParagraphs.length > 0) {
          contentNodes.push({
            table: {
              widths: ['*'],
              body: [[{ stack: quoteParagraphs }]]
            },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: (idx) => (idx === 0 ? 2.5 : 0),
              vLineColor: () => '#1e40af',
              paddingLeft: () => 10,
              paddingRight: () => 4,
              paddingTop: () => 2,
              paddingBottom: () => 2
            },
            margin: [4, 4, 0, 6]
          });
        }
        i++;
        continue;
      }

      // Normal paragraph
      const pNodes = await buildParagraphNodes(
        line.tokens,
        { fontSize: 10, color: '#1f2937', lineHeight: 1.38 },
        [0, 0, 0, 5]
      );
      contentNodes.push(...pNodes);
      i++;
    }

    return contentNodes;
  }

  /* ========================================================================
     6. Full Document Builder & Public Export Entrypoint
     ======================================================================== */

  async function buildPdfDocumentDefinition(paper, rawNotes) {
    ensurePdfFontsConfigured();

    const notes = window.ResearchMateDB
      ? window.ResearchMateDB.normalizeNoteRecord(rawNotes || {})
      : (rawNotes || {});
    const caches = {
      mathCache: new Map(),
      imageCache: new Map()
    };

    const metaStack = [
      {
        columns: [
          {
            text: 'RESEARCHMATE — LITERATURE REVIEW NOTES',
            font: 'NotoSans',
            fontSize: 8.5,
            bold: true,
            color: '#1e40af',
            characterSpacing: 0.6
          },
          {
            text: `Exported: ${formatDate(new Date().toISOString())}`,
            font: 'NotoSans',
            fontSize: 8.5,
            color: '#64748b',
            alignment: 'right'
          }
        ],
        margin: [0, 0, 0, 6]
      },
      {
        text: splitMixedScriptRuns(paper.title || 'Untitled Research Paper', {
          fontSize: 16,
          bold: true,
          color: '#0f172a',
          lineHeight: 1.25
        }),
        margin: [0, 0, 0, 8]
      }
    ];

    const metaTableBody = [
      [
        { text: 'Authors', bold: true, fontSize: 9, color: '#475569' },
        { text: splitMixedScriptRuns(paper.authors || 'Not specified', { fontSize: 9.5, color: '#0f172a' }) }
      ],
      [
        { text: 'Publication Year', bold: true, fontSize: 9, color: '#475569' },
        { text: String(paper.year || 'Not specified'), fontSize: 9.5, color: '#0f172a' }
      ],
      [
        { text: 'Notes Last Updated', bold: true, fontSize: 9, color: '#475569' },
        { text: formatDate(notes.updatedAt || paper.createdAt), fontSize: 9.5, color: '#0f172a' }
      ]
    ];

    if (paper.doiUrl) {
      const safeDoi = /^https?:|^mailto:/i.test(paper.doiUrl) ? paper.doiUrl : null;
      metaTableBody.push([
        { text: 'DOI / Link', bold: true, fontSize: 9, color: '#475569' },
        safeDoi
          ? { text: paper.doiUrl, link: safeDoi, fontSize: 9, color: '#1e40af', decoration: 'underline' }
          : { text: splitMixedScriptRuns(paper.doiUrl, { fontSize: 9, color: '#0f172a' }) }
      ]);
    }

    metaStack.push({
      table: {
        widths: [105, '*'],
        body: metaTableBody
      },
      layout: {
        hLineWidth: () => 0.4,
        vLineWidth: () => 0,
        hLineColor: () => '#e2e8f0',
        fillColor: () => '#f8fafc',
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 4,
        paddingBottom: () => 4
      },
      margin: [0, 0, 0, 14]
    });

    const content = [...metaStack];

    // Walk all 10 immutable sections sequentially in exact order
    for (const sec of SECTIONS) {
      const hasNotes = window.ResearchMateDB
        ? window.ResearchMateDB.isSectionNonEmpty(notes[sec.id])
        : Boolean(notes[sec.id]);

      const sectionHeader = {
        stack: [
          {
            columns: [
              {
                width: 'auto',
                text: `${sec.num}`,
                font: 'NotoSans',
                fontSize: 9.5,
                bold: true,
                color: '#1e40af',
                margin: [0, 2, 6, 0]
              },
              {
                width: '*',
                text: `${sec.title}`,
                font: 'NotoSans',
                fontSize: 12,
                bold: true,
                color: '#0f172a'
              }
            ]
          },
          {
            text: sec.guiding,
            font: 'NotoSans',
            fontSize: 8.2,
            italics: true,
            color: '#64748b',
            margin: [22, 1, 0, 4]
          },
          {
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: PRINTABLE_WIDTH_PT, y2: 0, lineWidth: 0.9, lineColor: '#cbd5e1' }]
          }
        ],
        unbreakable: true,
        margin: [0, 8, 0, 6]
      };

      content.push(sectionHeader);

      if (hasNotes) {
        const secNodes = await convertSectionDeltaToPdfContent(notes[sec.id], caches);
        if (secNodes.length > 0) {
          content.push(...secNodes);
        } else {
          content.push({
            text: 'No notes recorded for this section.',
            fontSize: 9.5,
            italics: true,
            color: '#94a3b8',
            margin: [0, 2, 0, 8]
          });
        }
      } else {
        content.push({
          text: 'No notes recorded for this section.',
          fontSize: 9.5,
          italics: true,
          color: '#94a3b8',
          margin: [0, 2, 0, 8]
        });
      }
    }

    const headerTitlePreview = String(paper.title || 'Literature Review').slice(0, 70) +
      ((paper.title || '').length > 70 ? '...' : '');

    return {
      pageSize: 'A4',
      pageMargins: [42, 52, 42, 50],
      defaultStyle: {
        font: 'NotoSans',
        fontSize: 10,
        color: '#1f2937',
        lineHeight: 1.35
      },
      header: (currentPage) => {
        if (currentPage === 1) return null;
        return {
          columns: [
            {
              text: splitMixedScriptRuns(headerTitlePreview, { fontSize: 8, color: '#64748b', italics: true }),
              margin: [42, 20, 10, 0]
            },
            {
              text: 'ResearchMate Notes',
              fontSize: 8,
              color: '#94a3b8',
              alignment: 'right',
              margin: [0, 20, 42, 0]
            }
          ]
        };
      },
      footer: (currentPage, pageCount) => ({
        columns: [
          {
            text: 'ResearchMate • Personal Literature Review Notebook',
            fontSize: 8,
            color: '#94a3b8',
            margin: [42, 16, 0, 0]
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            fontSize: 8,
            bold: true,
            color: '#64748b',
            alignment: 'right',
            margin: [0, 16, 42, 0]
          }
        ]
      }),
      content: content
    };
  }

  /**
   * Generates and exports an A4 academic PDF of the paper's latest saved rich notes.
   * Ensures any pending image uploads are finalized before reading IndexedDB assets.
   *
   * @param {Object} paper Paper metadata object
   * @param {Object} notes 10-section rich notes object
   * @param {Object} [options={}] { download: boolean (default true) }
   * @returns {Promise<{ filename: string, blob: Blob }>}
   */
  async function exportPaperNotesAsPDF(paper, notes, options = {}) {
    if (!paper) {
      throw new Error('Cannot export PDF: Paper metadata is missing.');
    }

    if (window.RichEditorManager && typeof window.RichEditorManager.waitForPendingUploads === 'function') {
      await window.RichEditorManager.waitForPendingUploads();
    }

    const filename = `${sanitizeFilename(paper.title)}_Review_Notes.pdf`;
    const docDefinition = await buildPdfDocumentDefinition(paper, notes);
    const pdfDocGenerator = window.pdfMake.createPdf(docDefinition);

    const blob = await new Promise((resolve, reject) => {
      try {
        pdfDocGenerator.getBlob((b) => resolve(b));
      } catch (err) {
        reject(err);
      }
    });

    if (options.download !== false) {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
      }, 60000);
    }

    return { filename, blob };
  }

  // Expose PDFExporter module
  window.PDFExporter = {
    exportPaperNotesAsPDF,
    buildPdfDocumentDefinition,
    SECTIONS,
    sanitizeFilename
  };
})();
