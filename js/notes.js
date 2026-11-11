/**
 * notes.js - Literature Review Note-Taking System for ResearchMate (V1.2)
 * Manages the 10 immutable research analysis sections using unified rich-content
 * editors (RichEditorManager), debounced IndexedDB autosave with save states,
 * safe navigation/upload awaiting, formatted read-only preview, and PDF export trigger.
 */

(function () {
  'use strict';

  const AUTOSAVE_DELAY_MS = 1200;

  let currentPaperId = null;
  let currentPaper = null;
  let currentNotes = null;
  let originalSerializedSections = {};
  let sectionEditors = {}; // sectionId -> editor handle from RichEditorManager
  let hasUnsavedChanges = false;
  let isViewMode = false; // true = read-only preview; false = note editor

  let autosaveTimer = null;
  let saveInFlightPromise = null;
  let resaveNeeded = false;

  const SECTIONS = (window.PDFExporter && window.PDFExporter.SECTIONS) ? window.PDFExporter.SECTIONS : [
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
    // Save Notes button (manual immediate save)
    const saveBtn = document.getElementById('saveNotesBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => handleSaveNotes({ silent: false }));
    }

    // Download PDF from Notes View — flush any pending edits/uploads first
    const pdfBtn = document.getElementById('notesDownloadPdfBtn');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', async () => {
        if (!currentPaperId || !currentPaper) return;
        await flushSave();
        window.PapersManager.triggerPdfDownload(currentPaperId, pdfBtn);
      });
    }

    // Toggle view/edit mode
    const toggleModeBtn = document.getElementById('toggleNotesModeBtn');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', async () => {
        if (!isViewMode) {
          await flushSave();
        }
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

    // Keyboard shortcut: Ctrl+S / Cmd+S to save immediately
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        const notesSection = document.getElementById('notesSection');
        if (notesSection && notesSection.classList.contains('active-view')) {
          e.preventDefault();
          handleSaveNotes({ silent: false });
        }
      }
    });

    // Browser close / reload safety + Blob URL cleanup
    window.addEventListener('beforeunload', e => {
      const pendingUploads = window.RichEditorManager ? window.RichEditorManager.getPendingUploadCount() : 0;
      if (hasUnsavedChanges || saveInFlightPromise || pendingUploads > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved literature review notes or pending uploads. Are you sure you want to leave?';
        return e.returnValue;
      }
      if (window.RichEditorManager) {
        window.RichEditorManager.revokeAllBlobUrls();
      }
    });
  }

  /**
   * Flushes any debounced autosave or pending image upload immediately before navigating/exporting.
   */
  async function flushSave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (window.RichEditorManager) {
      await window.RichEditorManager.waitForPendingUploads();
    }
    if (saveInFlightPromise) {
      await saveInFlightPromise;
    }
    if (currentPaperId && (hasUnsavedChanges || resaveNeeded)) {
      return await handleSaveNotes({ silent: true });
    }
    return true;
  }

  /**
   * Attempts safe navigation away from the notes workspace.
   */
  async function attemptNavigation(targetView) {
    if (!currentPaperId) {
      window.App.navigateTo(targetView);
      return true;
    }

    const savedPaperId = currentPaperId;
    if (hasUnsavedChanges || autosaveTimer || saveInFlightPromise || (window.RichEditorManager && window.RichEditorManager.getPendingUploadCount() > 0)) {
      const ok = await flushSave();
      if (!ok && hasUnsavedChanges) {
        const confirmLeave = window.confirm('Latest changes could not be saved automatically. Do you want to discard unsaved changes and leave?');
        if (!confirmLeave) return false;
        hasUnsavedChanges = false;
      }
    }

    // Safe post-navigation orphan image cleanup once session ends (keeps Undo/Redo working during session)
    if (window.ResearchMateDB && typeof window.ResearchMateDB.cleanupOrphanedImagesForPaper === 'function') {
      window.ResearchMateDB.cleanupOrphanedImagesForPaper(savedPaperId).catch(() => {});
    }
    if (window.RichEditorManager) {
      window.RichEditorManager.revokeAllBlobUrls();
      window.RichEditorManager.clearSectionEditors();
    }
    sectionEditors = {};
    currentPaperId = null;

    window.App.navigateTo(targetView, { skipUnsavedCheck: true });
    return true;
  }

  /**
   * Opens Note Editor for a given paper.
   */
  async function openNoteEditor(paperId) {
    if (currentPaperId && currentPaperId !== paperId) {
      await flushSave();
      if (hasUnsavedChanges) {
        const confirmSwitch = window.confirm('Latest changes could not be saved. Discard changes and open this paper?');
        if (!confirmSwitch) return;
        hasUnsavedChanges = false;
      }
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
    if (currentPaperId && currentPaperId !== paperId) {
      await flushSave();
      if (hasUnsavedChanges) {
        const confirmSwitch = window.confirm('Latest changes could not be saved. Discard changes and view this paper?');
        if (!confirmSwitch) return;
        hasUnsavedChanges = false;
      }
    }

    isViewMode = true;
    await loadAndDisplayPaperNotes(paperId);
    window.App.navigateTo('notes', { skipUnsavedCheck: true });
    updateModeDisplay();
  }

  /**
   * Loads paper and note records from DB and populates rich editors & preview.
   */
  async function loadAndDisplayPaperNotes(paperId) {
    try {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      if (window.RichEditorManager) {
        window.RichEditorManager.revokeAllBlobUrls();
        window.RichEditorManager.clearSectionEditors();
      }
      sectionEditors = {};

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
      currentNotes = notes ? window.ResearchMateDB.normalizeNoteRecord(notes) : {};

      // 1. Render Fixed Paper Information Card
      renderPaperInfoCard(paper);

      // 2. Mount 10 Rich Content Section Editors & Section Jump TOC
      renderNoteSections(currentNotes);

      // 3. Render Read-Only Preview View
      renderReadOnlyView(paper, currentNotes);

      // 4. Reset Unsaved State Tracking
      recordOriginalValues();
      updateSaveStatus('saved', currentNotes.updatedAt);
      updateCompletionBadge();

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
    if (createdEl && paper.createdAt) {
      createdEl.textContent = `Added ${new Date(paper.createdAt).toLocaleDateString()}`;
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

    // Render Original PDF action button if paper has an uploaded PDF
    const pdfWrap = document.getElementById('notesPaperPdfWrap');
    const pdfBtn = document.getElementById('notesViewOriginalPdfBtn');
    if (pdfWrap && pdfBtn) {
      if (paper.hasPdf) {
        pdfWrap.style.display = 'inline-flex';
        const sizeStr = paper.pdfFileSize ? ` (${formatBytes(paper.pdfFileSize)})` : '';
        pdfBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          View Original PDF${sizeStr} ↗
        `;
        pdfBtn.onclick = () => window.PapersManager.viewOriginalPdf(paper.id, pdfBtn);
      } else {
        pdfWrap.style.display = 'none';
      }
    }
  }

  /**
   * Renders the 10 unified rich-content section cards and table of contents pills.
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
            const secId = targetId.replace(/^section-/, '');
            if (sectionEditors[secId]) {
              sectionEditors[secId].focus();
            }
          }
        });
      });
    }

    // Build 10 Section Containers cleanly without rebuilding per keystroke
    container.innerHTML = SECTIONS.map(sec => {
      const val = notes[sec.id];
      const wordCount = countWords(val);

      return `
        <div class="note-section-card" id="section-${sec.id}" data-section-id="${sec.id}">
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

          <div class="note-rich-editor-host" id="rich-host-${sec.id}" data-section-id="${sec.id}"></div>
        </div>
      `;
    }).join('');

    // Initialize independent unified rich editors inside each section host
    sectionEditors = {};
    SECTIONS.forEach(sec => {
      const hostEl = document.getElementById(`rich-host-${sec.id}`);
      if (!hostEl || !window.RichEditorManager) return;

      const editorHandle = window.RichEditorManager.createSectionEditor({
        sectionId: sec.id,
        paperId: currentPaperId,
        getPaperId: () => currentPaperId,
        hostEl,
        initialContent: notes[sec.id],
        placeholder: `Write structured notes, paste diagrams, add tables or equations for ${sec.title}...`,
        onChange: () => handleSectionEdited(sec.id)
      });

      sectionEditors[sec.id] = editorHandle;
    });
  }

  function handleSectionEdited(secId) {
    const editor = sectionEditors[secId];
    if (editor) {
      const wcEl = document.getElementById(`wc-${secId}`);
      if (wcEl) {
        const wc = countWords(editor.getContent());
        wcEl.textContent = `${wc} word${wc === 1 ? '' : 's'}`;
      }
    }
    checkUnsavedChanges();
    updateCompletionBadge();
    scheduleAutosave();
  }

  function scheduleAutosave() {
    if (!currentPaperId) return;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    if (saveInFlightPromise) {
      resaveNeeded = true;
    }
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      handleSaveNotes({ silent: true });
    }, AUTOSAVE_DELAY_MS);
  }

  /**
   * Helper to count words in a plain-text or structured section object.
   */
  function countWords(sectionVal) {
    const text = window.ResearchMateDB && typeof window.ResearchMateDB.extractSectionPlainText === 'function'
      ? window.ResearchMateDB.extractSectionPlainText(sectionVal)
      : String(sectionVal || '');
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  function collectAllSectionsData() {
    const data = {};
    SECTIONS.forEach(sec => {
      const editor = sectionEditors[sec.id];
      data[sec.id] = editor
        ? editor.getContent()
        : (currentNotes && currentNotes[sec.id] ? currentNotes[sec.id] : window.ResearchMateDB.normalizeSectionContent(''));
    });
    return data;
  }

  /**
   * Records initial serialized section snapshots to track edits accurately.
   */
  function recordOriginalValues() {
    originalSerializedSections = {};
    SECTIONS.forEach(sec => {
      const editor = sectionEditors[sec.id];
      const content = editor
        ? editor.getContent()
        : window.ResearchMateDB.normalizeSectionContent(currentNotes ? currentNotes[sec.id] : '');
      originalSerializedSections[sec.id] = JSON.stringify(content);
    });
    hasUnsavedChanges = false;
  }

  /**
   * Checks if current rich editor content differs from saved record.
   */
  function checkUnsavedChanges() {
    let changed = false;
    for (const sec of SECTIONS) {
      const editor = sectionEditors[sec.id];
      if (!editor) continue;
      const curJson = JSON.stringify(editor.getContent());
      if (curJson !== (originalSerializedSections[sec.id] || '')) {
        changed = true;
        break;
      }
    }
    hasUnsavedChanges = changed;
    if (changed) {
      updateSaveStatus('unsaved');
    }
  }

  /**
   * Updates save button and sticky status indicator ('saving' | 'saved' | 'unsaved' | 'error').
   */
  function updateSaveStatus(state, timestamp) {
    const statusDot = document.getElementById('notesSaveStatusDot');
    const statusText = document.getElementById('notesSaveStatusText');
    const saveBtn = document.getElementById('saveNotesBtn');

    if (state === 'saving') {
      if (statusDot) statusDot.className = 'status-dot dot-saving';
      if (statusText) statusText.textContent = 'Saving...';
      return;
    }

    if (state === 'error') {
      if (statusDot) statusDot.className = 'status-dot dot-error';
      if (statusText) statusText.textContent = 'Save failed — press Ctrl+S to retry';
      if (saveBtn) {
        saveBtn.classList.remove('btn-secondary');
        saveBtn.classList.add('btn-primary');
      }
      return;
    }

    if (state === 'unsaved') {
      if (statusDot) statusDot.className = 'status-dot dot-unsaved';
      if (statusText) statusText.textContent = 'Unsaved changes (autosaving...)';
      if (saveBtn) {
        saveBtn.classList.remove('btn-secondary');
        saveBtn.classList.add('btn-primary');
      }
    } else {
      if (statusDot) statusDot.className = 'status-dot dot-saved';
      const timeStr = timestamp ? formatTime(timestamp) : 'Saved';
      if (statusText) statusText.textContent = `Saved (${timeStr})`;
      if (saveBtn) {
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-secondary');
      }
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
      const editor = sectionEditors[sec.id];
      const secVal = editor ? editor.getContent() : (currentNotes && currentNotes[sec.id]);
      if (window.ResearchMateDB && window.ResearchMateDB.isSectionNonEmpty(secVal)) {
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
   * Saves all 10 rich-content sections safely to IndexedDB.
   * Waits for any in-progress image Blob writes and coalesces overlapping saves.
   */
  async function handleSaveNotes(options = {}) {
    const silent = Boolean(options && options.silent);
    if (!currentPaperId) return false;

    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }

    if (saveInFlightPromise) {
      resaveNeeded = true;
      return await saveInFlightPromise;
    }

    const saveBtn = document.getElementById('saveNotesBtn');
    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : 'Save Notes';

    const performSave = async () => {
      try {
        updateSaveStatus('saving');
        if (!silent && saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = `
            <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            Saving...
          `;
        }

        // Wait for any asynchronous image uploads before persisting imageId references
        if (window.RichEditorManager) {
          await window.RichEditorManager.waitForPendingUploads();
        }

        const collected = collectAllSectionsData();
        const notesData = {
          paperId: currentPaperId,
          createdAt: currentNotes ? currentNotes.createdAt : undefined,
          ...collected
        };

        const updated = await window.ResearchMateDB.saveNotes(notesData);
        currentNotes = updated;

        recordOriginalValues();
        updateSaveStatus('saved', updated.updatedAt);
        if (isViewMode) {
          renderReadOnlyView(currentPaper, updated);
        }

        if (!silent) {
          window.App.showToast('Notes saved successfully!', 'success');
        }

        // Refresh library & dashboard progress counts cleanly
        if (window.PapersManager) await window.PapersManager.loadPapers();
        if (window.App) await window.App.updateDashboard();
        return true;
      } catch (err) {
        console.error('Failed to save notes:', err);
        updateSaveStatus('error');
        if (!silent && window.App) {
          window.App.showToast(err.message || 'Failed to save notes. Please try again.', 'error');
        }
        return false;
      } finally {
        if (!silent && saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalBtnHtml;
        }
      }
    };

    saveInFlightPromise = performSave();
    const ok = await saveInFlightPromise;
    saveInFlightPromise = null;

    if (resaveNeeded) {
      resaveNeeded = false;
      return await handleSaveNotes({ silent: true });
    }
    return ok;
  }

  /**
   * Sets mode: Edit vs Read-Only Preview.
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
        toggleBtn.title = 'Switch to Rich Note Editor';
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
        toggleBtn.title = 'Switch to Formatted Preview';
      }
    }
  }

  /**
   * Renders the formatted academic read-only view (rich text, images, tables, rendered KaTeX math).
   */
  function renderReadOnlyView(paper, notes) {
    const container = document.getElementById('notesReadOnlyContent');
    if (!container) return;

    let html = '';
    SECTIONS.forEach(sec => {
      const secVal = notes ? notes[sec.id] : null;
      const hasContent = window.ResearchMateDB && window.ResearchMateDB.isSectionNonEmpty(secVal);
      const renderedHtml = hasContent && window.RichEditorManager
        ? window.RichEditorManager.renderSectionDeltaToHtml(secVal)
        : '';

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
              hasContent && renderedHtml
                ? renderedHtml
                : '<p class="readonly-empty-text"><em>No notes recorded for this section.</em></p>'
            }
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Resolve embedded IndexedDB image references in Preview Mode
    if (window.RichEditorManager) {
      window.RichEditorManager.hydratePreviewImages(container);
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

  // Expose module
  window.NotesManager = {
    init,
    openNoteEditor,
    openNoteView,
    handleSaveNotes,
    flushSave,
    attemptNavigation,
    setMode,
    hasUnsavedChanges: () => hasUnsavedChanges,
    getCurrentPaperId: () => currentPaperId,
    getCurrentPaper: () => currentPaper,
    getCurrentNotes: () => currentNotes,
    getSectionEditor: (secId) => sectionEditors[secId] || null
  };
})();
