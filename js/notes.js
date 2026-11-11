/**
 * notes.js - Literature Review Note-Taking System for ResearchMate
 * Handles the 10 core research analysis sections, auto-resizing textareas,
 * unsaved changes detection, saving to IndexedDB, reading view, and PDF trigger.
 */

(function () {
  'use strict';

  let currentPaperId = null;
  let currentPaper = null;
  let currentNotes = null;
  let originalFormValues = {};
  let hasUnsavedChanges = false;
  let isViewMode = false; // true = read-only preview; false = note editor

  const SECTIONS = window.PDFExporter ? window.PDFExporter.SECTIONS : [
    { id: 'researchProblem', num: '01', title: 'Research Problem', guiding: 'What problem are the researchers trying to solve?' },
    { id: 'researchObjective', num: '02', title: 'Research Objective', guiding: 'What is the main objective or goal of this research?' },
    { id: 'dataset', num: '03', title: 'Dataset', guiding: 'Dataset name, size, source, characteristics, and important data notes.' },
    { id: 'methodology', num: '04', title: 'Methodology / Proposed Method', guiding: 'Proposed methodology, algorithms or models used, main approach, and implementation details.' },
    { id: 'evaluationProtocol', num: '05', title: 'Evaluation Protocol', guiding: 'Train/test split, validation strategy, cross-validation, experimental setup, baseline comparison.' },
    { id: 'evaluationMetrics', num: '06', title: 'Evaluation Metrics', guiding: 'Accuracy, Precision, Recall, F1-score, RMSE, MAE, or other relevant metrics.' },
    { id: 'keyFindings', num: '07', title: 'Key Findings', guiding: 'Main experimental results, important discoveries, contributions, and observations.' },
    { id: 'limitations', num: '08', title: 'Limitations', guiding: 'Weaknesses of proposed approach, dataset/experimental limitations, unresolved problems.' },
    { id: 'futureWork', num: '09', title: 'Future Work', guiding: 'Future research directions suggested by the authors.' },
    { id: 'criticalAnalysis', num: '10', title: 'My Critical Analysis & Research Opportunities', guiding: 'Personal understanding, learnings, potential improvements, criticisms, research gaps, and ideas.' }
  ];

  function init() {
    setupEventListeners();
  }

  function setupEventListeners() {
    // Save Notes button
    const saveBtn = document.getElementById('saveNotesBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSaveNotes);
    }

    // Download PDF from Notes View
    const pdfBtn = document.getElementById('notesDownloadPdfBtn');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => {
        if (currentPaperId && currentPaper) {
          window.PapersManager.triggerPdfDownload(currentPaperId, pdfBtn);
        }
      });
    }

    // Toggle view/edit mode
    const toggleModeBtn = document.getElementById('toggleNotesModeBtn');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', () => {
        setMode(!isViewMode);
      });
    }

    // Back to Papers button
    const backBtn = document.getElementById('notesBackToPapersBtn');
    if (backBtn) {
      backBtn.addEventListener('click', e => {
        e.preventDefault();
        attemptNavigation('papers');
      });
    }

    // Keyboard shortcut: Ctrl+S / Cmd+S to save
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        const notesSection = document.getElementById('notesSection');
        if (notesSection && notesSection.classList.contains('active-view')) {
          e.preventDefault();
          handleSaveNotes();
        }
      }
    });

    // Browser close / reload safety warning
    window.addEventListener('beforeunload', e => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved literature review notes. Are you sure you want to leave?';
        return e.returnValue;
      }
    });
  }

  /**
   * Prompts user before leaving if unsaved changes exist.
   */
  function attemptNavigation(targetView) {
    if (hasUnsavedChanges) {
      const confirmLeave = window.confirm('You have unsaved note changes. Do you want to discard your changes and leave?');
      if (!confirmLeave) return false;
      hasUnsavedChanges = false;
    }
    window.App.navigateTo(targetView);
    return true;
  }

  /**
   * Opens Note Editor for a given paper.
   */
  async function openNoteEditor(paperId) {
    if (hasUnsavedChanges && currentPaperId !== paperId) {
      const confirmSwitch = window.confirm('You have unsaved changes in your current note. Discard changes and open this paper?');
      if (!confirmSwitch) return;
      hasUnsavedChanges = false;
    }

    isViewMode = false;
    await loadAndDisplayPaperNotes(paperId);
    window.App.navigateTo('notes', { skipUnsavedCheck: true });
    updateModeDisplay();
  }

  /**
   * Opens Read-only Preview for a given paper.
   */
  async function openNoteView(paperId) {
    if (hasUnsavedChanges && currentPaperId !== paperId) {
      const confirmSwitch = window.confirm('You have unsaved changes in your current note. Discard changes and view this paper?');
      if (!confirmSwitch) return;
      hasUnsavedChanges = false;
    }

    isViewMode = true;
    await loadAndDisplayPaperNotes(paperId);
    window.App.navigateTo('notes', { skipUnsavedCheck: true });
    updateModeDisplay();
  }

  /**
   * Loads paper and note records from DB and populates UI.
   */
  async function loadAndDisplayPaperNotes(paperId) {
    try {
      currentPaperId = paperId;
      const [paper, notes] = await Promise.all([
        window.ResearchMateDB.getPaperById(paperId),
        window.ResearchMateDB.getNotesByPaperId(paperId)
      ]);

      if (!paper) {
        window.App.showToast('Paper not found.', 'error');
        window.App.navigateTo('papers');
        return;
      }

      currentPaper = paper;
      currentNotes = notes || {};

      // 1. Render Fixed Paper Information Card
      renderPaperInfoCard(paper);

      // 2. Populate 10 Notes Textareas & Section Jump TOC
      renderNoteSections(currentNotes);

      // 3. Render Read-Only View Elements
      renderReadOnlyView(paper, currentNotes);

      // 4. Reset Unsaved State Tracking
      recordOriginalValues();
      updateSaveStatus(false, currentNotes.updatedAt);
      updateCompletionBadge();

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error('Failed to load paper notes:', err);
      window.App.showToast('Failed to load notes.', 'error');
    }
  }

  /**
   * Renders the immutable paper information banner.
   */
  function renderPaperInfoCard(paper) {
    const titleEl = document.getElementById('notesPaperTitle');
    const authorsEl = document.getElementById('notesPaperAuthors');
    const yearEl = document.getElementById('notesPaperYear');
    const doiWrap = document.getElementById('notesPaperDoiWrap');
    const doiLink = document.getElementById('notesPaperDoiLink');
    const createdEl = document.getElementById('notesPaperCreated');

    if (titleEl) titleEl.textContent = paper.title;
    if (authorsEl) authorsEl.textContent = paper.authors;
    if (yearEl) {
      yearEl.textContent = paper.year ? `Year: ${paper.year}` : 'Year: Not specified';
    }

    if (doiWrap && doiLink) {
      if (paper.doiUrl) {
        doiWrap.style.display = 'inline-flex';
        doiLink.href = paper.doiUrl;
        doiLink.textContent = paper.doiUrl;
      } else {
        doiWrap.style.display = 'none';
      }
    }

    if (createdEl) {
      try {
        const d = new Date(paper.createdAt);
        createdEl.textContent = `Added ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      } catch {
        createdEl.textContent = '';
      }
    }
  }

  /**
   * Renders the 10 note input sections and table of contents pills.
   */
  function renderNoteSections(notes) {
    const container = document.getElementById('notesEditorSectionsContainer');
    const tocContainer = document.getElementById('notesTocPills');
    if (!container) return;

    // Render Section Jump Pills
    if (tocContainer) {
      tocContainer.innerHTML = SECTIONS.map(
        sec => `
        <button type="button" class="toc-pill" data-target="section-${sec.id}">
          <span class="toc-pill-num">${sec.num}</span>
          <span class="toc-pill-title">${escapeHtml(sec.title)}</span>
        </button>
      `
      ).join('');

      tocContainer.querySelectorAll('.toc-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.getAttribute('data-target');
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const textarea = targetEl.querySelector('textarea');
            if (textarea) textarea.focus();
          }
        });
      });
    }

    // Render 10 Sections
    container.innerHTML = SECTIONS.map(sec => {
      const val = notes[sec.id] || '';
      const wordCount = countWords(val);

      return `
        <div class="note-section-card" id="section-${sec.id}">
          <div class="note-section-header">
            <div class="note-section-title-wrap">
              <span class="note-section-badge">${sec.num}</span>
              <div>
                <h3 class="note-section-title">${escapeHtml(sec.title)}</h3>
                <p class="note-section-guiding">${escapeHtml(sec.guiding)}</p>
              </div>
            </div>
            <span class="note-word-count" id="wc-${sec.id}">${wordCount} word${wordCount === 1 ? '' : 's'}</span>
          </div>

          <div class="note-textarea-wrapper">
            <textarea
              class="note-textarea"
              id="input-${sec.id}"
              data-section-id="${sec.id}"
              placeholder="Record your literature review notes for ${escapeHtml(sec.title)} here..."
              rows="4"
              spellcheck="true"
            >${escapeHtml(val)}</textarea>
          </div>
        </div>
      `;
    }).join('');

    // Attach input event listeners for auto-resize and unsaved detection
    container.querySelectorAll('.note-textarea').forEach(textarea => {
      autoResizeTextarea(textarea);

      textarea.addEventListener('input', () => {
        autoResizeTextarea(textarea);
        const secId = textarea.getAttribute('data-section-id');
        const wcEl = document.getElementById(`wc-${secId}`);
        if (wcEl) {
          const wc = countWords(textarea.value);
          wcEl.textContent = `${wc} word${wc === 1 ? '' : 's'}`;
        }
        checkUnsavedChanges();
        updateCompletionBadge();
      });
    });
  }

  /**
   * Automatically expands textarea to fit content without internal scrollbars.
   */
  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 110) + 'px';
  }

  /**
   * Helper to count words in string.
   */
  function countWords(str) {
    if (!str || !str.trim()) return 0;
    return str.trim().split(/\s+/).length;
  }

  /**
   * Records initial values of textareas to track edits.
   */
  function recordOriginalValues() {
    originalFormValues = {};
    SECTIONS.forEach(sec => {
      const el = document.getElementById(`input-${sec.id}`);
      originalFormValues[sec.id] = el ? el.value : '';
    });
    hasUnsavedChanges = false;
  }

  /**
   * Checks if current form content differs from saved record.
   */
  function checkUnsavedChanges() {
    let changed = false;
    for (const sec of SECTIONS) {
      const el = document.getElementById(`input-${sec.id}`);
      const currentVal = el ? el.value : '';
      if (currentVal !== (originalFormValues[sec.id] || '')) {
        changed = true;
        break;
      }
    }
    hasUnsavedChanges = changed;
    updateSaveStatus(changed);
  }

  /**
   * Updates save button state and status indicator.
   */
  function updateSaveStatus(isUnsaved, timestamp) {
    const statusDot = document.getElementById('notesSaveStatusDot');
    const statusText = document.getElementById('notesSaveStatusText');
    const saveBtn = document.getElementById('saveNotesBtn');

    if (isUnsaved) {
      if (statusDot) statusDot.className = 'status-dot dot-unsaved';
      if (statusText) statusText.textContent = 'Unsaved changes';
      if (saveBtn) {
        saveBtn.classList.remove('btn-secondary');
        saveBtn.classList.add('btn-primary');
      }
    } else {
      if (statusDot) statusDot.className = 'status-dot dot-saved';
      const timeStr = timestamp ? formatTime(timestamp) : 'Saved';
      if (statusText) statusText.textContent = `All changes saved (${timeStr})`;
      if (saveBtn) {
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-secondary');
      }
    }
  }

  function formatTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Saved';
    }
  }

  /**
   * Updates progress pill in the top bar.
   */
  function updateCompletionBadge() {
    const badge = document.getElementById('notesCompletionBadge');
    if (!badge) return;

    let completed = 0;
    SECTIONS.forEach(sec => {
      const el = document.getElementById(`input-${sec.id}`);
      if (el && el.value.trim().length > 0) {
        completed++;
      }
    });

    badge.textContent = `${completed}/10 Sections Completed`;
    if (completed === 10) {
      badge.className = 'badge status-complete';
    } else if (completed > 0) {
      badge.className = 'badge status-in-progress';
    } else {
      badge.className = 'badge status-not-started';
    }
  }

  /**
   * Saves notes to IndexedDB.
   */
  async function handleSaveNotes() {
    if (!currentPaperId) return;

    const saveBtn = document.getElementById('saveNotesBtn');
    const originalText = saveBtn ? saveBtn.innerHTML : 'Save Notes';

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `
          <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
          Saving...
        `;
      }

      const notesData = {
        paperId: currentPaperId
      };

      SECTIONS.forEach(sec => {
        const el = document.getElementById(`input-${sec.id}`);
        notesData[sec.id] = el ? el.value : '';
      });

      const updated = await window.ResearchMateDB.saveNotes(notesData);
      currentNotes = updated;

      recordOriginalValues();
      updateSaveStatus(false, updated.updatedAt);
      renderReadOnlyView(currentPaper, updated);

      window.App.showToast('Notes saved successfully!', 'success');

      // Refresh paper completion counts in background
      await window.PapersManager.loadPapers();
      await window.App.updateDashboard();
    } catch (err) {
      console.error('Failed to save notes:', err);
      window.App.showToast('Failed to save notes. Please try again.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
      }
    }
  }

  /**
   * Sets mode: Edit vs Read-Only View.
   */
  function setMode(viewModeActive) {
    isViewMode = viewModeActive;
    updateModeDisplay();
  }

  function updateModeDisplay() {
    const editorWrap = document.getElementById('notesEditorWrapper');
    const readWrap = document.getElementById('notesReadOnlyWrapper');
    const toggleBtn = document.getElementById('toggleNotesModeBtn');
    const saveBtn = document.getElementById('saveNotesBtn');

    if (isViewMode) {
      if (editorWrap) editorWrap.style.display = 'none';
      if (readWrap) {
        readWrap.style.display = 'block';
        if (currentPaper && currentNotes) {
          renderReadOnlyView(currentPaper, currentNotes);
        }
      }
      if (saveBtn) saveBtn.style.display = 'none';
      if (toggleBtn) {
        toggleBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          Edit Notes
        `;
        toggleBtn.title = 'Switch to Note Editor';
      }
    } else {
      if (editorWrap) editorWrap.style.display = 'block';
      if (readWrap) readWrap.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'inline-flex';
      if (toggleBtn) {
        toggleBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          Preview Notes
        `;
        toggleBtn.title = 'Switch to Read-Only Preview';
      }
      // Re-trigger auto-heights for all textareas
      document.querySelectorAll('.note-textarea').forEach(autoResizeTextarea);
    }
  }

  /**
   * Renders the formatted academic read-only view.
   */
  function renderReadOnlyView(paper, notes) {
    const container = document.getElementById('notesReadOnlyContent');
    if (!container) return;

    let html = '';
    SECTIONS.forEach(sec => {
      const text = (notes[sec.id] || '').trim();
      const hasContent = text.length > 0;

      html += `
        <div class="readonly-section-card ${hasContent ? 'has-notes' : 'empty-notes'}">
          <div class="readonly-section-header">
            <span class="readonly-section-badge">${sec.num}</span>
            <div>
              <h3 class="readonly-section-title">${escapeHtml(sec.title)}</h3>
              <p class="readonly-section-guiding">${escapeHtml(sec.guiding)}</p>
            </div>
          </div>
          <div class="readonly-section-body">
            ${
              hasContent
                ? formatParagraphs(text)
                : '<p class="readonly-empty-text"><em>No notes recorded for this section.</em></p>'
            }
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function formatParagraphs(text) {
    const escaped = escapeHtml(text);
    return escaped
      .split(/\n\s*\n/)
      .map(p => `<p class="formatted-p">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
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
  window.NotesManager = {
    init,
    openNoteEditor,
    openNoteView,
    handleSaveNotes,
    attemptNavigation,
    hasUnsavedChanges: () => hasUnsavedChanges,
    getCurrentPaperId: () => currentPaperId,
    getCurrentPaper: () => currentPaper,
    getCurrentNotes: () => currentNotes
  };
})();

