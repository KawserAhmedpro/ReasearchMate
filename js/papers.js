/**
 * papers.js - Paper Management for ResearchMate
 * Handles paper listing, search, sort, addition modal, and deletion confirmation.
 * Enforces the strict rule: Paper bibliographic details are immutable after creation.
 */

(function () {
  'use strict';

  let currentPapers = [];
  let searchQuery = '';
  let sortBy = 'recently-added';
  let pendingDeletePaperId = null;

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

    // Add Paper Form Submission
    const addPaperForm = document.getElementById('addPaperForm');
    if (addPaperForm) {
      addPaperForm.addEventListener('submit', handleAddPaperSubmit);
    }

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
   * Opens the Add Paper Modal and focuses the title field.
   */
  function openAddPaperModal() {
    const modal = document.getElementById('addPaperModal');
    const form = document.getElementById('addPaperForm');
    const titleInput = document.getElementById('paperTitleInput');
    const errorEl = document.getElementById('addPaperError');

    if (form) form.reset();
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }

    if (modal) {
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      setTimeout(() => {
        if (titleInput) titleInput.focus();
      }, 100);
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
   * Handles adding a new research paper.
   */
  async function handleAddPaperSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const titleInput = document.getElementById('paperTitleInput');
    const authorsInput = document.getElementById('paperAuthorsInput');
    const yearInput = document.getElementById('paperYearInput');
    const doiInput = document.getElementById('paperDoiInput');
    const errorEl = document.getElementById('addPaperError');
    const submitBtn = form.querySelector('button[type="submit"]');

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
      form.reset();

      window.App.showToast('Paper added successfully!', 'success');

      // Refresh data
      await loadPapers();

      // Immediately navigate user to write notes for this new paper
      window.NotesManager.openNoteEditor(newPaper.id);
    } catch (err) {
      console.error('Failed to add paper:', err);
      showError(errorEl, err.message || 'Failed to save paper. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Paper';
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
   * Confirms and executes paper & notes deletion.
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
      window.App.showToast('Paper and literature review notes deleted.', 'info');

      // If currently editing this paper, return to My Papers
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

  /**
   * Helper to format dates cleanly.
   */
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

    // Case 1: No papers exist in the system at all
    if (currentPapers.length === 0) {
      listContainer.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (noResultsState) noResultsState.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Case 2: Papers exist, but search filter produced zero matches
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

    // Case 3: Render list of papers
    listContainer.innerHTML = filtered.map(paper => renderPaperCard(paper)).join('');

    // Attach click event handlers for paper action buttons
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

    // Completion indicator pill styling
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

    return `
      <article class="paper-card" data-paper-id="${paper.id}">
        <div class="paper-card-header">
          <div class="paper-card-badges">
            <span class="badge ${statusClass}">
              <span class="badge-dot"></span>
              ${statusText}
            </span>
            ${paper.year ? `<span class="badge badge-year">${yearText}</span>` : ''}
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </span>
            <span class="paper-authors">${safeAuthors}</span>
          </div>

          ${
            paper.doiUrl
              ? `
          <div class="paper-meta-row paper-doi-row">
            <span class="meta-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </span>
            <a href="${escapeHtml(paper.doiUrl)}" target="_blank" rel="noopener noreferrer" class="paper-doi-link" title="Open external DOI or URL">
              ${escapeHtml(paper.doiUrl)}
            </a>
          </div>
          `
              : ''
          }
        </div>

        <!-- 4 Core Actions required by spec -->
        <div class="paper-card-actions">
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
            Download PDF
          </button>

          <button type="button" class="btn btn-danger-ghost btn-sm btn-icon" data-action="delete-paper" data-paper-id="${paper.id}" title="Delete Paper and Notes" aria-label="Delete Paper">
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
   * Triggers individual PDF download with visual feedback on button.
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

      window.App.showToast('Generating individual PDF...', 'info');
      await window.PDFExporter.exportPaperNotesAsPDF(paper, notes);
      window.App.showToast('PDF downloaded successfully!', 'success');
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
    renderMyPapers,
    renderDashboardRecent,
    getAllPapers: () => currentPapers
  };
})();

