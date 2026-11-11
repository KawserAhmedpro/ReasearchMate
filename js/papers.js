/**
 * papers.js - Paper Management for ResearchMate (V1.1)
 * Handles:
 * - Two paper creation methods: Manual Entry and Original PDF Upload
 * - Drag-and-drop PDF selection and basic metadata extraction
 * - PDF file size check and display
 * - Storing immutable paper bibliographic info and original PDF
 * - "View Original PDF" action (creating temporary Blob URLs)
 * - Search, sort, and deletion confirmation
 */

(function () {
  'use strict';

  let currentPapers = [];
  let searchQuery = '';
  let sortBy = 'recently-added';
  let pendingDeletePaperId = null;

  // State for Add Paper Modal
  let activeAddTab = 'manual'; // 'manual' | 'upload'
  let selectedPdfFile = null;

  /**
   * Initializes paper management events and listeners.
   */
  function init() {
    setupEventListeners();
  }

  function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById('papersSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        searchQuery = e.target.value.trim().toLowerCase();
        if (clearSearchBtn) {
          clearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
        }
        renderMyPapers();
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchQuery = '';
          clearSearchBtn.style.display = 'none';
          searchInput.focus();
          renderMyPapers();
        }
      });
    }

    // Sort select
    const sortSelect = document.getElementById('papersSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', e => {
        sortBy = e.target.value;
        renderMyPapers();
      });
    }

    // Add Paper Tabs (Manual vs Upload PDF)
    const tabManualBtn = document.getElementById('tabAddManualBtn');
    const tabUploadBtn = document.getElementById('tabAddUploadBtn');
    if (tabManualBtn && tabUploadBtn) {
      tabManualBtn.addEventListener('click', () => switchAddTab('manual'));
      tabUploadBtn.addEventListener('click', () => switchAddTab('upload'));
    }

    // Add Paper Forms
    const manualForm = document.getElementById('addPaperManualForm');
    if (manualForm) {
      manualForm.addEventListener('submit', handleManualAddSubmit);
    }

    const uploadForm = document.getElementById('addPaperUploadForm');
    if (uploadForm) {
      uploadForm.addEventListener('submit', handleUploadAddSubmit);
    }

    // PDF Drag & Drop and File Input setup
    setupPdfUploadHandlers();

    // Add Paper Modal Trigger Buttons
    document.querySelectorAll('[data-action="open-add-paper-modal"]').forEach(btn => {
      btn.addEventListener('click', () => openAddPaperModal());
    });

    // Close Modal Buttons
    document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
      btn.addEventListener('click', () => closeAllModals());
    });

    // Delete Confirmation Modal Confirm Button
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', handleConfirmDelete);
    }

    // Close modal on Escape key
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeAllModals();
      }
    });

    // Close modal when clicking outside overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeAllModals();
        }
      });
    });
  }

  /**
   * Sets up drag & drop and file input for PDF upload.
   */
  function setupPdfUploadHandlers() {
    const dropzone = document.getElementById('pdfDropzone');
    const fileInput = document.getElementById('paperPdfFileInput');
    const removeBtn = document.getElementById('removeSelectedPdfBtn');

    if (dropzone && fileInput) {
      // Click dropzone to open file dialog
      dropzone.addEventListener('click', () => {
        fileInput.click();
      });

      // Handle keyboard accessible enter/space
      dropzone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });

      // Drag and drop events
      ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, e => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, e => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('drag-active');
        });
      });

      dropzone.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
          handlePdfFileSelected(files[0]);
        }
      });

      // File input change
      fileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
          handlePdfFileSelected(e.target.files[0]);
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        clearSelectedPdf();
      });
    }
  }

  /**
   * Handles user selecting a PDF file via input or drop.
   */
  async function handlePdfFileSelected(file) {
    const errorEl = document.getElementById('addPaperUploadError');
    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    // Validate MIME type & extension
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showError(errorEl, 'Invalid file type. Please select a valid PDF file.');
      return;
    }

    // Size check warning (> 100MB)
    const maxWarnBytes = 100 * 1024 * 1024;
    if (file.size > maxWarnBytes) {
      showError(errorEl, `Warning: File is quite large (${formatBytes(file.size)}). Browser storage may be impacted.`);
    }

    selectedPdfFile = file;

    // Display selected file info box
    const dropzone = document.getElementById('pdfDropzone');
    const fileInfo = document.getElementById('selectedPdfInfoBox');
    const fileNameEl = document.getElementById('selectedPdfFileName');
    const fileSizeEl = document.getElementById('selectedPdfFileSize');

    if (dropzone) dropzone.style.display = 'none';
    if (fileInfo) fileInfo.style.display = 'flex';
    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = formatBytes(file.size);

    // Attempt basic metadata extraction
    const extractStatus = document.getElementById('pdfExtractStatus');
    if (extractStatus) {
      extractStatus.style.display = 'flex';
      extractStatus.textContent = 'Analyzing PDF for bibliographic metadata...';
    }

    try {
      const extracted = await extractPdfMetadata(file);

      const titleInput = document.getElementById('uploadPaperTitle');
      const authorsInput = document.getElementById('uploadPaperAuthors');
      const yearInput = document.getElementById('uploadPaperYear');

      if (extracted.title && titleInput && !titleInput.value) {
        titleInput.value = extracted.title;
      }
      if (extracted.author && authorsInput && !authorsInput.value) {
        authorsInput.value = extracted.author;
      }
      if (extracted.year && yearInput && !yearInput.value) {
        yearInput.value = extracted.year;
      }

      if (extractStatus) {
        if (extracted.title || extracted.author) {
          extractStatus.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Extracted metadata from PDF. Please verify and edit details below:
          `;
          extractStatus.className = 'extract-status-box extract-success';
        } else {
          extractStatus.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            No embedded metadata found in PDF. Please enter details manually below:
          `;
          extractStatus.className = 'extract-status-box extract-neutral';
        }
      }
    } catch (err) {
      console.warn('PDF metadata extraction issue:', err);
      if (extractStatus) {
        extractStatus.textContent = 'Please enter paper details manually below:';
        extractStatus.className = 'extract-status-box extract-neutral';
      }
    }
  }

  /**
   * Clears selected PDF file.
   */
  function clearSelectedPdf() {
    selectedPdfFile = null;
    const fileInput = document.getElementById('paperPdfFileInput');
    if (fileInput) fileInput.value = '';

    const dropzone = document.getElementById('pdfDropzone');
    const fileInfo = document.getElementById('selectedPdfInfoBox');
    const extractStatus = document.getElementById('pdfExtractStatus');

    if (dropzone) dropzone.style.display = 'flex';
    if (fileInfo) fileInfo.style.display = 'none';
    if (extractStatus) extractStatus.style.display = 'none';
  }

  /**
   * Lightweight client-side PDF metadata extractor.
   * Scans binary chunks for /Title, /Author, and /CreationDate without AI or heavy libraries.
   */
  async function extractPdfMetadata(file) {
    const sliceSize = 65536; // 64 KB
    const headerBlob = file.slice(0, sliceSize);
    const tailBlob = file.size > sliceSize ? file.slice(Math.max(0, file.size - sliceSize)) : null;

    const [headerText, tailText] = await Promise.all([
      headerBlob.text().catch(() => ''),
      tailBlob ? tailBlob.text().catch(() => '') : Promise.resolve('')
    ]);

    const fullText = headerText + '\n' + tailText;

    let title = '';
    let author = '';
    let year = null;

    // Look for /Title (...)
    const titleMatch = fullText.match(/\/Title\s*\(([^)]+)\)/i);
    if (titleMatch && titleMatch[1]) {
      title = cleanPdfString(titleMatch[1]);
    }

    // Look for /Author (...)
    const authorMatch = fullText.match(/\/Author\s*\(([^)]+)\)/i);
    if (authorMatch && authorMatch[1]) {
      author = cleanPdfString(authorMatch[1]);
    }

    // Look for /CreationDate (D:YYYY...)
    const dateMatch = fullText.match(/\/CreationDate\s*\(D:(\d{4})/i);
    if (dateMatch && dateMatch[1]) {
      const y = parseInt(dateMatch[1], 10);
      if (y >= 1900 && y <= new Date().getFullYear() + 2) {
        year = y;
      }
    }

    // Fallback if title still blank: clean filename
    if (!title && file.name) {
      title = file.name
        .replace(/\.pdf$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return { title, author, year };
  }

  function cleanPdfString(raw) {
    if (!raw) return '';
    return raw
      .replace(/\\([()\\])/g, '$1')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim();
  }

  /**
   * Switches tabs in Add Paper modal.
   */
  function switchAddTab(tabName) {
    activeAddTab = tabName;
    const tabManualBtn = document.getElementById('tabAddManualBtn');
    const tabUploadBtn = document.getElementById('tabAddUploadBtn');
    const manualWrap = document.getElementById('addManualTabContent');
    const uploadWrap = document.getElementById('addUploadTabContent');

    if (tabName === 'manual') {
      if (tabManualBtn) tabManualBtn.classList.add('active');
      if (tabUploadBtn) tabUploadBtn.classList.remove('active');
      if (manualWrap) manualWrap.style.display = 'block';
      if (uploadWrap) uploadWrap.style.display = 'none';
      const input = document.getElementById('paperTitleInput');
      if (input) setTimeout(() => input.focus(), 50);
    } else {
      if (tabManualBtn) tabManualBtn.classList.remove('active');
      if (tabUploadBtn) tabUploadBtn.classList.add('active');
      if (manualWrap) manualWrap.style.display = 'none';
      if (uploadWrap) uploadWrap.style.display = 'block';
    }
  }

  /**
   * Opens the Add Paper Modal.
   */
  function openAddPaperModal(initialTab = 'manual') {
    const modal = document.getElementById('addPaperModal');
    const manualForm = document.getElementById('addPaperManualForm');
    const uploadForm = document.getElementById('addPaperUploadForm');
    const manualError = document.getElementById('addPaperError');
    const uploadError = document.getElementById('addPaperUploadError');

    if (manualForm) manualForm.reset();
    if (uploadForm) uploadForm.reset();
    clearSelectedPdf();

    if (manualError) manualError.style.display = 'none';
    if (uploadError) uploadError.style.display = 'none';

    switchAddTab(initialTab);

    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  /**
   * Closes all active modals.
   */
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    });
    pendingDeletePaperId = null;
  }

  /**
   * Handles Option 1: Add Paper Manually.
   */
  async function handleManualAddSubmit(e) {
    e.preventDefault();
    const titleInput = document.getElementById('paperTitleInput');
    const authorsInput = document.getElementById('paperAuthorsInput');
    const yearInput = document.getElementById('paperYearInput');
    const doiInput = document.getElementById('paperDoiInput');
    const errorEl = document.getElementById('addPaperError');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const title = titleInput.value.trim();
    const authors = authorsInput.value.trim();
    const year = yearInput.value.trim();
    const doiUrl = doiInput.value.trim();

    if (!title) {
      showError(errorEl, 'Please enter the paper title.');
      titleInput.focus();
      return;
    }
    if (!authors) {
      showError(errorEl, 'Please enter the author name(s).');
      authorsInput.focus();
      return;
    }

    if (year) {
      const yearNum = parseInt(year, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNum) || yearNum < 1500 || yearNum > currentYear + 5) {
        showError(errorEl, `Please enter a valid publication year (between 1500 and ${currentYear + 5}).`);
        yearInput.focus();
        return;
      }
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      const newPaper = await window.ResearchMateDB.addPaper({
        title,
        authors,
        year: year ? parseInt(year, 10) : null,
        doiUrl: doiUrl || ''
      });

      closeAllModals();
      e.target.reset();

      window.App.showToast('Paper added successfully!', 'success');
      await loadPapers();
      await window.App.updateDashboard();

      // Navigate to note editor
      window.NotesManager.openNoteEditor(newPaper.id);
    } catch (err) {
      console.error('Failed to add paper manually:', err);
      showError(errorEl, err.message || 'Failed to save paper.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Paper';
    }
  }

  /**
   * Handles Option 2: Upload Research Paper PDF.
   */
  async function handleUploadAddSubmit(e) {
    e.preventDefault();
    const titleInput = document.getElementById('uploadPaperTitle');
    const authorsInput = document.getElementById('uploadPaperAuthors');
    const yearInput = document.getElementById('uploadPaperYear');
    const doiInput = document.getElementById('uploadPaperDoi');
    const errorEl = document.getElementById('addPaperUploadError');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!selectedPdfFile) {
      showError(errorEl, 'Please select or drag-and-drop a research paper PDF file.');
      return;
    }

    const title = titleInput.value.trim();
    const authors = authorsInput.value.trim();
    const year = yearInput.value.trim();
    const doiUrl = doiInput.value.trim();

    if (!title) {
      showError(errorEl, 'Please enter or verify the paper title.');
      titleInput.focus();
      return;
    }
    if (!authors) {
      showError(errorEl, 'Please enter or verify the author name(s).');
      authorsInput.focus();
      return;
    }

    if (year) {
      const yearNum = parseInt(year, 10);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNum) || yearNum < 1500 || yearNum > currentYear + 5) {
        showError(errorEl, `Please enter a valid publication year (between 1500 and ${currentYear + 5}).`);
        yearInput.focus();
        return;
      }
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving PDF & Paper...';

      const newPaper = await window.ResearchMateDB.addPaper(
        {
          title,
          authors,
          year: year ? parseInt(year, 10) : null,
          doiUrl: doiUrl || ''
        },
        selectedPdfFile
      );

      closeAllModals();
      e.target.reset();
      clearSelectedPdf();

      window.App.showToast('Paper and original PDF saved successfully!', 'success');
      await loadPapers();
      await window.App.updateDashboard();

      // Navigate to note editor
      window.NotesManager.openNoteEditor(newPaper.id);
    } catch (err) {
      console.error('Failed to upload paper PDF:', err);
      showError(errorEl, err.message || 'Failed to save paper and PDF.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Paper & PDF';
    }
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  /**
   * Prompts user with custom modal before deleting a paper.
   */
  async function promptDeletePaper(paperId) {
    try {
      const paper = await window.ResearchMateDB.getPaperById(paperId);
      if (!paper) return;

      pendingDeletePaperId = paperId;
      const modal = document.getElementById('deleteConfirmModal');
      const titleSpan = document.getElementById('deletePaperTitlePreview');

      if (titleSpan) {
        titleSpan.textContent = `"${paper.title}"`;
      }

      if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
      }
    } catch (err) {
      console.error('Failed to prepare paper deletion:', err);
    }
  }

  /**
   * Confirms and executes paper & notes & PDF deletion.
   */
  async function handleConfirmDelete() {
    if (!pendingDeletePaperId) return;

    const paperId = pendingDeletePaperId;
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    try {
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';
      }

      await window.ResearchMateDB.deletePaper(paperId);

      closeAllModals();
      window.App.showToast('Paper, notes, and attached PDF deleted.', 'info');

      if (window.NotesManager && window.NotesManager.getCurrentPaperId() === paperId) {
        window.App.navigateTo('papers');
      }

      await loadPapers();
      await window.App.updateDashboard();
    } catch (err) {
      console.error('Error deleting paper:', err);
      window.App.showToast('Failed to delete paper. Please try again.', 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete Paper & Notes';
      }
      pendingDeletePaperId = null;
    }
  }

  /**
   * Loads all papers with completion stats from DB.
   */
  async function loadPapers() {
    try {
      currentPapers = await window.ResearchMateDB.getAllPapersWithStats();
      renderMyPapers();
      renderDashboardRecent();
      return currentPapers;
    } catch (err) {
      console.error('Failed to load papers:', err);
      window.App.showToast('Failed to load papers from database.', 'error');
      return [];
    }
  }

  /**
   * Applies search and sorting to paper records.
   */
  function getFilteredAndSortedPapers() {
    let result = [...currentPapers];

    // Filter by search query (title or author)
    if (searchQuery) {
      result = result.filter(p => {
        const titleMatch = (p.title || '').toLowerCase().includes(searchQuery);
        const authorMatch = (p.authors || '').toLowerCase().includes(searchQuery);
        return titleMatch || authorMatch;
      });
    }

    // Sort
    switch (sortBy) {
      case 'recently-added':
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case 'oldest':
        result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case 'title-asc':
        result.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'title-desc':
        result.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        break;
      case 'year-desc':
        result.sort((a, b) => (b.year || 0) - (a.year || 0));
        break;
      case 'year-asc':
        result.sort((a, b) => (a.year || 9999) - (b.year || 9999));
        break;
      default:
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return result;
  }

  function formatDisplayDate(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return isoString;
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Renders the My Papers section list/grid.
   */
  function renderMyPapers() {
    const listContainer = document.getElementById('papersListContainer');
    const emptyState = document.getElementById('papersEmptyState');
    const noResultsState = document.getElementById('papersNoResultsState');
    const countBadge = document.getElementById('myPapersCountBadge');

    if (!listContainer) return;

    const filtered = getFilteredAndSortedPapers();

    if (countBadge) {
      countBadge.textContent = `${currentPapers.length} paper${currentPapers.length === 1 ? '' : 's'}`;
    }

    if (currentPapers.length === 0) {
      listContainer.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (noResultsState) noResultsState.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    if (filtered.length === 0) {
      listContainer.innerHTML = '';
      if (noResultsState) {
        noResultsState.style.display = 'block';
        const queryDisplay = document.getElementById('noResultsQuery');
        if (queryDisplay) queryDisplay.textContent = `"${searchQuery}"`;
      }
      return;
    }

    if (noResultsState) noResultsState.style.display = 'none';

    listContainer.innerHTML = filtered.map(paper => renderPaperCard(paper)).join('');
    attachPaperActionListeners(listContainer);
  }

  /**
   * Renders a single paper card HTML.
   */
  function renderPaperCard(paper) {
    const safeTitle = escapeHtml(paper.title);
    const safeAuthors = escapeHtml(paper.authors);
    const yearText = paper.year ? paper.year : 'Year not specified';
    const addedDate = formatDisplayDate(paper.createdAt);
    const stats = paper.completion || { completedCount: 0, totalSections: 10, isComplete: false, isStarted: false };

    let statusClass = 'status-not-started';
    let statusText = 'No notes yet';
    if (stats.isComplete) {
      statusClass = 'status-complete';
      statusText = '10/10 Complete';
    } else if (stats.isStarted) {
      statusClass = 'status-in-progress';
      statusText = `${stats.completedCount}/10 Sections`;
    }

    const noteActionText = stats.isStarted ? 'Continue Notes' : 'Write Notes';

    // PDF badge and View Original PDF button
    const hasPdf = Boolean(paper.hasPdf);

    return `
      <article class="paper-card" data-paper-id="${paper.id}">
        <div class="paper-card-header">
          <div class="paper-card-badges">
            <span class="badge ${statusClass}">
              <span class="badge-dot"></span>
              ${statusText}
            </span>
            ${paper.year ? `<span class="badge badge-year">${yearText}</span>` : ''}
            ${
              hasPdf
                ? `
            <span class="badge badge-pdf" title="${escapeHtml(paper.pdfFileName || 'Original PDF attached')} (${formatBytes(paper.pdfFileSize)})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              PDF Attached
            </span>
            `
                : ''
            }
          </div>
          <span class="paper-date-added" title="Date Added: ${addedDate}">Added ${addedDate}</span>
        </div>

        <h3 class="paper-card-title">
          <a href="#" class="paper-title-link" data-action="view-notes" data-paper-id="${paper.id}">
            ${safeTitle}
          </a>
        </h3>

        <div class="paper-card-meta">
          <div class="paper-meta-row">
            <span class="meta-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </span>
            <span class="paper-authors">${safeAuthors}</span>
          </div>

          ${
            paper.doiUrl
              ? `
          <div class="paper-meta-row paper-doi-row">
            <span class="meta-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </span>
            <a href="${escapeHtml(paper.doiUrl)}" target="_blank" rel="noopener noreferrer" class="paper-doi-link" title="Open external DOI or URL">
              ${escapeHtml(paper.doiUrl)}
            </a>
          </div>
          `
              : ''
          }
        </div>

        <!-- Paper Actions -->
        <div class="paper-card-actions">
          ${
            hasPdf
              ? `
          <button type="button" class="btn btn-secondary btn-sm" data-action="view-original-pdf" data-paper-id="${paper.id}" title="Open original research paper PDF in new tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            View Original PDF
          </button>
          `
              : ''
          }

          <button type="button" class="btn btn-secondary btn-sm" data-action="view-notes" data-paper-id="${paper.id}" title="View Paper & Literature Review Notes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View Notes
          </button>

          <button type="button" class="btn btn-primary btn-sm" data-action="edit-notes" data-paper-id="${paper.id}" title="Write or Update Literature Review Notes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            ${noteActionText}
          </button>

          <button type="button" class="btn btn-secondary btn-sm" data-action="download-pdf" data-paper-id="${paper.id}" title="Download Notes as Individual PDF">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Notes PDF
          </button>

          <button type="button" class="btn btn-danger-ghost btn-sm btn-icon" data-action="delete-paper" data-paper-id="${paper.id}" title="Delete Paper, Notes, and PDF" aria-label="Delete Paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </article>
    `;
  }

  /**
   * Attaches event listeners to rendered action buttons inside a container.
   */
  function attachPaperActionListeners(container) {
    container.querySelectorAll('[data-action="view-original-pdf"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const id = btn.getAttribute('data-paper-id');
        await viewOriginalPdf(id, btn);
      });
    });

    container.querySelectorAll('[data-action="view-notes"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = btn.getAttribute('data-paper-id');
        window.NotesManager.openNoteView(id);
      });
    });

    container.querySelectorAll('[data-action="edit-notes"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = btn.getAttribute('data-paper-id');
        window.NotesManager.openNoteEditor(id);
      });
    });

    container.querySelectorAll('[data-action="download-pdf"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        const id = btn.getAttribute('data-paper-id');
        await triggerPdfDownload(id, btn);
      });
    });

    container.querySelectorAll('[data-action="delete-paper"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = btn.getAttribute('data-paper-id');
        promptDeletePaper(id);
      });
    });
  }

  /**
   * Opens the original uploaded PDF in a new browser tab using temporary Blob URL.
   */
  async function viewOriginalPdf(paperId, triggerBtn) {
    const origHtml = triggerBtn ? triggerBtn.innerHTML : '';
    try {
      if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.innerHTML = `
          <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          Loading PDF...
        `;
      }

      const pdfRecord = await window.ResearchMateDB.getPaperPdf(paperId);
      if (!pdfRecord || !pdfRecord.fileBlob) {
        window.App.showToast('Original PDF file was not found in local database.', 'error');
        return;
      }

      const blobUrl = URL.createObjectURL(pdfRecord.fileBlob);
      const newTab = window.open(blobUrl, '_blank');

      if (!newTab) {
        window.App.showToast('Pop-up blocked. Please allow pop-ups to view the PDF.', 'error');
      }

      // Clean up object URL after 2 minutes
      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }, 120000);
    } catch (err) {
      console.error('Failed to open PDF:', err);
      window.App.showToast('Failed to open original PDF.', 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origHtml;
      }
    }
  }

  /**
   * Triggers individual notes PDF download with feedback.
   */
  async function triggerPdfDownload(paperId, triggerBtn) {
    const originalHtml = triggerBtn ? triggerBtn.innerHTML : '';
    try {
      if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.innerHTML = `
          <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          Exporting...
        `;
      }

      const paper = await window.ResearchMateDB.getPaperById(paperId);
      if (!paper) {
        window.App.showToast('Paper not found.', 'error');
        return;
      }
      const notes = await window.ResearchMateDB.getNotesByPaperId(paperId);

      window.App.showToast('Generating literature review PDF...', 'info');
      await window.PDFExporter.exportPaperNotesAsPDF(paper, notes);
      window.App.showToast('Notes PDF downloaded successfully!', 'success');
    } catch (err) {
      console.error('PDF export failed:', err);
      window.App.showToast('Failed to export PDF. Please try again.', 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = originalHtml;
      }
    }
  }

  /**
   * Renders the Recently Added Papers on the Dashboard.
   */
  function renderDashboardRecent() {
    const container = document.getElementById('dashboardRecentContainer');
    const emptyState = document.getElementById('dashboardRecentEmpty');
    if (!container) return;

    const recent = currentPapers.slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = recent.map(paper => renderPaperCard(paper)).join('');
    attachPaperActionListeners(container);
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

  // Expose module
  window.PapersManager = {
    init,
    loadPapers,
    openAddPaperModal,
    promptDeletePaper,
    triggerPdfDownload,
    viewOriginalPdf,
    renderMyPapers,
    renderDashboardRecent,
    getAllPapers: () => currentPapers
  };
})();
