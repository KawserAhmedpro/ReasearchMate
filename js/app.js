/**
 * app.js - Main Application Coordinator for ResearchMate
 * Manages view routing, navigation, dashboard statistics, and toast feedback.
 */

(function () {
  'use strict';

  let currentView = 'dashboard';
  let toastTimeout = null;

  /**
   * Initializes application on DOMContentLoaded.
   */
  async function init() {
    try {
      // 1. Initialize IndexedDB
      await window.ResearchMateDB.initDB();

      // 2. Setup modules
      if (window.PapersManager) window.PapersManager.init();
      if (window.NotesManager) window.NotesManager.init();

      // 3. Setup Navigation & Routing
      setupNavigation();

      // 4. Initial Data Load
      await window.PapersManager.loadPapers();
      await updateDashboard();

      // 5. Handle Initial Route from URL Hash
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
        navigateTo(targetView);
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

      if (totalCountEl) totalCountEl.textContent = stats.totalPapers;
      if (completedCountEl) completedCountEl.textContent = stats.completedNotes;
      if (inProgressCountEl) inProgressCountEl.textContent = stats.inProgressNotes;
    } catch (err) {
      console.error('Failed to update dashboard stats:', err);
    }
  }

  /**
   * Displays an accessible, non-intrusive toast alert.
   * @param {string} message
   * @param {'info'|'success'|'error'} type
   * @param {number} durationMs
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

