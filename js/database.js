/**
 * database.js - IndexedDB Persistent Storage for ResearchMate
 * Handles separate stores for 'papers' (immutable bibliographic metadata)
 * and 'notes' (editable 10-section literature review records).
 */

(function () {
  'use strict';

  const DB_NAME = 'ResearchMateDB';
  const DB_VERSION = 1;
  const STORE_PAPERS = 'papers';
  const STORE_NOTES = 'notes';

  let dbInstance = null;

  /**
   * Initializes the IndexedDB database.
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
   * Add a new research paper.
   * Also creates a corresponding empty note record in the notes store.
   * Note: Paper bibliographic details are immutable after creation.
   * 
   * @param {Object} data { title, authors, year, doiUrl }
   * @returns {Promise<Object>} The created paper object
   */
  async function addPaper(data) {
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

    const paperRecord = {
      id: paperId,
      title: title,
      authors: authors,
      year: isNaN(year) ? null : year,
      doiUrl: doiUrl,
      createdAt: now
    };

    const notesRecord = createBlankNotes(paperId);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS, STORE_NOTES], 'readwrite');

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
        // Sort descending by creation date
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
   * Delete a paper and its associated notes completely.
   * @param {string} paperId
   * @returns {Promise<boolean>}
   */
  async function deletePaper(paperId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_PAPERS, STORE_NOTES], 'readwrite');

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function (event) {
        reject(event.target.error || new Error('Failed to delete paper.'));
      };

      const papersStore = transaction.objectStore(STORE_PAPERS);
      const notesStore = transaction.objectStore(STORE_NOTES);

      papersStore.delete(paperId);
      notesStore.delete(paperId);
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
          // Fallback if notes store was missing record
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

    papersWithStats.forEach(p => {
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
      recentPapers: papersWithStats.slice(0, 5)
    };
  }

  // Expose global database module
  window.ResearchMateDB = {
    initDB,
    addPaper,
    getAllPapers,
    getPaperById,
    deletePaper,
    getNotesByPaperId,
    saveNotes,
    calculateCompletion,
    getAllPapersWithStats,
    getDashboardStats
  };
})();

