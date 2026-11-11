/**
 * app.js - Main Application Coordinator for ResearchMate (V1.1)
 * Manages view routing, navigation, dashboard statistics, toast feedback,
 * and the complete Data Management system (Full ZIP backup, ZIP restore, and JSON notes export).
 */

(function () {
  'use strict';

  let currentView = 'dashboard';
  let toastTimeout = null;
  let stagedZipBackup = null; // Holds validated backup for restore

  /**
   * Initializes application on DOMContentLoaded.
   */
  async function init() {
    try {
      // 1. Initialize / Upgrade IndexedDB
      await window.ResearchMateDB.initDB();

      // 2. Setup modules
      if (window.PapersManager) window.PapersManager.init();
      if (window.NotesManager) window.NotesManager.init();

      // 3. Setup Navigation & Routing
      setupNavigation();

      // 4. Setup Data Management listeners (V1.1)
      setupDataManagement();

      // 5. Initial Data Load
      await window.PapersManager.loadPapers();
      await updateDashboard();

      // 6. Handle Initial Route from URL Hash
      handleHashChange();

      window.addEventListener('hashchange', handleHashChange);
    } catch (err) {
      console.error('Initialization error:', err);
      showToast('Failed to initialize local database: ' + err.message, 'error', 6000);
    }
  }

  /**
   * Sets up navigation click events and breadcrumbs.
   */
  function setupNavigation() {
    document.querySelectorAll('[data-nav]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const targetView = link.getAttribute('data-nav');
        if (currentView === 'notes' && window.NotesManager && typeof window.NotesManager.attemptNavigation === 'function') {
          window.NotesManager.attemptNavigation(targetView);
        } else {
          navigateTo(targetView);
        }
      });
    });
  }

  /**
   * Navigates to a specific view with unsaved changes safety guard.
   */
  function navigateTo(viewName, options = {}) {
    if (!options.skipUnsavedCheck && window.NotesManager && window.NotesManager.hasUnsavedChanges()) {
      const confirmLeave = window.confirm(
        'You have unsaved changes in your literature review notes. Discard changes and navigate away?'
      );
      if (!confirmLeave) return;
    }

    // Hide all view containers
    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.remove('active-view');
      view.style.display = 'none';
    });

    // Update active nav links
    document.querySelectorAll('[data-nav]').forEach(link => {
      if (link.getAttribute('data-nav') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    currentView = viewName;

    // Show target view
    const targetEl = document.getElementById(`${viewName}Section`);
    if (targetEl) {
      targetEl.classList.add('active-view');
      targetEl.style.display = 'block';
    }

    // Refresh views if needed
    if (viewName === 'dashboard') {
      window.location.hash = '#dashboard';
      updateDashboard();
      window.PapersManager.renderDashboardRecent();
    } else if (viewName === 'papers') {
      window.location.hash = '#papers';
      window.PapersManager.renderMyPapers();
    } else if (viewName === 'data') {
      window.location.hash = '#data';
      updateDataManagementStats();
    } else if (viewName === 'notes') {
      const paperId = window.NotesManager ? window.NotesManager.getCurrentPaperId() : null;
      if (paperId) {
        window.location.hash = `#notes?id=${paperId}`;
      }
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Reads URL hash and navigates accordingly.
   */
  async function handleHashChange() {
    const hash = window.location.hash || '#dashboard';

    if (hash.startsWith('#notes')) {
      const match = hash.match(/id=([^&]+)/);
      if (match && match[1]) {
        const paperId = match[1];
        if (window.NotesManager.getCurrentPaperId() !== paperId) {
          await window.NotesManager.openNoteView(paperId);
        }
        return;
      }
    }

    if (hash === '#papers') {
      navigateTo('papers', { skipUnsavedCheck: true });
    } else if (hash === '#data') {
      navigateTo('data', { skipUnsavedCheck: true });
    } else {
      navigateTo('dashboard', { skipUnsavedCheck: true });
    }
  }

  /**
   * Updates dashboard metrics.
   */
  async function updateDashboard() {
    try {
      const stats = await window.ResearchMateDB.getDashboardStats();

      const totalCountEl = document.getElementById('statTotalPapers');
      const completedCountEl = document.getElementById('statCompletedNotes');
      const inProgressCountEl = document.getElementById('statInProgressNotes');
      const pdfCountEl = document.getElementById('statPdfCount');

      if (totalCountEl) totalCountEl.textContent = stats.totalPapers;
      if (completedCountEl) completedCountEl.textContent = stats.completedNotes;
      if (inProgressCountEl) inProgressCountEl.textContent = stats.inProgressNotes;
      if (pdfCountEl) pdfCountEl.textContent = stats.pdfCount || 0;
    } catch (err) {
      console.error('Failed to update dashboard stats:', err);
    }
  }

  /* ========================================================================
     Data Management Features (V1.1)
     ======================================================================== */

  async function updateDataManagementStats() {
    try {
      const stats = await window.ResearchMateDB.getDashboardStats();
      const summaryEl = document.getElementById('dataBackupStatsSummary');
      if (summaryEl) {
        const imgs = stats.imageCount || 0;
        summaryEl.textContent = `${stats.totalPapers} Paper${stats.totalPapers === 1 ? '' : 's'} • ${stats.pdfCount || 0} Original PDF${(stats.pdfCount || 0) === 1 ? '' : 's'} • ${imgs} Embedded Image${imgs === 1 ? '' : 's'}`;
      }
    } catch (err) {
      console.warn('Failed to update data management stats:', err);
    }
  }

  function setupDataManagement() {
    // 1. Export Full Backup (ZIP)
    const exportZipBtn = document.getElementById('exportFullZipBtn');
    if (exportZipBtn) {
      exportZipBtn.addEventListener('click', handleExportFullBackupZip);
    }

    // 2. Export Notes Only (JSON)
    const exportNotesBtn = document.getElementById('exportNotesJsonBtn');
    if (exportNotesBtn) {
      exportNotesBtn.addEventListener('click', handleExportNotesOnlyJson);
    }

    // 3. Restore ZIP File Picker & Dropzone
    const restoreInput = document.getElementById('restoreZipFileInput');
    const restoreDropzone = document.getElementById('restoreZipDropzone');

    if (restoreDropzone && restoreInput) {
      restoreDropzone.addEventListener('click', () => restoreInput.click());

      ['dragenter', 'dragover'].forEach(name => {
        restoreDropzone.addEventListener(name, e => {
          e.preventDefault();
          e.stopPropagation();
          restoreDropzone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        restoreDropzone.addEventListener(name, e => {
          e.preventDefault();
          e.stopPropagation();
          restoreDropzone.classList.remove('drag-active');
        });
      });

      restoreDropzone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          handleRestoreFileSelected(files[0]);
        }
      });

      restoreInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
          handleRestoreFileSelected(e.target.files[0]);
        }
      });
    }

    // Clear staged backup button
    const clearStagedBtn = document.getElementById('clearStagedBackupBtn');
    if (clearStagedBtn) {
      clearStagedBtn.addEventListener('click', () => clearStagedBackup());
    }

    // Execute Restore Button
    const executeRestoreBtn = document.getElementById('executeRestoreBtn');
    if (executeRestoreBtn) {
      executeRestoreBtn.addEventListener('click', handleExecuteRestore);
    }

    // Replace Warning Modal Confirm Button
    const confirmReplaceBtn = document.getElementById('confirmReplaceRestoreBtn');
    if (confirmReplaceBtn) {
      confirmReplaceBtn.addEventListener('click', () => {
        closeAllModals();
        performRestoreExecution('replace');
      });
    }
  }

  /**
   * Action 1: Export Complete Full Backup (ZIP)
   */
  async function handleExportFullBackupZip() {
    const btn = document.getElementById('exportFullZipBtn');
    const progressEl = document.getElementById('exportZipProgress');
    const origHtml = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
          <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          Exporting Backup ZIP...
        `;
      }
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.textContent = 'Preparing backup archive...';
      }

      showToast('Generating complete ZIP backup...', 'info');

      const result = await window.ResearchMateDB.exportFullBackupZip((pct, msg) => {
        if (progressEl) progressEl.textContent = msg;
      });

      // Trigger browser download
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 60000);

      showToast(`Backup exported: ${result.summary.totalPapers} papers, ${result.summary.totalPdfs} PDFs, ${result.summary.totalImages || 0} images.`, 'success', 5000);
      if (progressEl) {
        progressEl.textContent = '✓ Full backup package downloaded successfully.';
      }
    } catch (err) {
      console.error('Failed to export ZIP backup:', err);
      showToast('Failed to generate ZIP backup: ' + err.message, 'error', 5000);
      if (progressEl) {
        progressEl.textContent = 'Export failed: ' + err.message;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  }

  /**
   * Action 2: Export Notes Only (JSON)
   */
  async function handleExportNotesOnlyJson() {
    const btn = document.getElementById('exportNotesJsonBtn');
    const origHtml = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Exporting Notes...';
      }

      const { jsonString, filename } = await window.ResearchMateDB.exportNotesOnlyJson();
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('Notes-only JSON backup exported successfully!', 'success');
    } catch (err) {
      console.error('Failed to export notes JSON:', err);
      showToast('Failed to export notes: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  }

  /**
   * Action 3: Inspect & Validate selected ZIP backup file
   */
  async function handleRestoreFileSelected(file) {
    const errorEl = document.getElementById('restoreZipError');
    const previewBox = document.getElementById('restoreZipPreviewBox');
    const dropzone = document.getElementById('restoreZipDropzone');

    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    if (!file.name.toLowerCase().endsWith('.zip')) {
      showError(errorEl, 'Please select a valid ResearchMate .zip backup file.');
      return;
    }

    try {
      showToast('Validating backup archive...', 'info');
      const validated = await window.ResearchMateDB.inspectAndValidateZipBackup(file);
      stagedZipBackup = validated;

      // Populate preview details
      if (dropzone) dropzone.style.display = 'none';
      if (previewBox) previewBox.style.display = 'block';

      const fileNameEl = document.getElementById('restoreBackupFileName');
      const metaSummaryEl = document.getElementById('restoreBackupMetaSummary');
      const dateEl = document.getElementById('restoreBackupDate');
      const conflictsWarning = document.getElementById('restoreConflictsWarning');
      const conflictsList = document.getElementById('restoreConflictsList');

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (metaSummaryEl) {
        const imgsN = validated.imageCount || 0;
        metaSummaryEl.textContent = `${validated.papers.length} Papers • ${validated.notes.length} Review Notes • ${validated.pdfCount} Original PDFs • ${imgsN} Embedded Images`;
      }
      if (dateEl) {
        const d = new Date(validated.backupInfo.createdAt);
        dateEl.textContent = `Backup Date: ${d.toLocaleString()} (Format v${validated.backupInfo.backupVersion})`;
      }

      // Show conflict details and per-paper Merge resolution selector + integrity notices
      if (conflictsWarning && conflictsList) {
        const notices = [];
        if (validated.missingPdfs && validated.missingPdfs.length > 0) {
          notices.push(`<div class="conflict-warning-note">Notice: ${validated.missingPdfs.length} paper(s) marked with PDFs are missing binary files in <code>original-pdfs/</code> and will restore without PDF attachment.</div>`);
        }
        if (validated.missingImages && validated.missingImages.length > 0) {
          notices.push(`<div class="conflict-warning-note">Notice: ${validated.missingImages.length} embedded image reference(s) are missing binary files in <code>images/</code>.</div>`);
        }

        if ((validated.conflicts && validated.conflicts.length > 0) || notices.length > 0) {
          conflictsWarning.style.display = 'block';
          const conflictHtml = (validated.conflicts || []).map(c => `
            <div class="conflict-item">
              <div class="conflict-item-meta">
                <div><strong>${escapeHtml(c.backupTitle)}</strong></div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">
                  Existing: ${escapeHtml(c.existingTitle || c.id)} • Backup ID: <code>${escapeHtml(c.id)}</code>
                </div>
              </div>
              <div class="conflict-item-action">
                <label style="font-size: 0.75rem; color: var(--text-secondary);">Merge Action:</label>
                <select class="form-input form-input-compact conflict-resolution-select" data-conflict-id="${escapeHtml(c.id)}">
                  <option value="keep" selected>Keep Existing</option>
                  <option value="replace">Replace with Backup</option>
                </select>
              </div>
            </div>
          `).join('');
          conflictsList.innerHTML = notices.join('') + conflictHtml;
        } else {
          conflictsWarning.style.display = 'none';
          conflictsList.innerHTML = '';
        }
      }

      showToast('Backup archive validated successfully.', 'success');
    } catch (err) {
      console.error('Backup validation error:', err);
      clearStagedBackup();
      showError(errorEl, err.message || 'Validation failed. The ZIP file is not a valid ResearchMate backup.');
    }
  }

  function clearStagedBackup() {
    stagedZipBackup = null;
    const restoreInput = document.getElementById('restoreZipFileInput');
    if (restoreInput) restoreInput.value = '';

    const dropzone = document.getElementById('restoreZipDropzone');
    const previewBox = document.getElementById('restoreZipPreviewBox');
    const errorEl = document.getElementById('restoreZipError');

    if (dropzone) dropzone.style.display = 'flex';
    if (previewBox) previewBox.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
  }

  function collectConflictResolutionSelections() {
    const map = {};
    document.querySelectorAll('.conflict-resolution-select').forEach(sel => {
      const id = sel.getAttribute('data-conflict-id');
      if (id) {
        map[id] = sel.value === 'replace' ? 'replace' : 'keep';
      }
    });
    return map;
  }

  /**
   * Triggers the restore execution with user mode selection.
   */
  async function handleExecuteRestore() {
    if (!stagedZipBackup) {
      showToast('Please select a valid backup ZIP first.', 'error');
      return;
    }

    const modeInput = document.querySelector('input[name="restoreMode"]:checked');
    const mode = modeInput ? modeInput.value : 'merge';

    if (mode === 'replace') {
      // Require explicit confirmation modal for destructive replace
      const modal = document.getElementById('replaceConfirmModal');
      const summaryEl = document.getElementById('replaceModalSummary');
      if (summaryEl) {
        const imgsN = stagedZipBackup.imageCount || 0;
        summaryEl.textContent = `Your current library will be erased and replaced with ${stagedZipBackup.papers.length} papers, ${stagedZipBackup.notes.length} literature review notes, ${stagedZipBackup.pdfCount} original PDFs, and ${imgsN} embedded images.`;
      }
      if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
      }
    } else {
      // Merge mode proceeds with selected per-conflict resolution choices
      const resolutionMap = collectConflictResolutionSelections();
      await performRestoreExecution('merge', resolutionMap);
    }
  }

  /**
   * Executes database restore transaction and updates UI.
   */
  async function performRestoreExecution(mode, conflictResolution = {}) {
    if (!stagedZipBackup) return;

    const executeBtn = document.getElementById('executeRestoreBtn');
    const progressEl = document.getElementById('restoreProgressStatus');
    const origHtml = executeBtn ? executeBtn.innerHTML : '';

    try {
      if (executeBtn) {
        executeBtn.disabled = true;
        executeBtn.textContent = 'Restoring Library...';
      }
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.textContent = 'Restoring database records...';
      }

      const result = await window.ResearchMateDB.restoreZipBackup(
        stagedZipBackup,
        mode,
        conflictResolution,
        (pct, msg) => {
          if (progressEl) progressEl.textContent = msg;
        }
      );

      clearStagedBackup();

      showToast(
        `Restore complete! ${result.restoredPapers} papers, ${result.restoredNotes} notes, ${result.restoredPdfs} PDFs, and ${result.restoredImages || 0} images imported.`,
        'success',
        5000
      );

      // Refresh application data
      await window.PapersManager.loadPapers();
      await updateDashboard();
      await updateDataManagementStats();

      // Navigate to My Papers
      setTimeout(() => {
        navigateTo('papers');
      }, 1000);
    } catch (err) {
      console.error('Failed to restore backup:', err);
      showToast('Restore failed: ' + err.message, 'error', 6000);
      if (progressEl) {
        progressEl.textContent = 'Error: ' + err.message;
      }
    } finally {
      if (executeBtn) {
        executeBtn.disabled = false;
        executeBtn.innerHTML = origHtml;
      }
    }
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = '';
  }

  /**
   * Displays an accessible, non-intrusive toast alert.
   */
  function showToast(message, type = 'info', durationMs = 3500) {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }

    toastContainer.className = `toast-container toast-${type} active`;
    toastContainer.innerHTML = `
      <div class="toast-inner">
        <span class="toast-icon" aria-hidden="true">${getToastIcon(type)}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
      </div>
    `;

    toastTimeout = setTimeout(() => {
      toastContainer.classList.remove('active');
    }, durationMs);
  }

  function getToastIcon(type) {
    switch (type) {
      case 'success':
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      case 'error':
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
      default:
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }
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

  // Expose App API
  window.App = {
    navigateTo,
    updateDashboard,
    updateDataManagementStats,
    showToast,
    getCurrentView: () => currentView
  };

  // Run when document is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
