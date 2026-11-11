# ResearchMate V1.1 📖
> **A Minimal Personal Research Paper Literature Review Notebook**
> *With Original PDF Upload & Complete Portable Backup/Restore*

ResearchMate is a lightweight, clean, fast, and responsive web application designed for personal academic research. It replaces bulky spreadsheets with an elegant, distraction-free digital notebook where you can collect, organize, save, update, view original research paper PDFs, and export/backup your entire research library.

---

## 🎯 Core Philosophy & Workflow

```text
       ┌──► Option 1: Add Manually ───────────┐
       │                                       ▼
[Add Paper]                        [Fixed Bibliographic Record]
       │                                       ▲
       └──► Option 2: Upload PDF ──────────────┘
                         │
                         ▼
               [View Original PDF]
                         │
                         ▼
        [10-Section Literature Review Notes] ◄──► [Edit / Save Notes]
                         │
                         ├──► [Download Notes PDF]
                         └──► [Data Management: Full ZIP Backup / Restore / JSON]
```

### Key Separation of Concerns
- **Research Paper Information is fixed after creation**: Bibliographic metadata (Title, Authors, Year, DOI/URL) and any attached original PDF file are immutable once saved, maintaining an accurate academic record.
- **Literature Review Notes are fully editable**: Your personal critique, notes, and analysis across all 10 core dimensions can be written, revised, and expanded at any time.

---

## 🚀 What's New in Version 1.1

### 1. Original Research Paper PDF Upload & Viewing
- **Two Creation Methods in Add Paper**:
  - **Option 1: Add Paper Manually**: Preserves the original manual entry workflow (Title, Authors, Year, DOI/URL).
  - **Option 2: Upload Research Paper PDF**:
    - File picker & Drag-and-drop dropzone.
    - Displays selected PDF filename and formatted file size (e.g. `2.4 MB`).
    - Replace or remove file before saving.
    - Automatic, client-side metadata extraction (extracts Title, Author, and Publication Year from PDF header/trailer bytes when present).
    - Always allows manual entry and editing before saving.
- **Local PDF Storage**:
  - Stored locally in your browser's IndexedDB as binary Blobs (in the dedicated `pdfs` store).
  - Zero external uploads. Complete privacy.
- **View Original PDF**:
  - Papers with an uploaded PDF feature a **"View Original PDF"** action button and a `PDF Attached` badge.
  - Generates a temporary Blob URL and opens the paper in a new browser tab.
  - Automatically cleans up object URLs.
  - Papers without an uploaded PDF cleanly omit this action.

### 2. Complete Backup & Restore System (Data Management)
Because ResearchMate has no backend or cloud database, the **Data Management** section enables transferring your research library across computers and browsers:

- **1. Export Full Backup (.ZIP)**:
  - Generates `ResearchMate_Backup_YYYY-MM-DD.zip`.
  - Packages:
    - `backup-info.json` (versioning, export timestamp, summary)
    - `papers.json` (all paper bibliographic metadata)
    - `notes.json` (all 10-section literature review notes)
    - `original-pdfs/` (folder containing all uploaded original research paper PDFs mapped by unique ID)
  - Generated client-side using bundled `JSZip`.
- **2. Import / Restore Backup (.ZIP)**:
  - Validates ZIP archive before modifying data (verifies `backup-info.json`, `papers.json`, `notes.json`, and PDF files).
  - Displays backup summary (Papers, Notes, PDFs, and Archive Date).
  - Two restore modes:
    - **Mode A: Merge with Existing Data**: Adds new papers and notes without overwriting existing entries. Conflicting IDs are flagged and preserved safely.
    - **Mode B: Replace All Existing Data**: Atomically wipes current library and restores the backup. Requires explicit confirmation.
- **3. Export Notes Only (.JSON)**:
  - Generates a lightweight `ResearchMate_Notes_Backup_YYYY-MM-DD.json` containing only paper metadata and literature review notes (no PDF files attached).

---

## 📚 10 Core Literature Review Dimensions

1. `01. Research Problem` — What problem are the researchers trying to solve?
2. `02. Research Objective` — What is the main objective or goal of this research?
3. `03. Dataset` — Dataset name, size, source, characteristics, and important data notes.
4. `04. Methodology / Proposed Method` — Proposed approach, algorithms, models, and implementation.
5. `05. Evaluation Protocol` — Train/test splits, validation strategy, baselines, setup.
6. `06. Evaluation Metrics` — Accuracy, Precision, Recall, F1, RMSE, MAE, or other metrics.
7. `07. Key Findings` — Experimental results, discoveries, and contributions.
8. `08. Limitations` — Weaknesses, dataset/experimental limitations, unresolved problems.
9. `09. Future Work` — Future directions suggested by the authors.
10. `10. My Critical Analysis & Research Opportunities` — Personal understanding, learnings, criticisms, research gaps, and ideas.

---

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+).
- **Database**: Native Browser IndexedDB (`ResearchMateDB`, Version 2).
- **PDF Generation**: `jsPDF` & `html2pdf.js` (locally vendored in `js/vendor/` for 100% offline capability, supports Bengali and Unicode).
- **ZIP Archiving**: `JSZip` (locally vendored in `js/vendor/jszip.min.js`).
- **Dependencies**: Zero external framework dependencies (No React, Vue, Angular, Node.js, or backend servers).

---

## 📂 Project Structure

```text
ResearchMate/
│
├── index.html                   # Main application entry point & semantic markup
│
├── css/
│   └── style.css                # Notion-inspired academic theme, dropzones, print styles
│
├── js/
│   ├── app.js                   # Navigation router, view coordinator, Data Management
│   ├── database.js              # IndexedDB V2 (papers, notes, pdfs, backup & restore)
│   ├── papers.js                # Manual entry, PDF upload, extraction, PDF viewing
│   ├── notes.js                 # 10-section note editor, autosize, unsaved guards
│   ├── pdf-export.js            # Individual academic PDF generator (Unicode & Bengali)
│   └── vendor/
│       ├── jszip.min.js         # JSZip library (offline bundle)
│       ├── jspdf.umd.min.js     # jsPDF library (offline bundle)
│       └── html2pdf.bundle.min.js # html2pdf with html2canvas (offline bundle)
│
├── assets/
│   └── icons/
│       └── book.svg             # Vector academic emblem
│
├── tests/                       # Automated test suite (Headless Chrome & E2E)
│   ├── test_runner.html         # Unit & database integration tests (V1.1)
│   ├── e2e_runner.html          # End-to-end browser UI workflow tests (V1.1)
│   ├── test_pdf.html            # PDF generator & Bengali Unicode test
│   ├── run.py                   # Python test executor for unit tests
│   └── run_e2e.py               # Python test executor for E2E workflows
│
├── start.bat                    # One-click Windows local launcher
└── README.md                    # Documentation & operational guide
```

---

## 💻 How to Run Locally

### Method 1: Using `start.bat` (Windows)
Double-click `start.bat` in File Explorer. It opens `http://localhost:8000` in your default browser and launches a local server.

### Method 2: Using Python
```powershell
cd d:\ResearchMate
python -m http.server 8000
```
Navigate to: `http://localhost:8000`

### Method 3: Direct File Open
Open `index.html` directly in any modern browser.

---

## 🗄️ How IndexedDB Stores the Data (Schema V2)

ResearchMate uses **IndexedDB** (`ResearchMateDB`, Version 2).

### 1. `papers` Store (Bibliographic Metadata)
- **Key Path**: `id`
- **Indexes**: `createdAt`, `title`, `authors`
- **Fields**:
  ```json
  {
    "id": "paper_m4v8y2p9_78bc34",
    "title": "Attention Is All You Need",
    "authors": "Ashish Vaswani, Noam Shazeer, Niki Parmar, et al.",
    "year": 2017,
    "doiUrl": "https://arxiv.org/abs/1706.03762",
    "hasPdf": true,
    "pdfFileName": "attention_2017.pdf",
    "pdfFileSize": 2215420,
    "createdAt": "2026-11-11T13:30:00.000Z"
  }
  ```

### 2. `notes` Store (10 Literature Review Sections)
- **Key Path**: `paperId` (matches paper's `id`)
- **Indexes**: `updatedAt`
- **Fields**: `researchProblem`, `researchObjective`, `dataset`, `methodology`, `evaluationProtocol`, `evaluationMetrics`, `keyFindings`, `limitations`, `futureWork`, `criticalAnalysis`, `createdAt`, `updatedAt`.

### 3. `pdfs` Store (Original Binary Files)
- **Key Path**: `paperId`
- **Indexes**: `uploadedAt`, `fileName`
- **Fields**:
  ```json
  {
    "paperId": "paper_m4v8y2p9_78bc34",
    "fileBlob": Blob,
    "fileName": "attention_2017.pdf",
    "fileSize": 2215420,
    "fileType": "application/pdf",
    "uploadedAt": "2026-11-11T13:30:00.000Z"
  }
  ```

---

## 📦 How to Export and Restore Backups

### Exporting Full Backup (.ZIP)
1. Go to **Data Management** from the top header navigation.
2. In the **1. Export Full Backup (.ZIP)** card, click **Download Full Backup (.ZIP)**.
3. Your browser will download `ResearchMate_Backup_YYYY-MM-DD.zip` containing all papers, review notes, and original PDFs.

### Restoring on Another Computer
1. Open ResearchMate on your other computer or browser.
2. Go to **Data Management**.
3. In **2. Import / Restore Backup (.ZIP)**, drag and drop or select your `ResearchMate_Backup_*.zip` file.
4. ResearchMate will inspect and validate the archive.
5. Select your restore mode:
   - **Mode A: Merge with Existing Data**: Keeps existing papers and adds new ones.
   - **Mode B: Replace All Existing Data**: Erases current library and restores the archive.
6. Click **Restore Library Now**.

### Exporting Notes Only (.JSON)
In **Data Management**, click **Download Notes Only (.JSON)** to save a lightweight text backup of your literature reviews without PDFs.

---

## 🧪 Automated Testing

To run the automated verification test suites in headless Chrome:
```powershell
# 1. Run Unit & Database Integration Tests
python tests/run.py

# 2. Run End-to-End Browser UI Workflow Tests
python tests/run_e2e.py
```
Both test suites validate manual entry, PDF upload, viewing original PDFs, note-saving, individual PDF export, full ZIP backup, and full ZIP restore.

---

## ⚠️ Known Limitations & Considerations

1. **Browser Profile Sandbox**: Data is stored inside your specific browser's IndexedDB profile. Manually clearing your browser's site cookies and offline data will reset IndexedDB. *Recommendation*: Use **Export Full Backup (.ZIP)** periodically to keep a permanent offline archive in your personal cloud or external drive.
2. **Immutable Bibliographic Info**: Paper metadata and attached PDFs are fixed after addition to preserve scientific citation integrity. To alter paper metadata, delete the paper and re-add it.
3. **Large PDF Files**: Modern browsers can store several gigabytes in IndexedDB, but uploading unusually large PDFs (>100MB each) may consume substantial browser quota.
