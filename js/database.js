/**
 * database.js - IndexedDB Persistent Storage for ResearchMate (V1.1)
 * Handles separate stores for:
 * - 'papers': immutable bibliographic metadata (and hasPdf flag)
 * - 'notes': editable 10-section literature review records
 * - 'pdfs': binary PDF Blobs for uploaded research papers
 * 
 * Includes Complete Backup (ZIP & JSON) and Restore with Merge / Replace modes.
 */

(function () {
  'use strict';

  const DB_NAME = 'ResearchMateDB';
  const DB_VERSION = 2; // Incremented for V1.1 (added 'pdfs' store)
  const STORE_PAPERS = 'papers';
  const STORE_NOTES = 'notes';
  const STORE_PDFS = 'pdfs';

  let dbInstance = null;

  /**
   * Initializes or upgrades the IndexedDB database.
   * Seamlessly migrates existing V1 databases without data loss.
   * @returns {Promise<IDBDatabase>}
   */
  function initDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) {
        return resolve(dbInstance);
      }

      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB is not supported in this browser. Please use a modern browser.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;

        // 1. Papers store: keyPath 'id'
        if (!db.objectStoreNames.contains(STORE_PAPERS)) {
          const papersStore = db.createObjectStore(STORE_PAPERS, { keyPath: 'id' });
          papersStore.createIndex('createdAt', 'createdAt', { unique: false });
          papersStore.createIndex('title', 'title', { unique: false });
          papersStore.createIndex('authors', 'authors', { unique: false });
        }

        // 2. Notes store: keyPath 'paperId'
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const notesStore = db.createObjectStore(STORE_NOTES, { keyPath: 'paperId' });
          notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 3. PDFs store: keyPath 'paperId' (V1.1 enhancement)
        if (!db.objectStoreNames.contains(STORE_PDFS)) {
          const pdfsStore = db.createObjectStore(STORE_PDFS, { keyPath: 'paperId' });
          pdfsStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
          pdfsStore.createIndex('fileName', 'fileName', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        dbInstance = event.target.result;

        dbInstance.onversionchange = function () {
          dbInstance.close();
          dbInstance = null;
          console.warn('Database version changed elsewhere. Closed connection.');
        };

        resolve(dbInstance);
      };

      request.onerror = function (event) {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = function () {
        console.warn('Database open request blocked by another tab.');
      };
    });
  }

  /**
   * Generates a safe unique identifier for paper records.
   */
  function generateId() {
    return 'paper_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Creates blank default note structure for a paper.
   */
  function createBlankNotes(paperId) {
    const now = new Date().toISOString();
    return {
      paperId: paperId,
      researchProblem: '',
      researchObjective: '',
      dataset: '',
      methodology: '',
      evaluationProtocol: '',
      evaluationMetrics: '',
      keyFindings: '',
      limitations: '',
      futureWork: '',
      criticalAnalysis: '',
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Add a new research paper (Optionally with an uploaded original PDF file).
   * Also creates a corresponding empty note record in the notes store.
   * Note: Paper bibliographic details and uploaded PDF are immutable after creation.
   * 
   * @param {Object} data { title, authors, year, doiUrl }
   * @param {File|Blob|null} [pdfFile=null] Original research paper PDF
   * @returns {Promise<Object>} The created paper object
   */
  async function addPaper(data, pdfFile = null) {
    const db = await initDB();

    const title = (data.title || '').trim();
    const authors = (data.authors || '').trim();
    const year = data.year ? parseInt(data.year, 10) : null;
    const doiUrl = (data.doiUrl || '').trim();

    if (!title) {
      throw new Error('Paper title is required.');
    }
    if (!authors) {
      throw new Error('Author(s) is required.');
    }

    const paperId = generateId();
    const now = new Date().toISOString();
    const hasPdf = Boolean(pdfFile);

    const paperRecord = {
      id: paperId,
      title: title,
      authors: authors,
      year: isNaN(year) ? null : year,
      doiUrl: doiUrl,
      hasPdf: hasPdf,
      pdfFileName: hasPdf && pdfFile.name ? pdfFile.name : null,
      pdfFileSize: hasPdf && pdfFile.size ? pdfFile.size : null,
      createdAt: now
    };

    const notesRecord = createBlankNotes(paperId);

    return new Promise((resolve, reject) => {
      const stores = hasPdf ? [STORE_PAPERS, STORE_NOTES, STORE_PDFS] : [STORE_PAPERS, STORE_NOTES];
      const transaction = db.transaction(stores, 'readwrite');

      transaction.oncomplete = function () {
        resolve(paperRecord);
      };

      transaction.onerror = function (event) {
        reject(event.target.error || new Error('Failed to save paper to database.'));
      };

      const papersStore = transaction.objectStore(STORE_PAPERS);
      const notesStore = transaction.objectStore(STORE_NOTES);

      papersStore.add(paperRecord);
      notesStore.add(notesRecord);

      if (hasPdf) {
        const pdfsStore = transaction.objectStore(STORE_PDFS);
        const pdfRecord = {
          paperId: paperId,
          fileBlob: pdfFile,
          fileName: pdfFile.name || `${title}.pdf`,
          fileSize: pdfFile.size,
          fileType: pdfFile.type || 'application/pdf',
          uploadedAt: now
        };
        pdfsStore.add(pdfRecord);
      }
    });
  }

  /**
   * Retrieve original research paper PDF record by paper ID.
   * @param {string} paperId
   * @returns {Promise<Object|null>} { paperId, fileBlob, fileName, fileSize, fileType, uploadedAt }
   */
  async function getPaperPdf(paperId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PDFS], 'readonly');
      const store = transaction.objectStore(STORE_PDFS);
      const request = store.get(paperId);

      request.onsuccess = function () {
        resolve(request.result || null);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieve all papers sorted by createdAt descending (most recent first).
   * @returns {Promise<Array<Object>>}
   */
  async function getAllPapers() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS], 'readonly');
      const store = transaction.objectStore(STORE_PAPERS);
      const request = store.getAll();

      request.onsuccess = function () {
        const papers = request.result || [];
        papers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(papers);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieve a single paper by its ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async function getPaperById(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS], 'readonly');
      const store = transaction.objectStore(STORE_PAPERS);
      const request = store.get(id);

      request.onsuccess = function () {
        resolve(request.result || null);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Delete a paper and its associated notes AND uploaded original PDF completely.
   * @param {string} paperId
   * @returns {Promise<boolean>}
   */
  async function deletePaper(paperId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS], 'readwrite');

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function (event) {
        reject(event.target.error || new Error('Failed to delete paper.'));
      };

      const papersStore = transaction.objectStore(STORE_PAPERS);
      const notesStore = transaction.objectStore(STORE_NOTES);
      const pdfsStore = transaction.objectStore(STORE_PDFS);

      papersStore.delete(paperId);
      notesStore.delete(paperId);
      pdfsStore.delete(paperId);
    });
  }

  /**
   * Retrieve literature review notes for a given paper.
   * If notes don't exist yet, creates and returns a blank record.
   * @param {string} paperId
   * @returns {Promise<Object>}
   */
  async function getNotesByPaperId(paperId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NOTES], 'readonly');
      const store = transaction.objectStore(STORE_NOTES);
      const request = store.get(paperId);

      request.onsuccess = function () {
        if (request.result) {
          resolve(request.result);
        } else {
          resolve(createBlankNotes(paperId));
        }
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Save or update literature review notes for a paper.
   * Only the 10 literature review sections and updatedAt are updated.
   * @param {Object} notesData
   * @returns {Promise<Object>}
   */
  async function saveNotes(notesData) {
    const db = await initDB();
    const paperId = notesData.paperId;
    if (!paperId) {
      throw new Error('paperId is required to save notes.');
    }

    const now = new Date().toISOString();
    const updatedRecord = {
      paperId: paperId,
      researchProblem: notesData.researchProblem || '',
      researchObjective: notesData.researchObjective || '',
      dataset: notesData.dataset || '',
      methodology: notesData.methodology || '',
      evaluationProtocol: notesData.evaluationProtocol || '',
      evaluationMetrics: notesData.evaluationMetrics || '',
      keyFindings: notesData.keyFindings || '',
      limitations: notesData.limitations || '',
      futureWork: notesData.futureWork || '',
      criticalAnalysis: notesData.criticalAnalysis || '',
      createdAt: notesData.createdAt || now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NOTES], 'readwrite');
      const store = transaction.objectStore(STORE_NOTES);
      const request = store.put(updatedRecord);

      request.onsuccess = function () {
        resolve(updatedRecord);
      };

      request.onerror = function (event) {
        reject(event.target.error || new Error('Failed to update notes in database.'));
      };
    });
  }

  /**
   * Calculate completion status of a notes record across the 10 sections.
   * @param {Object} notes
   * @returns {{ completedCount: number, totalSections: number, percentage: number, isComplete: boolean, isStarted: boolean }}
   */
  function calculateCompletion(notes) {
    const keys = [
      'researchProblem',
      'researchObjective',
      'dataset',
      'methodology',
      'evaluationProtocol',
      'evaluationMetrics',
      'keyFindings',
      'limitations',
      'futureWork',
      'criticalAnalysis'
    ];

    if (!notes) {
      return { completedCount: 0, totalSections: keys.length, percentage: 0, isComplete: false, isStarted: false };
    }

    let completed = 0;
    keys.forEach(k => {
      if (notes[k] && notes[k].trim().length > 0) {
        completed++;
      }
    });

    const percentage = Math.round((completed / keys.length) * 100);
    return {
      completedCount: completed,
      totalSections: keys.length,
      percentage: percentage,
      isComplete: completed === keys.length,
      isStarted: completed > 0
    };
  }

  /**
   * Get all papers combined with their notes completion stats.
   * @returns {Promise<Array<Object>>}
   */
  async function getAllPapersWithStats() {
    const [papers, db] = await Promise.all([getAllPapers(), initDB()]);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NOTES], 'readonly');
      const notesStore = transaction.objectStore(STORE_NOTES);
      const notesRequest = notesStore.getAll();

      notesRequest.onsuccess = function () {
        const notesList = notesRequest.result || [];
        const notesMap = new Map();
        notesList.forEach(n => notesMap.set(n.paperId, n));

        const enriched = papers.map(paper => {
          const notes = notesMap.get(paper.id) || null;
          const stats = calculateCompletion(notes);
          return {
            ...paper,
            notesUpdatedAt: notes ? notes.updatedAt : paper.createdAt,
            completion: stats
          };
        });

        resolve(enriched);
      };

      notesRequest.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Get overall application stats for the dashboard.
   */
  async function getDashboardStats() {
    const papersWithStats = await getAllPapersWithStats();
    const totalPapers = papersWithStats.length;
    let completedNotes = 0;
    let inProgressNotes = 0;
    let pdfCount = 0;

    papersWithStats.forEach(p => {
      if (p.hasPdf) pdfCount++;
      if (p.completion.isComplete) {
        completedNotes++;
      } else if (p.completion.isStarted) {
        inProgressNotes++;
      }
    });

    return {
      totalPapers,
      completedNotes,
      inProgressNotes,
      pdfCount,
      recentPapers: papersWithStats.slice(0, 5)
    };
  }

  /* ========================================================================
     PART B: Complete Backup and Restore System (V1.1)
     ======================================================================== */

  /**
   * Formats current date for backup filenames (YYYY-MM-DD).
   */
  function getBackupDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Exports lightweight Notes-Only backup as a JSON string.
   * Contains paper information and literature review notes (no PDF files).
   */
  async function exportNotesOnlyJson() {
    const db = await initDB();
    const [papers, notesList] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES], 'readonly');
      const pReq = tx.objectStore(STORE_PAPERS).getAll();
      const nReq = tx.objectStore(STORE_NOTES).getAll();
      let pRes = null, nRes = null;
      pReq.onsuccess = () => { pRes = pReq.result; };
      nReq.onsuccess = () => { nRes = nReq.result; };
      tx.oncomplete = () => resolve([pRes || [], nRes || []]);
      tx.onerror = (e) => reject(e.target.error);
    });

    // Remove internal PDF file pointers from notes-only export
    const sanitizedPapers = papers.map(p => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      doiUrl: p.doiUrl,
      createdAt: p.createdAt
    }));

    const exportObject = {
      appName: 'ResearchMate',
      backupVersion: 1,
      exportType: 'notes-only',
      createdAt: new Date().toISOString(),
      summary: {
        totalPapers: sanitizedPapers.length,
        totalNotes: notesList.length
      },
      papers: sanitizedPapers,
      notes: notesList
    };

    const jsonString = JSON.stringify(exportObject, null, 2);
    const filename = `ResearchMate_Notes_Backup_${getBackupDateString()}.json`;
    return { jsonString, filename };
  }

  /**
   * Exports Complete Full Backup as a ZIP file.
   * Structure:
   * ResearchMate_Backup_YYYY-MM-DD.zip
   *   backup-info.json
   *   papers.json
   *   notes.json
   *   original-pdfs/
   *       <paper-id>.pdf
   * 
   * @param {Function} [onProgress] Callback with progress percentage (0 - 100)
   * @returns {Promise<{ blob: Blob, filename: string, summary: Object }>}
   */
  async function exportFullBackupZip(onProgress) {
    if (typeof window.JSZip !== 'function') {
      throw new Error('JSZip library is not available. Ensure jszip.min.js is loaded.');
    }

    const db = await initDB();
    if (onProgress) onProgress(10, 'Fetching papers and literature review notes...');

    const [papers, notesList, pdfRecords] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS], 'readonly');
      const pReq = tx.objectStore(STORE_PAPERS).getAll();
      const nReq = tx.objectStore(STORE_NOTES).getAll();
      const pdfReq = tx.objectStore(STORE_PDFS).getAll();
      let pRes = null, nRes = null, pdfRes = null;
      pReq.onsuccess = () => { pRes = pReq.result; };
      nReq.onsuccess = () => { nRes = nReq.result; };
      pdfReq.onsuccess = () => { pdfRes = pdfReq.result; };
      tx.oncomplete = () => resolve([pRes || [], nRes || [], pdfRes || []]);
      tx.onerror = (e) => reject(e.target.error);
    });

    const zip = new window.JSZip();

    // 1. backup-info.json
    const backupInfo = {
      appName: 'ResearchMate',
      backupVersion: 1,
      exportType: 'full-zip',
      createdAt: new Date().toISOString(),
      summary: {
        totalPapers: papers.length,
        totalNotes: notesList.length,
        totalPdfs: pdfRecords.length
      }
    };
    zip.file('backup-info.json', JSON.stringify(backupInfo, null, 2));

    // 2. papers.json
    zip.file('papers.json', JSON.stringify(papers, null, 2));

    // 3. notes.json
    zip.file('notes.json', JSON.stringify(notesList, null, 2));

    // 4. original-pdfs/ folder
    if (pdfRecords.length > 0) {
      const pdfFolder = zip.folder('original-pdfs');
      for (let i = 0; i < pdfRecords.length; i++) {
        const item = pdfRecords[i];
        if (item.fileBlob) {
          // Store with paperId to guarantee unique association
          pdfFolder.file(`${item.paperId}.pdf`, item.fileBlob);
        }
      }
    }

    if (onProgress) onProgress(50, 'Compressing archive into ZIP package...');

    const blob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      },
      metadata => {
        if (onProgress) {
          const pct = Math.round(50 + metadata.percent * 0.5);
          onProgress(pct, `Compressing files (${Math.round(metadata.percent)}%)...`);
        }
      }
    );

    const filename = `ResearchMate_Backup_${getBackupDateString()}.zip`;
    return { blob, filename, summary: backupInfo.summary };
  }

  /**
   * Validates and inspects an uploaded ZIP backup before restoring.
   * Checks file validity, required JSONs, backup version, and structure.
   * 
   * @param {File|Blob} zipFile
   * @returns {Promise<{ isValid: boolean, backupInfo: Object, papers: Array, notes: Array, pdfCount: number, conflicts: Array }>}
   */
  async function inspectAndValidateZipBackup(zipFile) {
    if (typeof window.JSZip !== 'function') {
      throw new Error('JSZip library is not loaded.');
    }

    let zip;
    try {
      zip = await window.JSZip.loadAsync(zipFile);
    } catch (err) {
      throw new Error('Invalid or corrupted ZIP file. Please ensure you selected a valid ResearchMate backup archive.');
    }

    // Check required files
    const infoFile = zip.file('backup-info.json');
    const papersFile = zip.file('papers.json');
    const notesFile = zip.file('notes.json');

    if (!infoFile) {
      throw new Error('Invalid backup archive: Missing "backup-info.json".');
    }
    if (!papersFile) {
      throw new Error('Invalid backup archive: Missing "papers.json".');
    }
    if (!notesFile) {
      throw new Error('Invalid backup archive: Missing "notes.json".');
    }

    let backupInfo, papers, notesList;
    try {
      backupInfo = JSON.parse(await infoFile.async('text'));
    } catch {
      throw new Error('Corrupted "backup-info.json": Invalid JSON format.');
    }

    if (!backupInfo || backupInfo.appName !== 'ResearchMate') {
      throw new Error('Incompatible backup: Not a valid ResearchMate backup archive.');
    }

    try {
      papers = JSON.parse(await papersFile.async('text'));
      notesList = JSON.parse(await notesFile.async('text'));
    } catch {
      throw new Error('Corrupted backup data: Unable to parse papers or notes JSON.');
    }

    if (!Array.isArray(papers) || !Array.isArray(notesList)) {
      throw new Error('Invalid backup format: papers or notes is not an array.');
    }

    // Count PDFs in original-pdfs/ folder
    let pdfCount = 0;
    const pdfFolder = zip.folder('original-pdfs');
    if (pdfFolder) {
      pdfFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.endsWith('.pdf')) {
          pdfCount++;
        }
      });
    }

    // Check for ID conflicts with current database
    const existingPapers = await getAllPapers();
    const existingIds = new Set(existingPapers.map(p => p.id));
    const conflicts = [];

    papers.forEach(p => {
      if (existingIds.has(p.id)) {
        conflicts.push({
          id: p.id,
          backupTitle: p.title,
          existingPaper: existingPapers.find(ep => ep.id === p.id)
        });
      }
    });

    return {
      isValid: true,
      backupInfo,
      papers,
      notes: notesList,
      pdfCount,
      conflicts,
      zipInstance: zip
    };
  }

  /**
   * Restores data from validated ZIP backup.
   * Supports 'replace' and 'merge' modes.
   * 
   * @param {Object} validatedBackup Object returned by inspectAndValidateZipBackup
   * @param {'replace'|'merge'} mode
   * @param {Object} [conflictResolution={}] Optional resolution map for conflicting IDs in merge mode ('keep'|'replace')
   * @param {Function} [onProgress] Callback (percent, statusMessage)
   * @returns {Promise<{ restoredPapers: number, restoredNotes: number, restoredPdfs: number }>}
   */
  async function restoreZipBackup(validatedBackup, mode = 'replace', conflictResolution = {}, onProgress) {
    const { papers, notes: notesList, zipInstance } = validatedBackup;
    const db = await initDB();

    if (onProgress) onProgress(15, 'Preparing database transaction...');

    const existingPapers = await getAllPapers();
    const existingIdSet = new Set(existingPapers.map(p => p.id));

    // Determine records to insert based on mode
    let papersToInsert = [];
    let notesToInsert = [];
    let pdfPaperIdsToInsert = new Set();

    if (mode === 'replace') {
      papersToInsert = papers;
      notesToInsert = notesList;
      papers.forEach(p => { if (p.hasPdf) pdfPaperIdsToInsert.add(p.id); });
    } else {
      // Merge mode
      const notesMap = new Map();
      notesList.forEach(n => notesMap.set(n.paperId, n));

      papers.forEach(p => {
        if (!existingIdSet.has(p.id)) {
          // New paper -> add
          papersToInsert.push(p);
          if (notesMap.has(p.id)) notesToInsert.push(notesMap.get(p.id));
          if (p.hasPdf) pdfPaperIdsToInsert.add(p.id);
        } else {
          // Conflicting paper ID
          const resolution = conflictResolution[p.id] || 'keep';
          if (resolution === 'replace') {
            papersToInsert.push(p);
            if (notesMap.has(p.id)) notesToInsert.push(notesMap.get(p.id));
            if (p.hasPdf) pdfPaperIdsToInsert.add(p.id);
          }
          // If 'keep', we skip inserting and leave existing record untouched
        }
      });
    }

    if (onProgress) onProgress(35, 'Extracting original PDF files from archive...');

    // Extract PDF blobs from ZIP
    const pdfBlobsMap = new Map();
    const pdfFolder = zipInstance.folder('original-pdfs');
    if (pdfFolder) {
      for (const paperId of pdfPaperIdsToInsert) {
        const fileEntry = pdfFolder.file(`${paperId}.pdf`);
        if (fileEntry) {
          const blob = await fileEntry.async('blob');
          const paperMeta = papersToInsert.find(p => p.id === paperId);
          pdfBlobsMap.set(paperId, {
            paperId: paperId,
            fileBlob: blob,
            fileName: paperMeta && paperMeta.pdfFileName ? paperMeta.pdfFileName : `${paperMeta ? paperMeta.title : paperId}.pdf`,
            fileSize: blob.size,
            fileType: 'application/pdf',
            uploadedAt: paperMeta && paperMeta.createdAt ? paperMeta.createdAt : new Date().toISOString()
          });
        }
      }
    }

    if (onProgress) onProgress(60, 'Writing restored data to IndexedDB...');

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS], 'readwrite');
      const papersStore = tx.objectStore(STORE_PAPERS);
      const notesStore = tx.objectStore(STORE_NOTES);
      const pdfsStore = tx.objectStore(STORE_PDFS);

      tx.onerror = (e) => reject(e.target.error || new Error('Database transaction failed during restore.'));

      tx.oncomplete = () => {
        if (onProgress) onProgress(100, 'Restore complete.');
        resolve({
          restoredPapers: papersToInsert.length,
          restoredNotes: notesToInsert.length,
          restoredPdfs: pdfBlobsMap.size
        });
      };

      if (mode === 'replace') {
        papersStore.clear();
        notesStore.clear();
        pdfsStore.clear();
      }

      // Insert papers
      papersToInsert.forEach(p => papersStore.put(p));

      // Insert notes
      notesToInsert.forEach(n => notesStore.put(n));

      // Insert PDFs
      pdfBlobsMap.forEach(pdfRecord => pdfsStore.put(pdfRecord));
    });
  }

  // Expose global database module
  window.ResearchMateDB = {
    initDB,
    addPaper,
    getPaperPdf,
    getAllPapers,
    getPaperById,
    deletePaper,
    getNotesByPaperId,
    saveNotes,
    calculateCompletion,
    getAllPapersWithStats,
    getDashboardStats,
    exportNotesOnlyJson,
    exportFullBackupZip,
    inspectAndValidateZipBackup,
    restoreZipBackup
  };
})();
