/**
 * database.js - IndexedDB Persistent Storage for ResearchMate (V1.2)
 * Handles separate stores for:
 * - 'papers': immutable bibliographic metadata (and hasPdf flag)
 * - 'notes': editable 10-section structured rich-content literature review records
 * - 'pdfs': binary PDF Blobs for uploaded research papers
 * - 'images': binary image Blobs referenced by unique imageId inside rich notes
 * 
 * Includes V1 -> V1.2 non-destructive migration & Complete ZIP/JSON Backup/Restore.
 */

(function () {
  'use strict';

  const DB_NAME = 'ResearchMateDB';
  const DB_VERSION = 3; // Incremented for V1.2 (added 'images' store + rich Delta migration)
  const STORE_PAPERS = 'papers';
  const STORE_NOTES = 'notes';
  const STORE_PDFS = 'pdfs';
  const STORE_IMAGES = 'images';

  const SECTION_KEYS = [
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

  const NOTE_FORMAT_DELTA = 'quill-delta-v1';

  let dbInstance = null;

  /**
   * Normalizes a single section value (legacy plain text or structured Delta JSON)
   * into structured Quill Delta v1 format without losing any content or line breaks.
   * @param {string|Object|null|undefined} raw
   * @returns {{ format: string, delta: { ops: Array } }}
   */
  function normalizeSectionContent(raw) {
    if (!raw) {
      return { format: NOTE_FORMAT_DELTA, delta: { ops: [] } };
    }
    if (typeof raw === 'string') {
      if (raw.length === 0) {
        return { format: NOTE_FORMAT_DELTA, delta: { ops: [] } };
      }
      const normalizedStr = raw.endsWith('\n') ? raw : (raw + '\n');
      return {
        format: NOTE_FORMAT_DELTA,
        delta: {
          ops: [{ insert: normalizedStr }]
        }
      };
    }
    if (typeof raw === 'object') {
      if (raw.format === NOTE_FORMAT_DELTA && raw.delta && Array.isArray(raw.delta.ops)) {
        return {
          format: NOTE_FORMAT_DELTA,
          delta: { ops: raw.delta.ops }
        };
      }
      if (Array.isArray(raw.ops)) {
        return {
          format: NOTE_FORMAT_DELTA,
          delta: { ops: raw.ops }
        };
      }
    }
    return { format: NOTE_FORMAT_DELTA, delta: { ops: [] } };
  }

  /**
   * Normalizes an entire notes record across all 10 sections while preserving timestamps.
   * @param {Object} record
   * @returns {Object}
   */
  function normalizeNoteRecord(record) {
    const out = { ...record };
    SECTION_KEYS.forEach(key => {
      out[key] = normalizeSectionContent(record ? record[key] : '');
    });
    out.schemaVersion = 2;
    return out;
  }

  /**
   * Checks whether a single section contains meaningful content
   * (non-whitespace text OR an embedded diagram/image, table, equation, or divider).
   */
  function isSectionNonEmpty(raw) {
    if (!raw) return false;
    if (typeof raw === 'string') {
      return raw.trim().length > 0;
    }
    const normalized = normalizeSectionContent(raw);
    const ops = normalized.delta && Array.isArray(normalized.delta.ops) ? normalized.delta.ops : [];
    for (let i = 0; i < ops.length; i++) {
      const ins = ops[i] && ops[i].insert;
      if (typeof ins === 'string') {
        if (ins.trim().length > 0) return true;
      } else if (ins && typeof ins === 'object') {
        return true;
      }
    }
    return false;
  }

  /**
   * Extracts plain text summary from a structured section (for search & counts).
   * @param {string|Object} raw
   * @returns {string}
   */
  function extractSectionPlainText(raw) {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    const normalized = normalizeSectionContent(raw);
    const ops = normalized.delta && Array.isArray(normalized.delta.ops) ? normalized.delta.ops : [];
    const chunks = [];
    for (let i = 0; i < ops.length; i++) {
      const ins = ops[i] && ops[i].insert;
      if (typeof ins === 'string') {
        chunks.push(ins);
      } else if (ins && typeof ins === 'object') {
        if (ins['math-equation'] && ins['math-equation'].latex) {
          chunks.push(ins['math-equation'].latex);
        } else if (ins['research-table'] && Array.isArray(ins['research-table'].rows)) {
          ins['research-table'].rows.forEach(row => {
            if (Array.isArray(row)) chunks.push(row.map(c => (typeof c === 'string' ? c : (c && c.text) || '')).join(' '));
          });
        } else if (ins['research-image']) {
          const imgMeta = ins['research-image'];
          if (imgMeta.caption) chunks.push(imgMeta.caption);
          if (imgMeta.source) chunks.push(imgMeta.source);
        }
      }
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Collects all referenced imageId strings from a single note record.
   */
  function collectImageIdsFromNote(noteRecord) {
    const ids = new Set();
    if (!noteRecord) return ids;
    SECTION_KEYS.forEach(key => {
      const sec = normalizeSectionContent(noteRecord[key]);
      const ops = sec.delta && Array.isArray(sec.delta.ops) ? sec.delta.ops : [];
      ops.forEach(op => {
        if (op && op.insert && typeof op.insert === 'object' && op.insert['research-image']) {
          const id = op.insert['research-image'].imageId;
          if (id) ids.add(id);
        }
      });
    });
    return ids;
  }

  /**
   * Initializes or upgrades the IndexedDB database.
   * Seamlessly migrates existing V1 / V1.1 databases & plain-text notes without data loss.
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
        const tx = event.target.transaction;
        const oldVersion = event.oldVersion || 0;

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

        // 4. Images store: keyPath 'id' (V1.2 enhancement for rich editor diagram/figure blobs)
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          const imagesStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
          imagesStore.createIndex('paperId', 'paperId', { unique: false });
          imagesStore.createIndex('sectionId', 'sectionId', { unique: false });
          imagesStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Non-destructive V1/V1.1 -> V1.2 plain-text notes migration
        if (oldVersion > 0 && oldVersion < 3 && db.objectStoreNames.contains(STORE_NOTES) && tx) {
          const notesStore = tx.objectStore(STORE_NOTES);
          const cursorReq = notesStore.openCursor();
          cursorReq.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
              const existing = cursor.value;
              const migrated = normalizeNoteRecord(existing);
              cursor.update(migrated);
              cursor.continue();
            }
          };
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
   * Generates a safe unique identifier for image records.
   */
  function generateImageId() {
    return 'img_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * Creates blank default note structure for a paper (V1.2 structured Delta format).
   */
  function createBlankNotes(paperId) {
    const now = new Date().toISOString();
    const record = {
      paperId: paperId,
      schemaVersion: 2,
      createdAt: now,
      updatedAt: now
    };
    SECTION_KEYS.forEach(key => {
      record[key] = normalizeSectionContent('');
    });
    return record;
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
        const err = event.target.error;
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
          reject(new Error('Insufficient browser storage space to save this paper/PDF. Please free up storage or delete unused PDFs.'));
        } else {
          reject(err || new Error('Failed to save paper to database.'));
        }
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
   * Save an uploaded/pasted image Blob for a specific paper and section in IndexedDB.
   * Note: Only lightweight imageId references are stored inside editor JSON.
   * @param {string} paperId
   * @param {string} sectionId
   * @param {Blob|File} fileBlob
   * @param {Object} [meta] { id, fileName, fileType, width, height }
   * @returns {Promise<Object>} Stored image record
   */
  async function saveNoteImage(paperId, sectionId, fileBlob, meta = {}) {
    if (!paperId || !sectionId) {
      throw new Error('paperId and sectionId are required to save an image.');
    }
    if (!fileBlob) {
      throw new Error('Image Blob is required.');
    }

    const db = await initDB();
    const id = meta.id || generateImageId();
    const now = meta.createdAt || new Date().toISOString();

    const imageRecord = {
      id: id,
      paperId: paperId,
      sectionId: sectionId,
      fileBlob: fileBlob,
      fileName: meta.fileName || (fileBlob.name || `${id}.png`),
      fileType: meta.fileType || (fileBlob.type || 'image/png'),
      fileSize: typeof fileBlob.size === 'number' ? fileBlob.size : (meta.fileSize || 0),
      width: typeof meta.width === 'number' ? meta.width : null,
      height: typeof meta.height === 'number' ? meta.height : null,
      createdAt: now
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES], 'readwrite');
      tx.onerror = function (event) {
        const err = event.target.error;
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
          reject(new Error('Insufficient browser storage space to save this image. Please delete unused papers or images.'));
        } else {
          reject(err || new Error('Failed to save image to local database.'));
        }
      };
      tx.oncomplete = function () {
        resolve(imageRecord);
      };
      tx.objectStore(STORE_IMAGES).put(imageRecord);
    });
  }

  /**
   * Retrieve a stored note image record by its imageId.
   * @param {string} imageId
   * @returns {Promise<Object|null>}
   */
  async function getNoteImage(imageId) {
    if (!imageId) return null;
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES], 'readonly');
      const req = tx.objectStore(STORE_IMAGES).get(imageId);
      req.onsuccess = function () {
        resolve(req.result || null);
      };
      req.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieve all stored image records associated with a paperId.
   * @param {string} paperId
   * @returns {Promise<Array<Object>>}
   */
  async function getImagesByPaperId(paperId) {
    if (!paperId) return [];
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES], 'readonly');
      const idx = tx.objectStore(STORE_IMAGES).index('paperId');
      const req = idx.getAll(IDBKeyRange.only(paperId));
      req.onsuccess = function () {
        resolve(req.result || []);
      };
      req.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  /**
   * Delete a single stored note image by imageId.
   * @param {string} imageId
   * @returns {Promise<boolean>}
   */
  async function deleteNoteImage(imageId) {
    if (!imageId) return false;
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES], 'readwrite');
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function (event) { reject(event.target.error); };
      tx.objectStore(STORE_IMAGES).delete(imageId);
    });
  }

  /**
   * Removes unreferenced orphaned image Blobs for a given paper
   * (e.g., after leaving the editor when deleted images can no longer be undone).
   * @param {string} paperId
   * @param {Object} [notesRecord]
   * @returns {Promise<number>} Count of deleted orphans
   */
  async function cleanupOrphanedImagesForPaper(paperId, notesRecord) {
    if (!paperId) return 0;
    const notes = notesRecord || (await getNotesByPaperId(paperId));
    const referencedIds = collectImageIdsFromNote(notes);
    const storedImages = await getImagesByPaperId(paperId);
    const toDelete = storedImages.filter(img => !referencedIds.has(img.id)).map(img => img.id);
    if (toDelete.length === 0) return 0;

    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_IMAGES], 'readwrite');
      const store = tx.objectStore(STORE_IMAGES);
      tx.oncomplete = () => resolve(toDelete.length);
      tx.onerror = (e) => reject(e.target.error);
      toDelete.forEach(id => store.delete(id));
    });
  }

  /**
   * Delete a paper and its associated notes, uploaded original PDF, AND all embedded images completely.
   * @param {string} paperId
   * @returns {Promise<boolean>}
   */
  async function deletePaper(paperId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS, STORE_IMAGES], 'readwrite');

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function (event) {
        reject(event.target.error || new Error('Failed to delete paper.'));
      };

      const papersStore = transaction.objectStore(STORE_PAPERS);
      const notesStore = transaction.objectStore(STORE_NOTES);
      const pdfsStore = transaction.objectStore(STORE_PDFS);
      const imagesStore = transaction.objectStore(STORE_IMAGES);

      papersStore.delete(paperId);
      notesStore.delete(paperId);
      pdfsStore.delete(paperId);

      // Delete all images belonging to this paper via cursor on paperId index
      const imgIndex = imagesStore.index('paperId');
      const cursorReq = imgIndex.openKeyCursor(IDBKeyRange.only(paperId));
      cursorReq.onsuccess = function (e) {
        const cursor = e.target.result;
        if (cursor) {
          imagesStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
    });
  }

  /**
   * Retrieve literature review notes for a given paper.
   * Automatically normalizes legacy plain-text sections to structured Quill Delta v1 format.
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
          resolve(normalizeNoteRecord(request.result));
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
      schemaVersion: 2,
      createdAt: notesData.createdAt || now,
      updatedAt: now
    };
    SECTION_KEYS.forEach(key => {
      updatedRecord[key] = normalizeSectionContent(notesData[key]);
    });

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NOTES], 'readwrite');
      const store = transaction.objectStore(STORE_NOTES);
      const request = store.put(updatedRecord);

      request.onsuccess = function () {
        resolve(updatedRecord);
      };

      request.onerror = function (event) {
        const err = event.target.error;
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
          reject(new Error('Insufficient browser storage space to save notes.'));
        } else {
          reject(err || new Error('Failed to update notes in database.'));
        }
      };
    });
  }

  /**
   * Calculate completion status of a notes record across the 10 sections.
   * Handles both legacy plain-text notes and V1.2 rich structured notes.
   * @param {Object} notes
   * @returns {{ completedCount: number, totalSections: number, percentage: number, isComplete: boolean, isStarted: boolean }}
   */
  function calculateCompletion(notes) {
    if (!notes) {
      return { completedCount: 0, totalSections: SECTION_KEYS.length, percentage: 0, isComplete: false, isStarted: false };
    }

    let completed = 0;
    SECTION_KEYS.forEach(k => {
      if (isSectionNonEmpty(notes[k])) {
        completed++;
      }
    });

    const percentage = Math.round((completed / SECTION_KEYS.length) * 100);
    return {
      completedCount: completed,
      totalSections: SECTION_KEYS.length,
      percentage: percentage,
      isComplete: completed === SECTION_KEYS.length,
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
    const [papersWithStats, db] = await Promise.all([getAllPapersWithStats(), initDB()]);
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

    const imageCount = await new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_IMAGES], 'readonly');
        const req = tx.objectStore(STORE_IMAGES).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });

    return {
      totalPapers,
      completedNotes,
      inProgressNotes,
      pdfCount,
      imageCount,
      recentPapers: papersWithStats.slice(0, 5)
    };
  }

  /* ========================================================================
     PART B: Complete Backup and Restore System (V1.1 / V1.2)
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
   * Resolves a safe file extension from image MIME type or filename.
   */
  function mimeToExtension(mimeType, fileName) {
    const type = (mimeType || '').toLowerCase();
    if (type === 'image/png') return '.png';
    if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
    if (type === 'image/webp') return '.webp';
    const match = (fileName || '').match(/\.(png|jpe?g|webp)$/i);
    if (match) return '.' + match[1].toLowerCase().replace('jpeg', 'jpg');
    return '.png';
  }

  /**
   * Exports lightweight Notes-Only backup as a JSON string.
   * Contains paper information, structured 10-section rich notes (formatting, tables, LaTeX source),
   * and image metadata/references (no binary PDFs or binary image blobs).
   */
  async function exportNotesOnlyJson() {
    const db = await initDB();
    const [papers, notesList, imageRecords] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_IMAGES], 'readonly');
      const pReq = tx.objectStore(STORE_PAPERS).getAll();
      const nReq = tx.objectStore(STORE_NOTES).getAll();
      const iReq = tx.objectStore(STORE_IMAGES).getAll();
      let pRes = null, nRes = null, iRes = null;
      pReq.onsuccess = () => { pRes = pReq.result; };
      nReq.onsuccess = () => { nRes = nReq.result; };
      iReq.onsuccess = () => { iRes = iReq.result; };
      tx.oncomplete = () => resolve([pRes || [], nRes || [], iRes || []]);
      tx.onerror = (e) => reject(e.target.error);
    });

    // Remove internal binary pointers from notes-only export
    const sanitizedPapers = papers.map(p => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      doiUrl: p.doiUrl,
      createdAt: p.createdAt
    }));

    const normalizedNotes = notesList.map(n => normalizeNoteRecord(n));
    const imagesMetadata = imageRecords.map(img => ({
      id: img.id,
      paperId: img.paperId,
      sectionId: img.sectionId,
      fileName: img.fileName,
      fileType: img.fileType,
      fileSize: img.fileSize,
      width: img.width,
      height: img.height,
      createdAt: img.createdAt
    }));

    const exportObject = {
      appName: 'ResearchMate',
      backupVersion: 2,
      exportType: 'notes-only',
      noteFormatNote: 'Includes rich structured Delta JSON, tables, LaTeX source, and image metadata references. Binary image and PDF files require Full Backup (.ZIP).',
      createdAt: new Date().toISOString(),
      summary: {
        totalPapers: sanitizedPapers.length,
        totalNotes: normalizedNotes.length,
        referencedImages: imagesMetadata.length
      },
      papers: sanitizedPapers,
      notes: normalizedNotes,
      imagesMetadata: imagesMetadata
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
   *   images.json
   *   original-pdfs/
   *       <paper-id>.pdf
   *   images/
   *       <image-id>.<ext>
   * 
   * @param {Function} [onProgress] Callback with progress percentage (0 - 100)
   * @returns {Promise<{ blob: Blob, filename: string, summary: Object }>}
   */
  async function exportFullBackupZip(onProgress) {
    if (typeof window.JSZip !== 'function') {
      throw new Error('JSZip library is not available. Ensure jszip.min.js is loaded.');
    }

    const db = await initDB();
    if (onProgress) onProgress(10, 'Fetching papers, rich notes, PDFs, and embedded images...');

    const [papers, notesList, pdfRecords, imageRecords] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS, STORE_IMAGES], 'readonly');
      const pReq = tx.objectStore(STORE_PAPERS).getAll();
      const nReq = tx.objectStore(STORE_NOTES).getAll();
      const pdfReq = tx.objectStore(STORE_PDFS).getAll();
      const imgReq = tx.objectStore(STORE_IMAGES).getAll();
      let pRes = null, nRes = null, pdfRes = null, imgRes = null;
      pReq.onsuccess = () => { pRes = pReq.result; };
      nReq.onsuccess = () => { nRes = nReq.result; };
      pdfReq.onsuccess = () => { pdfRes = pdfReq.result; };
      imgReq.onsuccess = () => { imgRes = imgReq.result; };
      tx.oncomplete = () => resolve([pRes || [], nRes || [], pdfRes || [], imgRes || []]);
      tx.onerror = (e) => reject(e.target.error);
    });

    const normalizedNotes = notesList.map(n => normalizeNoteRecord(n));
    const zip = new window.JSZip();

    // 1. images/ folder & manifest metadata
    const imagesMeta = [];
    if (imageRecords.length > 0) {
      const imgFolder = zip.folder('images');
      for (let i = 0; i < imageRecords.length; i++) {
        const img = imageRecords[i];
        if (!img || !img.fileBlob) continue;
        const ext = mimeToExtension(img.fileType, img.fileName);
        const relPath = `images/${img.id}${ext}`;
        imgFolder.file(`${img.id}${ext}`, img.fileBlob);
        imagesMeta.push({
          id: img.id,
          paperId: img.paperId,
          sectionId: img.sectionId,
          fileName: img.fileName,
          fileType: img.fileType,
          fileSize: img.fileSize,
          width: img.width,
          height: img.height,
          archivePath: relPath,
          createdAt: img.createdAt
        });
      }
    }

    // 2. backup-info.json
    const backupInfo = {
      appName: 'ResearchMate',
      backupVersion: 2,
      exportType: 'full-zip',
      createdAt: new Date().toISOString(),
      summary: {
        totalPapers: papers.length,
        totalNotes: normalizedNotes.length,
        totalPdfs: pdfRecords.length,
        totalImages: imagesMeta.length
      }
    };
    zip.file('backup-info.json', JSON.stringify(backupInfo, null, 2));

    // 3. papers.json
    zip.file('papers.json', JSON.stringify(papers, null, 2));

    // 4. notes.json
    zip.file('notes.json', JSON.stringify(normalizedNotes, null, 2));

    // 5. images.json (metadata linking imageId -> binary path in images/)
    zip.file('images.json', JSON.stringify(imagesMeta, null, 2));

    // 6. original-pdfs/ folder
    if (pdfRecords.length > 0) {
      const pdfFolder = zip.folder('original-pdfs');
      for (let i = 0; i < pdfRecords.length; i++) {
        const item = pdfRecords[i];
        if (item.fileBlob) {
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
   * Finds a ZIP file entry for an imageId either via archivePath or scanning images/ folder.
   */
  function findImageZipEntry(zip, imgMeta) {
    if (imgMeta && imgMeta.archivePath) {
      const direct = zip.file(imgMeta.archivePath);
      if (direct) return direct;
    }
    const imgFolder = zip.folder('images');
    if (!imgFolder || !imgMeta || !imgMeta.id) return null;
    let found = null;
    imgFolder.forEach((relativePath, file) => {
      if (!found && !file.dir && relativePath.startsWith(imgMeta.id + '.')) {
        found = file;
      }
    });
    return found;
  }

  /**
   * Validates and inspects an uploaded ZIP backup before restoring.
   * Supports both V1.1 (backupVersion 1) and V1.2 (backupVersion 2) archives.
   * 
   * @param {File|Blob} zipFile
   * @returns {Promise<Object>}
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

    if (typeof backupInfo.backupVersion !== 'number' || backupInfo.backupVersion < 1 || backupInfo.backupVersion > 2) {
      throw new Error(`Unsupported backup format version (${backupInfo.backupVersion}). Please update ResearchMate.`);
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

    // Optional V1.2 images.json metadata
    let imagesMeta = [];
    const imagesJsonFile = zip.file('images.json');
    if (imagesJsonFile) {
      try {
        const parsedImages = JSON.parse(await imagesJsonFile.async('text'));
        if (!Array.isArray(parsedImages)) {
          throw new Error('images.json must be an array.');
        }
        imagesMeta = parsedImages;
      } catch (e) {
        throw new Error('Corrupted "images.json": ' + (e.message || 'Invalid JSON format.'));
      }
    }

    // Validate paper & note records
    const backupPaperIds = new Set();
    papers.forEach((p, idx) => {
      if (!p || !p.id || !p.title) {
        throw new Error(`Invalid paper record at index ${idx}: missing id or title.`);
      }
      backupPaperIds.add(p.id);
    });

    notesList.forEach((n, idx) => {
      if (!n || !n.paperId) {
        throw new Error(`Invalid note record at index ${idx}: missing paperId association.`);
      }
    });

    // Count PDFs in original-pdfs/ folder and verify associations
    let pdfCount = 0;
    const missingPdfs = [];
    const pdfFolder = zip.folder('original-pdfs');
    if (pdfFolder) {
      pdfFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.endsWith('.pdf')) {
          pdfCount++;
        }
      });
    }

    papers.forEach(p => {
      if (p.hasPdf) {
        const hasFile = pdfFolder && pdfFolder.file(`${p.id}.pdf`) !== null;
        if (!hasFile) {
          missingPdfs.push({ id: p.id, title: p.title });
        }
      }
    });

    // Count binary images in images/ folder and verify referenced imageIds
    let imageCount = 0;
    const imgFileById = new Map();
    const imgFolder = zip.folder('images');
    if (imgFolder) {
      imgFolder.forEach((relativePath, file) => {
        if (!file.dir && /\.(png|jpe?g|webp)$/i.test(relativePath)) {
          imageCount++;
          const base = relativePath.replace(/\.(png|jpe?g|webp)$/i, '');
          imgFileById.set(base, file);
        }
      });
    }

    // If images.json exists without binary files or vice versa, build complete lookup
    const imagesMetaMap = new Map();
    imagesMeta.forEach(meta => {
      if (meta && meta.id) imagesMetaMap.set(meta.id, meta);
    });

    const missingImages = [];
    notesList.forEach(n => {
      const refs = collectImageIdsFromNote(n);
      refs.forEach(imageId => {
        const meta = imagesMetaMap.get(imageId);
        const entry = meta ? findImageZipEntry(zip, meta) : imgFileById.get(imageId);
        if (!entry) {
          missingImages.push({ imageId, paperId: n.paperId });
        }
      });
    });

    // Check for ID conflicts with current database
    const existingPapers = await getAllPapers();
    const existingMap = new Map();
    existingPapers.forEach(ep => existingMap.set(ep.id, ep));
    const conflicts = [];

    papers.forEach(p => {
      if (existingMap.has(p.id)) {
        const existing = existingMap.get(p.id);
        conflicts.push({
          id: p.id,
          backupTitle: p.title,
          backupAuthors: p.authors,
          existingTitle: existing.title,
          existingAuthors: existing.authors
        });
      }
    });

    return {
      isValid: true,
      backupInfo,
      papers,
      notes: notesList,
      imagesMeta,
      pdfCount,
      imageCount,
      missingPdfs,
      missingImages,
      conflicts,
      zipInstance: zip
    };
  }

  /**
   * Restores data from validated ZIP backup.
   * Supports 'replace' and 'merge' modes for V1.1 & V1.2 backups atomically.
   * 
   * @param {Object} validatedBackup Object returned by inspectAndValidateZipBackup
   * @param {'replace'|'merge'} mode
   * @param {Object} [conflictResolution={}] Resolution map for conflicting IDs in merge mode ('keep'|'replace')
   * @param {Function} [onProgress] Callback (percent, statusMessage)
   * @returns {Promise<{ restoredPapers: number, restoredNotes: number, restoredPdfs: number, restoredImages: number }>}
   */
  async function restoreZipBackup(validatedBackup, mode = 'replace', conflictResolution = {}, onProgress) {
    const { papers, notes: notesList, imagesMeta = [], zipInstance } = validatedBackup;
    const db = await initDB();

    if (onProgress) onProgress(15, 'Preparing database transaction...');

    const existingPapers = await getAllPapers();
    const existingIdSet = new Set(existingPapers.map(p => p.id));

    let papersToInsert = [];
    let notesToInsert = [];
    const pdfPaperIdsToInsert = new Set();
    const insertedPaperIdSet = new Set();
    const replacedPaperIds = new Set();

    if (mode === 'replace') {
      papersToInsert = papers;
      notesToInsert = notesList.map(n => normalizeNoteRecord(n));
      papers.forEach(p => {
        insertedPaperIdSet.add(p.id);
        if (p.hasPdf) pdfPaperIdsToInsert.add(p.id);
      });
    } else {
      const notesMap = new Map();
      notesList.forEach(n => notesMap.set(n.paperId, normalizeNoteRecord(n)));

      papers.forEach(p => {
        if (!existingIdSet.has(p.id)) {
          papersToInsert.push(p);
          insertedPaperIdSet.add(p.id);
          if (notesMap.has(p.id)) notesToInsert.push(notesMap.get(p.id));
          if (p.hasPdf) pdfPaperIdsToInsert.add(p.id);
        } else {
          const resolution = conflictResolution[p.id] || 'keep';
          if (resolution === 'replace') {
            papersToInsert.push(p);
            insertedPaperIdSet.add(p.id);
            replacedPaperIds.add(p.id);
            if (notesMap.has(p.id)) notesToInsert.push(notesMap.get(p.id));
            if (p.hasPdf) pdfPaperIdsToInsert.add(p.id);
          }
        }
      });
    }

    if (onProgress) onProgress(35, 'Extracting original PDFs and embedded images...');

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

    // Extract embedded image blobs from ZIP for papers being inserted
    const imageRecordsToInsert = [];
    const metaById = new Map();
    imagesMeta.forEach(m => { if (m && m.id) metaById.set(m.id, m); });

    // Build set of imageIds referenced by notesToInsert (plus images.json records owned by insertedPaperIdSet)
    const candidateImages = new Map();
    imagesMeta.forEach(meta => {
      if (meta && meta.id && insertedPaperIdSet.has(meta.paperId)) {
        candidateImages.set(meta.id, meta);
      }
    });
    notesToInsert.forEach(note => {
      SECTION_KEYS.forEach(secKey => {
        const sec = normalizeSectionContent(note[secKey]);
        (sec.delta.ops || []).forEach(op => {
          if (op && op.insert && typeof op.insert === 'object' && op.insert['research-image']) {
            const imgRef = op.insert['research-image'];
            if (imgRef.imageId && !candidateImages.has(imgRef.imageId)) {
              const existingMeta = metaById.get(imgRef.imageId);
              candidateImages.set(imgRef.imageId, existingMeta || {
                id: imgRef.imageId,
                paperId: note.paperId,
                sectionId: secKey,
                fileName: imgRef.fileName || `${imgRef.imageId}.png`,
                fileType: 'image/png'
              });
            }
          }
        });
      });
    });

    for (const [imageId, meta] of candidateImages.entries()) {
      const entry = findImageZipEntry(zipInstance, meta);
      if (entry) {
        const rawBlob = await entry.async('blob');
        const mimeType = meta.fileType || (entry.name.endsWith('.jpg') ? 'image/jpeg' : entry.name.endsWith('.webp') ? 'image/webp' : 'image/png');
        const typedBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: mimeType });
        imageRecordsToInsert.push({
          id: imageId,
          paperId: meta.paperId,
          sectionId: meta.sectionId || 'methodology',
          fileBlob: typedBlob,
          fileName: meta.fileName || `${imageId}.png`,
          fileType: mimeType,
          fileSize: typedBlob.size,
          width: typeof meta.width === 'number' ? meta.width : null,
          height: typeof meta.height === 'number' ? meta.height : null,
          createdAt: meta.createdAt || new Date().toISOString()
        });
      }
    }

    if (onProgress) onProgress(65, 'Writing restored data to IndexedDB...');

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PAPERS, STORE_NOTES, STORE_PDFS, STORE_IMAGES], 'readwrite');
      const papersStore = tx.objectStore(STORE_PAPERS);
      const notesStore = tx.objectStore(STORE_NOTES);
      const pdfsStore = tx.objectStore(STORE_PDFS);
      const imagesStore = tx.objectStore(STORE_IMAGES);

      tx.onerror = (e) => {
        const err = e.target.error;
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
          reject(new Error('Insufficient browser storage space to restore this backup. Existing data has been preserved.'));
        } else {
          reject(err || new Error('Database transaction failed during restore. Existing data has been preserved.'));
        }
      };

      tx.oncomplete = () => {
        if (onProgress) onProgress(100, 'Restore complete.');
        resolve({
          restoredPapers: papersToInsert.length,
          restoredNotes: notesToInsert.length,
          restoredPdfs: pdfBlobsMap.size,
          restoredImages: imageRecordsToInsert.length
        });
      };

      const performInserts = () => {
        papersToInsert.forEach(p => {
          const cleanPaper = { ...p };
          if (cleanPaper.hasPdf && !pdfBlobsMap.has(cleanPaper.id)) {
            cleanPaper.hasPdf = false;
          }
          papersStore.put(cleanPaper);
        });

        notesToInsert.forEach(n => notesStore.put(normalizeNoteRecord(n)));
        pdfBlobsMap.forEach(pdfRecord => pdfsStore.put(pdfRecord));
        imageRecordsToInsert.forEach(imgRec => imagesStore.put(imgRec));
      };

      if (mode === 'replace') {
        papersStore.clear();
        notesStore.clear();
        pdfsStore.clear();
        imagesStore.clear();
        performInserts();
      } else if (replacedPaperIds.size > 0) {
        // Delete existing images & PDFs of papers being replaced in merge mode before putting replacements
        let pendingDeletes = replacedPaperIds.size;
        const imgIndex = imagesStore.index('paperId');
        replacedPaperIds.forEach(repId => {
          if (!pdfPaperIdsToInsert.has(repId)) {
            pdfsStore.delete(repId);
          }
          const cReq = imgIndex.openKeyCursor(IDBKeyRange.only(repId));
          cReq.onsuccess = (ev) => {
            const cur = ev.target.result;
            if (cur) {
              imagesStore.delete(cur.primaryKey);
              cur.continue();
            } else {
              pendingDeletes--;
              if (pendingDeletes === 0) performInserts();
            }
          };
        });
      } else {
        performInserts();
      }
    });
  }

  // Expose global database module
  window.ResearchMateDB = {
    SECTION_KEYS,
    NOTE_FORMAT_DELTA,
    normalizeSectionContent,
    normalizeNoteRecord,
    isSectionNonEmpty,
    extractSectionPlainText,
    initDB,
    addPaper,
    getPaperPdf,
    getAllPapers,
    getPaperById,
    deletePaper,
    getNotesByPaperId,
    saveNotes,
    saveNoteImage,
    getNoteImage,
    getImagesByPaperId,
    deleteNoteImage,
    cleanupOrphanedImagesForPaper,
    calculateCompletion,
    getAllPapersWithStats,
    getDashboardStats,
    exportNotesOnlyJson,
    exportFullBackupZip,
    inspectAndValidateZipBackup,
    restoreZipBackup
  };
})();
