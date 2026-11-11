# ResearchMate 📖
> **A Minimal Personal Research Paper Literature Review Notebook**

ResearchMate is a lightweight, clean, fast, and responsive web application designed for personal academic research. It replaces bulky spreadsheets with an elegant, distraction-free digital notebook where you can collect, organize, save, update, and export literature review notes for individual research papers.

---

## 🎯 Core Philosophy & Workflow

```text
[Add Research Paper]  ──►  [Read Externally]  ──►  [Record Notes (10 Sections)]  ──►  [Save Notes]  ──►  [Export PDF]
  (Metadata Fixed)        (PDF Reader / Print)      (Editable Anytime)             (IndexedDB)     (Publication-Ready)
```

### Key Distinction
- **Research Paper Information is fixed after creation**: Bibliographic metadata (Title, Authors, Year, DOI/URL) is immutable to preserve an accurate academic record.
- **Literature Review Notes are fully editable**: Your personal critique, notes, and analysis across all 10 core dimensions can be written, revised, and expanded at any time.

---

## 🚀 Key Features

- **10 Core Literature Review Dimensions**:
  1. `01. Research Problem` — Challenges or existing issues addressed
  2. `02. Research Objective` — Primary intended goal or hypothesis
  3. `03. Dataset` — Name, size, source, characteristics, and notes
  4. `04. Methodology / Proposed Method` — Core approach, algorithms, models, implementation
  5. `05. Evaluation Protocol` — Train/test splits, baselines, cross-validation
  6. `06. Evaluation Metrics` — Accuracy, F1, RMSE, domain-specific metrics
  7. `07. Key Findings` — Experimental results and primary discoveries
  8. `08. Limitations` — Weaknesses, computational bottlenecks, unresolved problems
  9. `09. Future Work` — Directions suggested by authors
  10. `10. My Critical Analysis & Research Opportunities` — Personal critique, learnings, gaps, and ideas
- **Individual PDF Export**:
  - One-click export for each paper independently (`ResearchMate_<Paper_Title>.pdf`).
  - Full Unicode and Bengali character support (using bundled `html2pdf.js` & `jsPDF`).
  - Clean page breaks, academic typography, running headers, and page numbering.
- **100% Client-Side Persistent Storage**:
  - Powered by browser **IndexedDB** (`ResearchMateDB`).
  - Zero backend, zero account creation, zero login.
  - Complete data privacy: your research notes never leave your computer.
- **Minimal Notion-Inspired UI**:
  - Distraction-free, responsive layout (desktop, tablet, mobile).
  - Auto-growing textareas, live word counters, and quick section-jump pills.
  - Safe editing: unsaved change detection, keyboard shortcuts (`Ctrl+S` / `Cmd+S`), and delete confirmation.
  - Instant live search by title or author, with flexible sorting.

---

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+).
- **Database**: Native Browser IndexedDB (`ResearchMateDB`, Version 1).
- **PDF Generation**: `jsPDF` & `html2pdf.js` (locally vendored in `js/vendor/` for 100% offline capability).
- **Dependencies**: Zero external framework dependencies (No React, Vue, Angular, Node.js, or backend servers).

---

## 📂 Project Structure

```text
ResearchMate/
│
├── index.html                   # Main application entry point & semantic markup
│
├── css/
│   └── style.css                # Academic, Notion-inspired light theme styling
│
├── js/
│   ├── app.js                   # Navigation router, view coordinator, toast feedback
│   ├── database.js              # IndexedDB wrapper (papers and notes stores)
│   ├── papers.js                # Paper listing, search, sort, and modal management
│   ├── notes.js                 # 10-section note editor, autosize, unsaved guards
│   ├── pdf-export.js            # Individual academic PDF generator (Unicode & Bengali)
│   └── vendor/
│       ├── jspdf.umd.min.js     # jsPDF library (offline bundle)
│       └── html2pdf.bundle.min.js # html2pdf with html2canvas (offline bundle)
│
├── assets/
│   └── icons/
│       └── book.svg             # Vector academic emblem
│
├── tests/                       # Automated test suite (Headless Chrome & E2E)
│   ├── test_runner.html         # Unit & database integration tests
│   ├── e2e_runner.html          # End-to-end browser UI workflow tests
│   ├── test_pdf.html            # PDF binary validation & Bengali Unicode test
│   ├── run.py                   # Python test executor for unit tests
│   └── run_e2e.py               # Python test executor for E2E workflows
│
└── README.md                    # Documentation & operational guide
```

---

## 💻 How to Run Locally

Because ResearchMate uses modern browser standards (IndexedDB and JavaScript modules), you can run it locally in any modern browser (Chrome, Edge, Firefox, Safari).

### Method 1: Using Python (Recommended)
If you have Python installed, start a lightweight local web server:

```powershell
# Open terminal in the ResearchMate directory
cd d:\ResearchMate

# Start Python HTTP server
python -m http.server 8000
```
Then open your browser and navigate to:
```text
http://localhost:8000
```

### Method 2: Direct File Open
You can also open `index.html` directly in your browser by double-clicking it or using:
```powershell
Start-Process "d:\ResearchMate\index.html"
```
*(Note: Running via a local HTTP server is recommended for maximum browser API compatibility across all operating systems).*

---

## 🗄️ How IndexedDB Stores the Data

ResearchMate uses **IndexedDB** directly in your browser. Unlike `localStorage` (which has a strict 5MB limit and blocks the main thread), IndexedDB provides high-capacity, asynchronous, structured storage.

### Database Name: `ResearchMateDB` (Version 1)

#### 1. `papers` Object Store
Stores immutable bibliographic metadata for each paper:
```json
{
  "id": "paper_m4v8y2p9_a7b1c3d",
  "title": "Attention Is All You Need",
  "authors": "Ashish Vaswani, Noam Shazeer, Niki Parmar, et al.",
  "year": 2017,
  "doiUrl": "https://arxiv.org/abs/1706.03762",
  "createdAt": "2026-11-11T13:30:00.000Z"
}
```
- **Key Path**: `id` (unique primary key)
- **Indexes**: `createdAt` (for reverse-chronological sorting), `title`, `authors`

#### 2. `notes` Object Store
Stores editable literature review notes associated with the paper ID:
```json
{
  "paperId": "paper_m4v8y2p9_a7b1c3d",
  "researchProblem": "Recurrent neural networks compute sequentially...",
  "researchObjective": "Develop a model based purely on attention...",
  "dataset": "WMT 2014 English-to-German & English-to-French",
  "methodology": "Multi-Head Self-Attention and Scaled Dot-Product Attention",
  "evaluationProtocol": "Trained on 8 P100 GPUs with Adam optimizer",
  "evaluationMetrics": "BLEU score (28.4 on En-De, 41.8 on En-Fr)",
  "keyFindings": "Outperforms existing models while training in a fraction of time",
  "limitations": "Quadratic complexity with respect to sequence length",
  "futureWork": "Extension to other modalities such as images and audio",
  "criticalAnalysis": "Seminal architecture behind all contemporary LLMs",
  "createdAt": "2026-11-11T13:30:00.000Z",
  "updatedAt": "2026-11-11T13:45:00.000Z"
}
```
- **Key Path**: `paperId` (primary key matching the paper's `id`)
- **Indexes**: `updatedAt`

### Data Integrity & Cascade Deletion
When a paper is deleted, ResearchMate executes an atomic readwrite transaction that deletes the entry from `papers` **and** its corresponding record from `notes`, preventing orphaned records.

---

## 📖 How to Use the Application

### 1. Adding a Research Paper
1. Click the **"+ Add Paper"** button on the header or dashboard.
2. Enter the **Paper Title** (required) and **Author(s)** (required).
3. Optionally enter the **Publication Year** and **DOI / Paper URL**.
4. Click **"Add Paper"**. The paper is saved and you will be immediately taken to the Note Editor.

### 2. Taking Literature Review Notes
1. In the Note Editor, you will see the fixed paper metadata banner at the top.
2. Use the **Quick Jump Pills** (01 to 10) to navigate directly to any section.
3. Type notes in any or all 10 textareas. Textareas expand automatically as you type.
4. Save your progress:
   - Click the **"Save Notes"** button, or
   - Press <kbd>Ctrl+S</kbd> (<kbd>Cmd+S</kbd> on Mac).
5. Switch to **"Preview Notes"** to read your literature review in a clean, publication-formatted layout.

### 3. Downloading an Individual PDF
1. From either **My Papers**, the **Note Editor**, or **Preview Notes**, click **"Download PDF"**.
2. A formatted academic PDF named `ResearchMate_<Paper_Title>.pdf` will be generated and downloaded to your computer.
3. The PDF automatically handles page splitting, running headers, page numbers, and Unicode/Bengali text.

### 4. Searching and Sorting Papers
1. Go to **My Papers**.
2. Type any keyword in the search bar to filter instantly by paper title or author.
3. Use the sort dropdown to sort by Recently Added, Oldest, Title (A-Z), or Year.

---

## 🌐 How to Deploy on GitHub Pages

Because ResearchMate is 100% static client-side code with zero build steps or server requirements, deploying to GitHub Pages takes less than a minute:

1. **Initialize a Git repository** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit of ResearchMate"
   ```

2. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** (tab at the top).
   - In the left sidebar, click **Pages**.
   - Under **Build and deployment > Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and folder `/ (root)`.
   - Click **Save**.

4. Your application will be live at:
   ```text
   https://<your-username>.github.io/<your-repo-name>/
   ```

---

## 🧪 Automated Testing

ResearchMate includes an automated test harness that tests the application in real headless Chrome instances.

To run the automated tests locally:
```powershell
# 1. Run Unit & IndexedDB Integration Tests
python tests/run.py

# 2. Run End-to-End Browser UI Interaction Tests
python tests/run_e2e.py
```

All 14 unit tests and full end-to-end user workflows (modal input, typing, save, preview, search, filter, PDF generation, and deletion) are validated.

---

## ⚠️ Known Limitations & Considerations

1. **Browser Sandbox & Storage Clearing**:
   - IndexedDB stores data locally inside your specific browser profile.
   - If you manually click *"Clear browsing data & site cookies"* or use incognito/private browsing mode, the local browser database will be cleared.
   - *Recommendation*: Regularly export your important paper notes as PDF to keep permanent offline archive copies.
2. **Cross-Device Sync (Version 1 Scope)**:
   - In Version 1, data is stored locally on the device and browser you are using. Notes do not sync between devices (e.g. desktop to phone) without an external cloud backend, which was explicitly excluded from Version 1 requirements.
3. **Immutability of Bibliographic Information**:
   - Paper metadata cannot be edited after creation. If a typo is made in the paper title or author during creation, delete the record and re-add it.
4. **Browser PDF Download Prompts**:
   - Depending on your browser settings, downloading multiple PDFs consecutively may prompt you with *"Allow site to download multiple files?"*. Allowing this ensures uninterrupted one-click exports.

