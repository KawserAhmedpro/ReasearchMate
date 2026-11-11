/**
 * rich-editor.js - Unified Rich Content Notes Editor for ResearchMate V1.2
 * Built on Quill 2.0 + KaTeX + IndexedDB Blob Image Referencing.
 *
 * One unified ordered editor per section supporting:
 * - Rich text formatting (P, H1-H3, B, I, U, S, lists, blockquote, hr, links, code-block, undo/redo)
 * - Images (PNG, JPG, WEBP): upload, drag & drop, paste, resize, align, caption/source, replace, delete
 *   -> Binary Blobs saved in IndexedDB 'images' store; only lightweight imageId references in Delta JSON.
 * - Tables: customizable rows/cols, add/remove rows & cols, header toggle, cell inline formatting.
 * - Math Equations: inline & display LaTeX rendered live via KaTeX, preserving raw LaTeX source for editing.
 */

(function () {
  'use strict';

  const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
  const ACCEPTED_IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
  const MAX_RECOMMENDED_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB safety cap per image

  // Registry mapping imageId -> active Blob ObjectURL for clean UI reuse & full cleanup
  const blobUrlCache = new Map();
  // Pending async image DB writes so save / PDF export always wait for blobs before persisting references
  const pendingImagePromises = new Set();
  // Registry mapping sectionId -> editor controller { sectionId, paperId, quill, wrapperEl, onChange, getPaperId }
  const editorsBySection = new Map();

  let blotsRegistered = false;
  let activeModalContext = null; // For Insert/Edit Table, Math, and Image Caption modals

  /* ========================================================================
     1. Blob URL Lifecycle & Async Upload Tracking
     ======================================================================== */

  async function resolveImageObjectUrl(imageId) {
    if (!imageId) return null;
    if (blobUrlCache.has(imageId)) {
      return blobUrlCache.get(imageId);
    }
    if (!window.ResearchMateDB || typeof window.ResearchMateDB.getNoteImage !== 'function') {
      return null;
    }
    const record = await window.ResearchMateDB.getNoteImage(imageId);
    if (!record || !record.fileBlob) {
      return null;
    }
    const url = URL.createObjectURL(record.fileBlob);
    blobUrlCache.set(imageId, url);
    return url;
  }

  function revokeAllBlobUrls() {
    blobUrlCache.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    });
    blobUrlCache.clear();
  }

  function trackPendingUpload(promise) {
    pendingImagePromises.add(promise);
    const cleanup = () => pendingImagePromises.delete(promise);
    promise.then(cleanup, cleanup);
    return promise;
  }

  function getPendingUploadCount() {
    return pendingImagePromises.size;
  }

  async function waitForPendingUploads() {
    while (pendingImagePromises.size > 0) {
      await Promise.allSettled(Array.from(pendingImagePromises));
    }
  }

  /* ========================================================================
     2. Image Reading, Validation & Storage
     ======================================================================== */

  function isValidImageFile(file) {
    if (!file) return false;
    const mimeOk = file.type && ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase());
    const extOk = file.name && ACCEPTED_IMAGE_EXT_RE.test(file.name);
    return Boolean(mimeOk || extOk);
  }

  function inferImageMimeType(file) {
    if (file.type && ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      return file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type.toLowerCase();
    }
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.webp')) return 'image/webp';
    return 'image/png';
  }

  function measureImageDimensions(blob) {
    return new Promise((resolve) => {
      const tempUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth || null, height: img.naturalHeight || null };
        URL.revokeObjectURL(tempUrl);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        resolve({ width: null, height: null });
      };
      img.src = tempUrl;
    });
  }

  async function storeImageFileInDB(paperId, sectionId, file) {
    if (!isValidImageFile(file)) {
      throw new Error('Unsupported image format. Please use PNG, JPG/JPEG, or WEBP images.');
    }
    if (file.size === 0) {
      throw new Error('The selected image file appears to be empty.');
    }
    if (file.size > MAX_RECOMMENDED_IMAGE_BYTES) {
      throw new Error('Image exceeds the 20 MB limit per embedded image.');
    }

    const mime = inferImageMimeType(file);
    const normalizedBlob = file.type === mime ? file : new Blob([file], { type: mime });
    const dims = await measureImageDimensions(normalizedBlob);
    if (!dims.width || !dims.height) {
      throw new Error('Could not decode image file. Please select a valid PNG, JPG, or WEBP image.');
    }

    const saved = await window.ResearchMateDB.saveNoteImage(paperId, sectionId, normalizedBlob, {
      fileName: file.name || `figure_${Date.now()}${mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png'}`,
      fileType: mime,
      width: dims.width,
      height: dims.height
    });

    // Pre-cache ObjectURL immediately so blot rendering is instant
    const objectUrl = URL.createObjectURL(saved.fileBlob);
    blobUrlCache.set(saved.id, objectUrl);

    return saved;
  }

  /* ========================================================================
     3. Safe Inline HTML Sanitizer (for Table Cells)
     ======================================================================== */

  function sanitizeInlineCellHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'BR', 'SPAN']);

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeHtml(node.textContent);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') return '<br>';
      if (tag === 'DIV' || tag === 'P') {
        const inner = Array.from(node.childNodes).map(cleanNode).join('');
        return inner ? (inner + '<br>') : '';
      }
      const childrenHtml = Array.from(node.childNodes).map(cleanNode).join('');
      if (allowedTags.has(tag)) {
        const normTag = tag.toLowerCase();
        return `<${normTag}>${childrenHtml}</${normTag}>`;
      }
      return childrenHtml;
    }

    let cleaned = Array.from(root.childNodes).map(cleanNode).join('');
    // Trim trailing synthetic <br> added by contenteditable blocks
    cleaned = cleaned.replace(/(<br>)+$/gi, '');
    return cleaned;
  }

  function stripTagsToText(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html.replace(/<br\s*\/?>/gi, ' ');
    return (tmp.textContent || tmp.innerText || '').trim();
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ========================================================================
     4. Custom Quill 2.0 Parchment Blots
     ======================================================================== */

  function registerCustomBlots() {
    if (blotsRegistered || typeof window.Quill !== 'function') return;
    const Quill = window.Quill;
    const BlockEmbed = Quill.import('blots/block/embed');
    const Embed = Quill.import('blots/embed');

    // --- Blot A: Horizontal Divider (<hr>) ---
    class DividerBlot extends BlockEmbed {
      static create() {
        const node = super.create();
        node.setAttribute('contenteditable', 'false');
        return node;
      }
      static value() {
        return true;
      }
    }
    DividerBlot.blotName = 'hr';
    DividerBlot.tagName = 'HR';
    DividerBlot.className = 'rm-editor-hr';

    // --- Blot B: Math Equation (Inline & Display Block via KaTeX) ---
    class MathEquationBlot extends Embed {
      static create(value) {
        const node = super.create();
        const data = normalizeMathValue(value);
        node.setAttribute('contenteditable', 'false');
        node.setAttribute('data-math-json', JSON.stringify(data));
        if (data.displayMode) {
          node.classList.add('rm-math-block');
        } else {
          node.classList.add('rm-math-inline');
        }
        node.title = `Equation: ${data.latex} (Click to edit)`;

        renderMathIntoNode(node, data);
        return node;
      }

      static value(node) {
        try {
          return normalizeMathValue(JSON.parse(node.getAttribute('data-math-json') || '{}'));
        } catch {
          return { latex: '', displayMode: false };
        }
      }
    }
    MathEquationBlot.blotName = 'math-equation';
    MathEquationBlot.tagName = 'SPAN';
    MathEquationBlot.className = 'rm-math-embed';

    // --- Blot C: Research Image / Diagram Figure (IndexedDB Blob reference only) ---
    class ResearchImageBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        const data = normalizeImageValue(value);
        node.setAttribute('contenteditable', 'false');
        node.setAttribute('data-image-id', data.imageId);
        node.setAttribute('data-image-json', JSON.stringify(data));
        node.className = `rm-figure align-${data.align}`;

        buildImageFigureDom(node, data);
        return node;
      }

      static value(node) {
        try {
          return normalizeImageValue(JSON.parse(node.getAttribute('data-image-json') || '{}'));
        } catch {
          return normalizeImageValue({});
        }
      }
    }
    ResearchImageBlot.blotName = 'research-image';
    ResearchImageBlot.tagName = 'FIGURE';
    ResearchImageBlot.className = 'rm-figure';

    // --- Blot D: Editable Research Comparison Table ---
    class ResearchTableBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        const data = normalizeTableValue(value);
        node.setAttribute('contenteditable', 'false');
        node.setAttribute('data-table-json', JSON.stringify(data));
        node.className = 'rm-table-block';

        buildTableDom(node, data);
        return node;
      }

      static value(node) {
        try {
          return normalizeTableValue(JSON.parse(node.getAttribute('data-table-json') || '{}'));
        } catch {
          return normalizeTableValue({});
        }
      }
    }
    ResearchTableBlot.blotName = 'research-table';
    ResearchTableBlot.tagName = 'DIV';
    ResearchTableBlot.className = 'rm-table-block';

    Quill.register(DividerBlot, true);
    Quill.register(MathEquationBlot, true);
    Quill.register(ResearchImageBlot, true);
    Quill.register(ResearchTableBlot, true);
    blotsRegistered = true;
  }

  function normalizeMathValue(val) {
    if (typeof val === 'string') {
      return { latex: val, displayMode: false };
    }
    const obj = val && typeof val === 'object' ? val : {};
    return {
      latex: String(obj.latex || '').trim() || 'x',
      displayMode: Boolean(obj.displayMode)
    };
  }

  function normalizeImageValue(val) {
    const obj = val && typeof val === 'object' ? val : {};
    const align = obj.align === 'left' || obj.align === 'right' ? obj.align : 'center';
    let widthPct = typeof obj.widthPct === 'number' ? obj.widthPct : 75;
    widthPct = Math.max(20, Math.min(100, Math.round(widthPct)));
    return {
      imageId: String(obj.imageId || ''),
      widthPct: widthPct,
      align: align,
      caption: String(obj.caption || ''),
      source: String(obj.source || ''),
      fileName: String(obj.fileName || '')
    };
  }

  function normalizeTableValue(val) {
    const obj = val && typeof val === 'object' ? val : {};
    const hasHeader = obj.hasHeader !== undefined ? Boolean(obj.hasHeader) : true;
    let rows = Array.isArray(obj.rows) && obj.rows.length > 0
      ? obj.rows.map(r => (Array.isArray(r) ? r.map(c => sanitizeInlineCellHtml(String(c || ''))) : ['']))
      : [['Column 1', 'Column 2'], ['Cell 1', 'Cell 2']];

    const maxCols = Math.max(1, ...rows.map(r => r.length));
    rows = rows.map(r => {
      const padded = r.slice(0, maxCols);
      while (padded.length < maxCols) padded.push('');
      return padded;
    });
    return { hasHeader, rows };
  }

  function renderMathIntoNode(node, data) {
    node.innerHTML = '';
    const renderWrap = document.createElement('span');
    renderWrap.className = 'rm-math-rendered';
    if (typeof window.katex !== 'undefined') {
      try {
        window.katex.render(data.latex, renderWrap, {
          displayMode: Boolean(data.displayMode),
          throwOnError: false
        });
      } catch {
        renderWrap.textContent = data.latex;
      }
    } else {
      renderWrap.textContent = data.displayMode ? `$$${data.latex}$$` : `$${data.latex}$`;
    }
    node.appendChild(renderWrap);

    if (data.displayMode) {
      const editHint = document.createElement('span');
      editHint.className = 'rm-math-edit-badge';
      editHint.textContent = 'Edit Math';
      node.appendChild(editHint);
    }
  }

  /* ========================================================================
     5. Image Figure Interactive Controls inside Editor
     ======================================================================== */

  function findSectionContextForElement(el) {
    const secCard = el.closest('.note-section-card');
    if (!secCard) return null;
    const secId = secCard.getAttribute('data-section-id') || (secCard.id || '').replace(/^section-/, '');
    return editorsBySection.get(secId) || null;
  }

  function replaceEmbedInQuill(el, blotName, newValue) {
    const ctx = findSectionContextForElement(el);
    if (!ctx || !ctx.quill || typeof window.Quill !== 'function') return;
    const blot = window.Quill.find(el, true);
    if (!blot) return;
    const index = ctx.quill.getIndex(blot);
    ctx.quill.deleteText(index, 1, 'user');
    ctx.quill.insertEmbed(index, blotName, newValue, 'user');
    ctx.quill.setSelection(index + 1, 0, 'silent');
  }

  function deleteEmbedInQuill(el) {
    const ctx = findSectionContextForElement(el);
    if (!ctx || !ctx.quill || typeof window.Quill !== 'function') return;
    const blot = window.Quill.find(el, true);
    if (!blot) return;
    const index = ctx.quill.getIndex(blot);
    ctx.quill.deleteText(index, 1, 'user');
    ctx.quill.setSelection(index, 0, 'silent');
  }

  function buildImageFigureDom(figureEl, data) {
    figureEl.innerHTML = '';

    // Toolbar overlay
    const toolbar = document.createElement('div');
    toolbar.className = 'rm-figure-toolbar';
    toolbar.setAttribute('contenteditable', 'false');

    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'rm-fig-btn-group';
    [
      { label: 'S', pct: 35, title: 'Small (35%)' },
      { label: 'M', pct: 60, title: 'Medium (60%)' },
      { label: 'L', pct: 80, title: 'Large (80%)' },
      { label: 'Full', pct: 100, title: 'Full width (100%)' }
    ].forEach(preset => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rm-fig-btn' + (data.widthPct === preset.pct ? ' active' : '');
      btn.textContent = preset.label;
      btn.title = preset.title;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        replaceEmbedInQuill(figureEl, 'research-image', { ...data, widthPct: preset.pct });
      });
      sizeGroup.appendChild(btn);
    });

    const alignGroup = document.createElement('div');
    alignGroup.className = 'rm-fig-btn-group';
    [
      { key: 'left', label: 'Left' },
      { key: 'center', label: 'Center' },
      { key: 'right', label: 'Right' }
    ].forEach(al => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rm-fig-btn' + (data.align === al.key ? ' active' : '');
      btn.textContent = al.label;
      btn.title = `Align ${al.label}`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        replaceEmbedInQuill(figureEl, 'research-image', { ...data, align: al.key });
      });
      alignGroup.appendChild(btn);
    });

    const actionGroup = document.createElement('div');
    actionGroup.className = 'rm-fig-btn-group';

    const captionBtn = document.createElement('button');
    captionBtn.type = 'button';
    captionBtn.className = 'rm-fig-btn';
    captionBtn.textContent = 'Caption / Source';
    captionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openImageMetaModal(figureEl, data);
    });

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'rm-fig-btn';
    replaceBtn.textContent = 'Replace';
    replaceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerReplaceImage(figureEl, data);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'rm-fig-btn rm-fig-btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteEmbedInQuill(figureEl);
    });

    actionGroup.append(captionBtn, replaceBtn, delBtn);
    toolbar.append(sizeGroup, alignGroup, actionGroup);
    figureEl.appendChild(toolbar);

    // Media stage
    const stage = document.createElement('div');
    stage.className = 'rm-figure-stage';
    stage.style.width = `${data.widthPct}%`;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'rm-figure-img-wrap';
    imgWrap.innerHTML = '<div class="rm-figure-loading">Loading image...</div>';
    stage.appendChild(imgWrap);

    // Drag resize handle on bottom-right corner preserving aspect ratio
    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'rm-figure-resize-handle';
    resizeHandle.title = 'Drag horizontally to resize (aspect ratio preserved)';
    resizeHandle.addEventListener('mousedown', (startEvt) => {
      startEvt.preventDefault();
      startEvt.stopPropagation();
      const parentWidth = figureEl.clientWidth || 640;
      const startX = startEvt.clientX;
      const startWidthPx = stage.getBoundingClientRect().width;
      let latestPct = data.widthPct;

      const onMove = (moveEvt) => {
        const dx = moveEvt.clientX - startX;
        const nextPx = Math.max(parentWidth * 0.2, Math.min(parentWidth, startWidthPx + dx));
        latestPct = Math.max(20, Math.min(100, Math.round((nextPx / parentWidth) * 100)));
        stage.style.width = `${latestPct}%`;
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (latestPct !== data.widthPct) {
          replaceEmbedInQuill(figureEl, 'research-image', { ...data, widthPct: latestPct });
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    stage.appendChild(resizeHandle);
    figureEl.appendChild(stage);

    // Caption & Source footer
    if (data.caption || data.source) {
      const capEl = document.createElement('figcaption');
      capEl.className = 'rm-figure-caption';
      capEl.style.width = `${data.widthPct}%`;
      let capHtml = '';
      if (data.caption) {
        capHtml += `<span class="rm-cap-text">${escapeHtml(data.caption)}</span>`;
      }
      if (data.source) {
        capHtml += `<span class="rm-cap-source">${data.caption ? ' — ' : ''}Source: ${escapeHtml(data.source)}</span>`;
      }
      capEl.innerHTML = capHtml;
      capEl.title = 'Click to edit caption or source';
      capEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openImageMetaModal(figureEl, data);
      });
      figureEl.appendChild(capEl);
    }

    // Resolve image Blob from IndexedDB asynchronously
    resolveImageObjectUrl(data.imageId)
      .then(url => {
        if (!figureEl.isConnected) return;
        imgWrap.innerHTML = '';
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = data.caption || data.fileName || 'Research figure';
          img.className = 'rm-figure-img';
          img.draggable = false;
          imgWrap.appendChild(img);
        } else {
          imgWrap.innerHTML = `
            <div class="rm-figure-missing">
              Image file (${escapeHtml(data.fileName || data.imageId)}) is not stored locally.
              Use <strong>Replace</strong> or import a Full ZIP backup to restore binary images.
            </div>
          `;
        }
      })
      .catch(() => {
        if (figureEl.isConnected) {
          imgWrap.innerHTML = '<div class="rm-figure-missing">Failed to load image from local storage.</div>';
        }
      });
  }

  function triggerReplaceImage(figureEl, oldData) {
    const ctx = findSectionContextForElement(figureEl);
    if (!ctx) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const paperId = ctx.getPaperId ? ctx.getPaperId() : ctx.paperId;
        const saved = await trackPendingUpload(storeImageFileInDB(paperId, ctx.sectionId, file));
        replaceEmbedInQuill(figureEl, 'research-image', {
          ...oldData,
          imageId: saved.id,
          fileName: saved.fileName
        });
        if (ctx.onChange) ctx.onChange();
      } catch (err) {
        if (window.App && window.App.showToast) {
          window.App.showToast(err.message || 'Failed to replace image.', 'error');
        }
      }
    };
    input.click();
  }

  /* ========================================================================
     6. Interactive Editable Table Controls inside Editor
     ======================================================================== */

  function syncTableDataToAttribute(tableEl, data) {
    const normalized = normalizeTableValue(data);
    tableEl.setAttribute('data-table-json', JSON.stringify(normalized));
    const ctx = findSectionContextForElement(tableEl);
    if (ctx && ctx.onChange) {
      ctx.onChange();
    }
  }

  function buildTableDom(tableBlockEl, data) {
    tableBlockEl.innerHTML = '';

    // Contextual Table Action Toolbar
    const bar = document.createElement('div');
    bar.className = 'rm-table-toolbar';
    bar.setAttribute('contenteditable', 'false');

    const structureBtns = document.createElement('div');
    structureBtns.className = 'rm-table-btn-group';

    const makeBtn = (text, title, onClick, isDanger = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rm-table-btn' + (isDanger ? ' rm-fig-btn-danger' : '');
      b.textContent = text;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const makeFormatBtn = (htmlLabel, title, cmd) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rm-table-btn rm-table-fmt-btn';
      b.innerHTML = htmlLabel;
      b.title = title;
      // Preserve selection inside active contenteditable cell!
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const activeCell = document.activeElement;
        if (activeCell && tableBlockEl.contains(activeCell) && activeCell.classList.contains('rm-table-cell-edit')) {
          if (cmd === 'code') {
            toggleInlineCodeOnSelection(activeCell);
          } else {
            document.execCommand(cmd, false, null);
          }
          syncTableFromCellsDom(tableBlockEl, data);
        }
      });
      return b;
    };

    structureBtns.append(
      makeBtn('+ Row', 'Add row at bottom', () => {
        const cur = readCurrentTableData(tableBlockEl, data);
        const colCount = cur.rows[0] ? cur.rows[0].length : 2;
        cur.rows.push(new Array(colCount).fill(''));
        replaceEmbedInQuill(tableBlockEl, 'research-table', cur);
      }),
      makeBtn('- Row', 'Remove last row', () => {
        const cur = readCurrentTableData(tableBlockEl, data);
        if (cur.rows.length <= 1) return;
        cur.rows.pop();
        replaceEmbedInQuill(tableBlockEl, 'research-table', cur);
      }),
      makeBtn('+ Col', 'Add column on right', () => {
        const cur = readCurrentTableData(tableBlockEl, data);
        cur.rows = cur.rows.map((r, idx) => [...r, idx === 0 && cur.hasHeader ? `Col ${r.length + 1}` : '']);
        replaceEmbedInQuill(tableBlockEl, 'research-table', cur);
      }),
      makeBtn('- Col', 'Remove last column', () => {
        const cur = readCurrentTableData(tableBlockEl, data);
        if (!cur.rows[0] || cur.rows[0].length <= 1) return;
        cur.rows = cur.rows.map(r => r.slice(0, -1));
        replaceEmbedInQuill(tableBlockEl, 'research-table', cur);
      }),
      makeBtn(data.hasHeader ? 'Header: On' : 'Header: Off', 'Toggle header row styling', () => {
        const cur = readCurrentTableData(tableBlockEl, data);
        cur.hasHeader = !cur.hasHeader;
        replaceEmbedInQuill(tableBlockEl, 'research-table', cur);
      })
    );

    const fmtGroup = document.createElement('div');
    fmtGroup.className = 'rm-table-btn-group';
    fmtGroup.append(
      makeFormatBtn('<b>B</b>', 'Bold text inside selected cell', 'bold'),
      makeFormatBtn('<i>I</i>', 'Italic text inside selected cell', 'italic'),
      makeFormatBtn('<u>U</u>', 'Underline text inside selected cell', 'underline'),
      makeFormatBtn('<code>&lt;/&gt;</code>', 'Inline code inside selected cell', 'code')
    );

    const delGroup = document.createElement('div');
    delGroup.className = 'rm-table-btn-group';
    delGroup.append(
      makeBtn('Delete Table', 'Remove entire table', () => {
        deleteEmbedInQuill(tableBlockEl);
      }, true)
    );

    bar.append(structureBtns, fmtGroup, delGroup);
    tableBlockEl.appendChild(bar);

    // Responsive scrollable table wrapper
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'rm-table-scroll-wrap';

    const table = document.createElement('table');
    table.className = 'rm-editor-table';

    data.rows.forEach((rowCells, rIdx) => {
      const isHeaderRow = data.hasHeader && rIdx === 0;
      const tr = document.createElement('tr');
      rowCells.forEach((cellHtml, cIdx) => {
        const cellTag = isHeaderRow ? 'th' : 'td';
        const td = document.createElement(cellTag);
        const editDiv = document.createElement('div');
        editDiv.className = 'rm-table-cell-edit';
        editDiv.setAttribute('contenteditable', 'true');
        editDiv.setAttribute('data-row', String(rIdx));
        editDiv.setAttribute('data-col', String(cIdx));
        editDiv.setAttribute('data-placeholder', isHeaderRow ? `Header ${cIdx + 1}` : 'Enter value...');
        editDiv.innerHTML = cellHtml || '';

        // Stop Quill from intercepting cell typing, pasting, backspace, or enter
        ['keydown', 'keyup', 'keypress'].forEach(evtName => {
          editDiv.addEventListener(evtName, (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              return; // Allow Ctrl+S global save
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              e.stopPropagation();
              moveTableCellFocus(tableBlockEl, rIdx, cIdx, e.shiftKey ? -1 : 1);
              return;
            }
            e.stopPropagation();
          });
        });

        editDiv.addEventListener('paste', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
          document.execCommand('insertText', false, plain);
        });

        editDiv.addEventListener('input', () => {
          syncTableFromCellsDom(tableBlockEl, data);
        });

        editDiv.addEventListener('blur', () => {
          const clean = sanitizeInlineCellHtml(editDiv.innerHTML);
          if (clean !== editDiv.innerHTML) {
            editDiv.innerHTML = clean;
          }
          syncTableFromCellsDom(tableBlockEl, data);
        });

        td.appendChild(editDiv);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    scrollWrap.appendChild(table);
    tableBlockEl.appendChild(scrollWrap);
  }

  function readCurrentTableData(tableBlockEl, fallbackData) {
    try {
      return normalizeTableValue(JSON.parse(tableBlockEl.getAttribute('data-table-json') || JSON.stringify(fallbackData)));
    } catch {
      return normalizeTableValue(fallbackData);
    }
  }

  function syncTableFromCellsDom(tableBlockEl, baseData) {
    const cur = readCurrentTableData(tableBlockEl, baseData);
    const cells = tableBlockEl.querySelectorAll('.rm-table-cell-edit');
    cells.forEach(cellEl => {
      const r = parseInt(cellEl.getAttribute('data-row'), 10);
      const c = parseInt(cellEl.getAttribute('data-col'), 10);
      if (cur.rows[r] && c >= 0 && c < cur.rows[r].length) {
        cur.rows[r][c] = sanitizeInlineCellHtml(cellEl.innerHTML);
      }
    });
    syncTableDataToAttribute(tableBlockEl, cur);
  }

  function moveTableCellFocus(tableBlockEl, curR, curC, dir) {
    const cells = Array.from(tableBlockEl.querySelectorAll('.rm-table-cell-edit'));
    const curEl = tableBlockEl.querySelector(`.rm-table-cell-edit[data-row="${curR}"][data-col="${curC}"]`);
    const idx = cells.indexOf(curEl);
    const next = cells[idx + dir];
    if (next) next.focus();
  }

  function toggleInlineCodeOnSelection(cellEl) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!cellEl.contains(range.commonAncestorContainer)) return;
    const text = range.toString();
    if (!text) return;
    const code = document.createElement('code');
    code.textContent = text;
    range.deleteContents();
    range.insertNode(code);
  }

  /* ========================================================================
     7. Modals: Math Equation Editor, Insert Table, Image Caption/Source
     ======================================================================== */

  function ensureModalsBound() {
    // Bind Math Modal events once
    const mathModal = document.getElementById('mathEditorModal');
    if (mathModal && !mathModal.dataset.bound) {
      mathModal.dataset.bound = '1';
      const latexInput = document.getElementById('mathLatexInput');
      const previewBox = document.getElementById('mathLivePreview');
      const modeRadios = mathModal.querySelectorAll('input[name="mathDisplayMode"]');
      const applyBtn = document.getElementById('applyMathBtn');

      const updatePreview = () => {
        if (!previewBox || !latexInput) return;
        const latex = latexInput.value.trim();
        const isBlock = mathModal.querySelector('input[name="mathDisplayMode"]:checked')?.value === 'block';
        if (!latex) {
          previewBox.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8125rem;">Type a LaTeX expression above to preview rendered equation...</span>';
          return;
        }
        if (typeof window.katex !== 'undefined') {
          try {
            window.katex.render(latex, previewBox, {
              displayMode: isBlock,
              throwOnError: false
            });
          } catch (err) {
            previewBox.textContent = err.message;
          }
        } else {
          previewBox.textContent = latex;
        }
      };

      latexInput?.addEventListener('input', updatePreview);
      modeRadios.forEach(r => r.addEventListener('change', updatePreview));

      mathModal.querySelectorAll('[data-latex-snippet]').forEach(btn => {
        btn.addEventListener('click', () => {
          const snippet = btn.getAttribute('data-latex-snippet') || '';
          insertAtCursor(latexInput, snippet);
          updatePreview();
        });
      });

      applyBtn?.addEventListener('click', () => {
        const latex = (latexInput?.value || '').trim();
        if (!latex) {
          window.App?.showToast('Please enter a LaTeX equation.', 'error');
          return;
        }
        const isBlock = mathModal.querySelector('input[name="mathDisplayMode"]:checked')?.value === 'block';
        const val = { latex, displayMode: isBlock };

        if (activeModalContext && activeModalContext.type === 'math-edit') {
          replaceEmbedInQuill(activeModalContext.targetEl, 'math-equation', val);
        } else if (activeModalContext && activeModalContext.type === 'math-insert') {
          const { quill, index } = activeModalContext;
          const insertPos = typeof index === 'number' ? index : quill.getLength() - 1;
          quill.insertEmbed(insertPos, 'math-equation', val, 'user');
          quill.insertText(insertPos + 1, isBlock ? '\n' : ' ', 'user');
          quill.setSelection(insertPos + 2, 0, 'user');
        }
        closeEditorModal(mathModal);
      });
    }

    // Bind Insert Table Modal events once
    const tableModal = document.getElementById('insertTableModal');
    if (tableModal && !tableModal.dataset.bound) {
      tableModal.dataset.bound = '1';
      const applyTableBtn = document.getElementById('applyTableInsertBtn');
      applyTableBtn?.addEventListener('click', () => {
        const rowsN = Math.max(1, Math.min(20, parseInt(document.getElementById('tableRowsInput')?.value || '3', 10) || 3));
        const colsN = Math.max(1, Math.min(10, parseInt(document.getElementById('tableColsInput')?.value || '3', 10) || 3));
        const hasHeader = Boolean(document.getElementById('tableHeaderToggle')?.checked);

        const rows = [];
        for (let r = 0; r < rowsN; r++) {
          const row = [];
          for (let c = 0; c < colsN; c++) {
            row.push(hasHeader && r === 0 ? `Header ${c + 1}` : '');
          }
          rows.push(row);
        }

        if (activeModalContext && activeModalContext.type === 'table-insert') {
          const { quill, index } = activeModalContext;
          const pos = typeof index === 'number' ? index : Math.max(0, quill.getLength() - 1);
          quill.insertEmbed(pos, 'research-table', { hasHeader, rows }, 'user');
          quill.insertText(pos + 1, '\n', 'silent');
          quill.setSelection(pos + 2, 0, 'silent');
        }
        closeEditorModal(tableModal);
      });
    }

    // Bind Image Caption & Source Modal once
    const imgMetaModal = document.getElementById('imageMetaModal');
    if (imgMetaModal && !imgMetaModal.dataset.bound) {
      imgMetaModal.dataset.bound = '1';
      document.getElementById('applyImageMetaBtn')?.addEventListener('click', () => {
        if (activeModalContext && activeModalContext.type === 'image-meta') {
          const caption = (document.getElementById('imageCaptionInput')?.value || '').trim();
          const source = (document.getElementById('imageSourceInput')?.value || '').trim();
          replaceEmbedInQuill(activeModalContext.targetEl, 'research-image', {
            ...activeModalContext.data,
            caption,
            source
          });
        }
        closeEditorModal(imgMetaModal);
      });
    }
  }

  function openEditorModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('active');
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeEditorModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('active');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    activeModalContext = null;
  }

  function openMathModalForInsert(quill) {
    ensureModalsBound();
    const modal = document.getElementById('mathEditorModal');
    if (!modal) return;
    const sel = quill.getSelection(true);
    activeModalContext = { type: 'math-insert', quill, index: sel ? sel.index : Math.max(0, quill.getLength() - 1) };

    const titleEl = document.getElementById('mathModalTitle');
    if (titleEl) titleEl.textContent = 'Insert Mathematical Equation (LaTeX)';
    const latexInput = document.getElementById('mathLatexInput');
    if (latexInput) latexInput.value = '';
    const inlineRadio = modal.querySelector('input[name="mathDisplayMode"][value="inline"]');
    if (inlineRadio) inlineRadio.checked = true;
    const preview = document.getElementById('mathLivePreview');
    if (preview) preview.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8125rem;">Type a LaTeX expression above to preview rendered equation...</span>';

    openEditorModal(modal);
    setTimeout(() => latexInput?.focus(), 60);
  }

  function openMathModalForEdit(mathEl) {
    ensureModalsBound();
    const modal = document.getElementById('mathEditorModal');
    if (!modal) return;
    const cur = MathEquationBlotValue(mathEl);
    activeModalContext = { type: 'math-edit', targetEl: mathEl };

    const titleEl = document.getElementById('mathModalTitle');
    if (titleEl) titleEl.textContent = 'Edit Mathematical Equation';
    const latexInput = document.getElementById('mathLatexInput');
    if (latexInput) latexInput.value = cur.latex || '';
    const modeVal = cur.displayMode ? 'block' : 'inline';
    const radio = modal.querySelector(`input[name="mathDisplayMode"][value="${modeVal}"]`);
    if (radio) radio.checked = true;
    latexInput?.dispatchEvent(new Event('input'));

    openEditorModal(modal);
    setTimeout(() => latexInput?.focus(), 60);
  }

  function MathEquationBlotValue(node) {
    try {
      return normalizeMathValue(JSON.parse(node.getAttribute('data-math-json') || '{}'));
    } catch {
      return { latex: '', displayMode: false };
    }
  }

  function openTableInsertModal(quill) {
    ensureModalsBound();
    const modal = document.getElementById('insertTableModal');
    if (!modal) return;
    const sel = quill.getSelection(true);
    activeModalContext = { type: 'table-insert', quill, index: sel ? sel.index : Math.max(0, quill.getLength() - 1) };
    openEditorModal(modal);
  }

  function openImageMetaModal(figureEl, data) {
    ensureModalsBound();
    const modal = document.getElementById('imageMetaModal');
    if (!modal) return;
    activeModalContext = { type: 'image-meta', targetEl: figureEl, data };
    const capIn = document.getElementById('imageCaptionInput');
    const srcIn = document.getElementById('imageSourceInput');
    if (capIn) capIn.value = data.caption || '';
    if (srcIn) srcIn.value = data.source || '';
    openEditorModal(modal);
    setTimeout(() => capIn?.focus(), 60);
  }

  function insertAtCursor(textarea, snippet) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const val = textarea.value;
    textarea.value = val.slice(0, start) + snippet + val.slice(end);
    const nextPos = start + snippet.length;
    textarea.setSelectionRange(nextPos, nextPos);
    textarea.focus();
  }

  /* ========================================================================
     8. Unified Section Editor Instantiation & Public API
     ======================================================================== */

  function insertUploadedImagesIntoQuill(ctx, files) {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return Promise.resolve();

    const paperId = ctx.getPaperId ? ctx.getPaperId() : ctx.paperId;
    if (!paperId) return Promise.resolve();

    const p = (async () => {
      for (const file of fileList) {
        try {
          const saved = await storeImageFileInDB(paperId, ctx.sectionId, file);
          const sel = ctx.quill.getSelection(true);
          const insertPos = sel ? sel.index : Math.max(0, ctx.quill.getLength() - 1);
          ctx.quill.insertEmbed(
            insertPos,
            'research-image',
            {
              imageId: saved.id,
              widthPct: 75,
              align: 'center',
              caption: '',
              source: '',
              fileName: saved.fileName
            },
            'user'
          );
          ctx.quill.insertText(insertPos + 1, '\n', 'user');
          ctx.quill.setSelection(insertPos + 2, 0, 'silent');
        } catch (err) {
          console.error('Image insert failed:', err);
          if (window.App && window.App.showToast) {
            window.App.showToast(err.message || 'Failed to insert image.', 'error');
          }
        }
      }
      if (ctx.onChange) ctx.onChange();
    })();

    return trackPendingUpload(p);
  }

  /**
   * Builds and mounts one unified Quill rich-content editor inside hostEl.
   */
  function createSectionEditor({ sectionId, paperId, hostEl, initialContent, placeholder, onChange, getPaperId }) {
    registerCustomBlots();
    ensureModalsBound();

    hostEl.innerHTML = '';

    // Custom Toolbar DOM (compact academic controls)
    const toolbarEl = document.createElement('div');
    toolbarEl.className = 'rm-ql-toolbar';
    toolbarEl.innerHTML = `
      <span class="ql-formats">
        <select class="ql-header" title="Heading / Paragraph">
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option selected value="">Normal</option>
        </select>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-bold" title="Bold (Ctrl+B)"></button>
        <button type="button" class="ql-italic" title="Italic (Ctrl+I)"></button>
        <button type="button" class="ql-underline" title="Underline (Ctrl+U)"></button>
        <button type="button" class="ql-strike" title="Strikethrough"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-list" value="bullet" title="Bullet List"></button>
        <button type="button" class="ql-list" value="ordered" title="Numbered List"></button>
        <button type="button" class="ql-blockquote" title="Blockquote"></button>
        <button type="button" class="ql-code-block" title="Code Block"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-link" title="Insert Hyperlink"></button>
        <button type="button" class="rm-tool-btn rm-tool-hr" title="Insert Horizontal Divider">—</button>
        <button type="button" class="ql-clean" title="Clear Formatting"></button>
      </span>
      <span class="ql-formats rm-tool-rich-group">
        <button type="button" class="rm-tool-btn rm-tool-image" title="Insert Image / Diagram (PNG, JPG, WEBP)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span>Image</span>
        </button>
        <button type="button" class="rm-tool-btn rm-tool-table" title="Insert Comparison Table">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="12" y1="3" x2="12" y2="21"></line></svg>
          <span>Table</span>
        </button>
        <button type="button" class="rm-tool-btn rm-tool-math" title="Insert LaTeX Equation (Inline or Block)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 4H6l6 8-6 8h12"></path></svg>
          <span>Math</span>
        </button>
      </span>
      <span class="ql-formats">
        <button type="button" class="rm-tool-btn rm-tool-undo" title="Undo (Ctrl+Z)">↺</button>
        <button type="button" class="rm-tool-btn rm-tool-redo" title="Redo (Ctrl+Y)">↻</button>
      </span>
    `;

    const editorContainer = document.createElement('div');
    editorContainer.className = 'rm-ql-editor-surface';
    editorContainer.setAttribute('data-section-id', sectionId);

    hostEl.append(toolbarEl, editorContainer);

    const quill = new window.Quill(editorContainer, {
      theme: 'snow',
      placeholder: placeholder || 'Write notes, paste/drop diagrams, insert tables or LaTeX math...',
      formats: [
        'header', 'bold', 'italic', 'underline', 'strike',
        'blockquote', 'code-block', 'code', 'list', 'link',
        'hr', 'math-equation', 'research-image', 'research-table'
      ],
      modules: {
        toolbar: {
          container: toolbarEl
        },
        history: {
          delay: 600,
          maxStack: 150,
          userOnly: true
        }
      }
    });

    const ctx = {
      sectionId,
      paperId,
      quill,
      hostEl,
      onChange,
      getPaperId
    };
    editorsBySection.set(sectionId, ctx);

    // Load initial Delta content silently without triggering dirty flag
    const normalized = window.ResearchMateDB
      ? window.ResearchMateDB.normalizeSectionContent(initialContent)
      : { format: 'quill-delta-v1', delta: { ops: [] } };
    if (normalized.delta && Array.isArray(normalized.delta.ops) && normalized.delta.ops.length > 0) {
      quill.setContents(normalized.delta.ops, 'silent');
    } else {
      quill.setText('', 'silent');
    }

    // Wire custom toolbar buttons
    toolbarEl.querySelector('.rm-tool-hr')?.addEventListener('click', () => {
      const sel = quill.getSelection(true);
      const pos = sel ? sel.index : Math.max(0, quill.getLength() - 1);
      quill.insertEmbed(pos, 'hr', true, 'user');
      quill.insertText(pos + 1, '\n', 'silent');
      quill.setSelection(pos + 2, 0, 'silent');
    });

    toolbarEl.querySelector('.rm-tool-undo')?.addEventListener('click', () => quill.history.undo());
    toolbarEl.querySelector('.rm-tool-redo')?.addEventListener('click', () => quill.history.redo());
    toolbarEl.querySelector('.rm-tool-table')?.addEventListener('click', () => openTableInsertModal(quill));
    toolbarEl.querySelector('.rm-tool-math')?.addEventListener('click', () => openMathModalForInsert(quill));
    toolbarEl.querySelector('.rm-tool-image')?.addEventListener('click', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
      fileInput.onchange = () => {
        if (fileInput.files && fileInput.files.length > 0) {
          insertUploadedImagesIntoQuill(ctx, fileInput.files);
        }
      };
      fileInput.click();
    });

    // Click existing equation to edit original LaTeX
    editorContainer.addEventListener('click', (e) => {
      const mathEmbed = e.target.closest('.rm-math-embed');
      if (mathEmbed && editorContainer.contains(mathEmbed)) {
        e.preventDefault();
        e.stopPropagation();
        openMathModalForEdit(mathEmbed);
      }
    });

    // Drag & Drop images into section editor
    const editorDom = quill.root;
    editorDom.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        editorDom.classList.add('rm-drop-active');
      }
    });
    editorDom.addEventListener('dragleave', () => editorDom.classList.remove('rm-drop-active'));
    editorDom.addEventListener('drop', (e) => {
      editorDom.classList.remove('rm-drop-active');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertUploadedImagesIntoQuill(ctx, e.dataTransfer.files);
      }
    });

    // Clipboard Paste image handling (prevent raw base64 data URI insertion by Quill!)
    editorDom.addEventListener('paste', (e) => {
      const clipboard = e.clipboardData;
      if (!clipboard) return;
      const imageFiles = [];
      if (clipboard.items && clipboard.items.length > 0) {
        for (let i = 0; i < clipboard.items.length; i++) {
          const item = clipboard.items[i];
          if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) imageFiles.push(f);
          }
        }
      } else if (clipboard.files && clipboard.files.length > 0) {
        for (let i = 0; i < clipboard.files.length; i++) {
          const f = clipboard.files[i];
          if (isValidImageFile(f)) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertUploadedImagesIntoQuill(ctx, imageFiles);
      }
    }, true);

    // Strip accidental native base64 image ops if any slip in (belt-and-suspenders)
    quill.on('text-change', (delta, oldDelta, source) => {
      if (source === 'user' && onChange) {
        onChange();
      }
    });

    return {
      sectionId,
      quill,
      getContent() {
        const delta = quill.getContents();
        return {
          format: 'quill-delta-v1',
          delta: { ops: delta && Array.isArray(delta.ops) ? delta.ops : [] }
        };
      },
      setContent(rawContent) {
        const norm = window.ResearchMateDB
          ? window.ResearchMateDB.normalizeSectionContent(rawContent)
          : { format: 'quill-delta-v1', delta: { ops: [] } };
        if (norm.delta && norm.delta.ops.length > 0) {
          quill.setContents(norm.delta.ops, 'silent');
        } else {
          quill.setText('', 'silent');
        }
      },
      focus() {
        quill.focus();
      },
      insertImages(files) {
        return insertUploadedImagesIntoQuill(ctx, files);
      }
    };
  }

  function clearSectionEditors() {
    editorsBySection.clear();
  }

  /* ========================================================================
     9. Structured Delta -> Formatted HTML Renderer (for Preview Mode)
     ======================================================================== */

  function renderInlineOpHtml(op) {
    if (!op) return '';
    if (op.insert && typeof op.insert === 'object') {
      if (op.insert['math-equation']) {
        const m = normalizeMathValue(op.insert['math-equation']);
        let rendered = escapeHtml(m.latex);
        if (typeof window.katex !== 'undefined') {
          try {
            rendered = window.katex.renderToString(m.latex, {
              displayMode: m.displayMode,
              throwOnError: false
            });
          } catch (_) {}
        }
        return m.displayMode
          ? `<div class="rm-preview-math-block">${rendered}</div>`
          : `<span class="rm-preview-math-inline">${rendered}</span>`;
      }
      return '';
    }

    if (typeof op.insert !== 'string') return '';
    let html = escapeHtml(op.insert);
    const attrs = op.attributes || {};
    if (attrs.code) html = `<code>${html}</code>`;
    if (attrs.bold) html = `<strong>${html}</strong>`;
    if (attrs.italic) html = `<em>${html}</em>`;
    if (attrs.underline) html = `<u>${html}</u>`;
    if (attrs.strike) html = `<s>${html}</s>`;
    if (attrs.link) {
      const safeHref = /^https?:|^mailto:|^#/i.test(attrs.link) ? attrs.link : '#';
      html = `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
    return html;
  }

  /**
   * Renders a structured Delta section into clean semantic academic HTML.
   * Uses placeholders `<figure data-preview-image-id="...">` which are hydrated with IndexedDB Blob URLs.
   */
  function renderSectionDeltaToHtml(rawContent) {
    const norm = window.ResearchMateDB
      ? window.ResearchMateDB.normalizeSectionContent(rawContent)
      : { format: 'quill-delta-v1', delta: { ops: [] } };
    const ops = norm.delta && Array.isArray(norm.delta.ops) ? norm.delta.ops : [];
    if (ops.length === 0) return '';

    // Parse Quill Delta ops into logical lines (each trailing \n carries line attributes!)
    const lines = [];
    let currentLineInlines = [];

    const pushCurrentLine = (lineAttrs) => {
      lines.push({ inlines: currentLineInlines, attrs: lineAttrs || {} });
      currentLineInlines = [];
    };

    ops.forEach(op => {
      if (!op) return;
      if (op.insert && typeof op.insert === 'object') {
        // Block embeds vs inline embeds
        if (op.insert['research-image']) {
          if (currentLineInlines.length > 0) pushCurrentLine({});
          lines.push({ blockEmbed: 'research-image', value: normalizeImageValue(op.insert['research-image']) });
        } else if (op.insert['research-table']) {
          if (currentLineInlines.length > 0) pushCurrentLine({});
          lines.push({ blockEmbed: 'research-table', value: normalizeTableValue(op.insert['research-table']) });
        } else if (op.insert['hr']) {
          if (currentLineInlines.length > 0) pushCurrentLine({});
          lines.push({ blockEmbed: 'hr', value: true });
        } else if (op.insert['math-equation']) {
          const m = normalizeMathValue(op.insert['math-equation']);
          if (m.displayMode) {
            if (currentLineInlines.length > 0) pushCurrentLine({});
            lines.push({ blockEmbed: 'math-block', value: m });
          } else {
            currentLineInlines.push(op);
          }
        }
        return;
      }

      if (typeof op.insert === 'string') {
        const text = op.insert;
        let start = 0;
        let nlIdx;
        while ((nlIdx = text.indexOf('\n', start)) !== -1) {
          const segment = text.slice(start, nlIdx);
          if (segment.length > 0) {
            currentLineInlines.push({ insert: segment, attributes: op.attributes });
          }
          pushCurrentLine(op.attributes || {});
          start = nlIdx + 1;
        }
        if (start < text.length) {
          currentLineInlines.push({ insert: text.slice(start), attributes: op.attributes });
        }
      }
    });

    if (currentLineInlines.length > 0) {
      pushCurrentLine({});
    }

    // Group adjacent list / code-block lines into semantic tags
    const htmlParts = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.blockEmbed === 'hr') {
        htmlParts.push('<hr class="rm-preview-hr">');
        i++;
        continue;
      }

      if (line.blockEmbed === 'math-block') {
        let mathHtml = escapeHtml(line.value.latex);
        if (typeof window.katex !== 'undefined') {
          try {
            mathHtml = window.katex.renderToString(line.value.latex, { displayMode: true, throwOnError: false });
          } catch (_) {}
        }
        htmlParts.push(`<div class="rm-preview-math-block">${mathHtml}</div>`);
        i++;
        continue;
      }

      if (line.blockEmbed === 'research-image') {
        const imgVal = line.value;
        let capHtml = '';
        if (imgVal.caption || imgVal.source) {
          capHtml = `<figcaption class="rm-figure-caption" style="width:${imgVal.widthPct}%;">`;
          if (imgVal.caption) capHtml += `<span class="rm-cap-text">${escapeHtml(imgVal.caption)}</span>`;
          if (imgVal.source) capHtml += `<span class="rm-cap-source">${imgVal.caption ? ' — ' : ''}Source: ${escapeHtml(imgVal.source)}</span>`;
          capHtml += `</figcaption>`;
        }
        htmlParts.push(`
          <figure class="rm-figure rm-preview-figure align-${imgVal.align}" data-preview-image-id="${escapeHtml(imgVal.imageId)}" data-image-filename="${escapeHtml(imgVal.fileName)}">
            <div class="rm-preview-img-box" style="width:${imgVal.widthPct}%;">
              <div class="rm-figure-loading">Loading figure...</div>
            </div>
            ${capHtml}
          </figure>
        `);
        i++;
        continue;
      }

      if (line.blockEmbed === 'research-table') {
        const tbl = line.value;
        let tblHtml = '<div class="rm-table-scroll-wrap"><table class="rm-preview-table">';
        let inBody = false;
        tbl.rows.forEach((row, rIdx) => {
          const isHead = tbl.hasHeader && rIdx === 0;
          if (isHead) tblHtml += '<thead>';
          else if (!inBody) { tblHtml += '<tbody>'; inBody = true; }
          tblHtml += '<tr>';
          row.forEach(cell => {
            const tag = isHead ? 'th' : 'td';
            tblHtml += `<${tag}>${sanitizeInlineCellHtml(cell) || '&nbsp;'}</${tag}>`;
          });
          tblHtml += '</tr>';
          if (isHead) tblHtml += '</thead>';
        });
        if (inBody) tblHtml += '</tbody>';
        tblHtml += '</table></div>';
        htmlParts.push(tblHtml);
        i++;
        continue;
      }

      const attrs = line.attrs || {};
      if (attrs.list === 'bullet' || attrs.list === 'ordered') {
        const listType = attrs.list;
        const listTag = listType === 'ordered' ? 'ol' : 'ul';
        let listHtml = `<${listTag} class="rm-preview-list">`;
        while (i < lines.length && !lines[i].blockEmbed && lines[i].attrs && lines[i].attrs.list === listType) {
          const inner = lines[i].inlines.map(renderInlineOpHtml).join('') || '&nbsp;';
          listHtml += `<li>${inner}</li>`;
          i++;
        }
        listHtml += `</${listTag}>`;
        htmlParts.push(listHtml);
        continue;
      }

      if (attrs['code-block']) {
        const codeLines = [];
        while (i < lines.length && !lines[i].blockEmbed && lines[i].attrs && lines[i].attrs['code-block']) {
          const textOnly = lines[i].inlines.map(op => (typeof op.insert === 'string' ? op.insert : '')).join('');
          codeLines.push(escapeHtml(textOnly));
          i++;
        }
        htmlParts.push(`<pre class="rm-preview-code"><code>${codeLines.join('\n')}</code></pre>`);
        continue;
      }

      const inner = line.inlines.map(renderInlineOpHtml).join('');
      if (attrs.header && [1, 2, 3].includes(Number(attrs.header))) {
        const hLevel = Number(attrs.header);
        htmlParts.push(`<h${hLevel} class="rm-preview-h${hLevel}">${inner}</h${hLevel}>`);
      } else if (attrs.blockquote) {
        htmlParts.push(`<blockquote class="rm-preview-quote">${inner}</blockquote>`);
      } else if (inner.trim().length > 0) {
        htmlParts.push(`<p class="formatted-p">${inner}</p>`);
      }
      i++;
    }

    return htmlParts.join('');
  }

  /**
   * Resolves all `<figure data-preview-image-id>` elements inside preview container from IndexedDB.
   */
  async function hydratePreviewImages(containerEl) {
    if (!containerEl) return;
    const figs = containerEl.querySelectorAll('figure[data-preview-image-id]');
    await Promise.all(
      Array.from(figs).map(async fig => {
        const imageId = fig.getAttribute('data-preview-image-id');
        const fileName = fig.getAttribute('data-image-filename') || imageId;
        const box = fig.querySelector('.rm-preview-img-box');
        if (!box) return;
        const url = await resolveImageObjectUrl(imageId);
        if (!fig.isConnected) return;
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = fileName;
          img.className = 'rm-figure-img';
          box.innerHTML = '';
          box.appendChild(img);
        } else {
          box.innerHTML = `<div class="rm-figure-missing">Image (${escapeHtml(fileName)}) not stored locally.</div>`;
        }
      })
    );
  }

  // Global exposure
  window.RichEditorManager = {
    createSectionEditor,
    clearSectionEditors,
    getEditor: (sectionId) => editorsBySection.get(sectionId) || null,
    resolveImageObjectUrl,
    revokeAllBlobUrls,
    waitForPendingUploads,
    getPendingUploadCount,
    renderSectionDeltaToHtml,
    hydratePreviewImages,
    sanitizeInlineCellHtml,
    stripTagsToText
  };
})();
