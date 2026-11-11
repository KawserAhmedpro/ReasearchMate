# ResearchMate V1.2 📖
> **A Minimal Personal Research Paper Literature Review Notebook**
> *Unified Rich Content Notes, Original PDF Archive, Vector PDF Export & Complete Backup/Restore*

ResearchMate is a lightweight, clean, fast, and responsive browser-only web application designed for personal academic research. It replaces bulky spreadsheets with a distraction-free digital notebook where you can collect papers, attach original PDFs, author rich structured literature reviews (with diagrams, comparison tables, and LaTeX math), export clean multi-page A4 vector PDFs, and back up or restore your entire research library offline.

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
    [10 Unified Rich-Content Review Editors]
   (Text + Diagrams + Tables + LaTeX Equations)
                         │
                         ├──► [Formatted Preview & Vector A4 PDF Export]
                         └──► [Data Management: V2 Full ZIP Backup / Merge & Replace / JSON]
```

### Key Separation of Concerns
- **Research Paper Information is fixed after creation**: Bibliographic metadata (Title, Authors, Year, DOI/URL) and any attached original PDF file are immutable once saved, maintaining an accurate academic record.
- **Literature Review Notes are rich and freely editable**: Your analysis across all 10 structured dimensions can combine text, headings, code, links, embedded diagrams, editable comparison tables, and LaTeX equations in a single unified flow per section.

---

## 🚀 What's New in Version 1.2

### 1. Unified Rich Notes Editor Across All 10 Sections
- Built on locally vendored **Quill 2.0** (`js/rich-editor.js`) with **one independent unified editor per section**, preserving exact insertion order across mixed content:
  - **Rich Text & Structure**: Normal paragraph, H1–H3 headings, bold, italic, underline, strikethrough, bullet & numbered lists, blockquotes, horizontal dividers, hyperlinks, inline code / code blocks, undo & redo (`Ctrl+Z` / `Ctrl+Y`).
  - **Embedded Figures / Diagrams (`PNG`, `JPG/JPEG`, `WEBP`)**: Upload via toolbar, drag-and-drop, or clipboard paste. Includes size presets (`S` / `M` / `L` / `Full`) & corner drag resize preserving aspect ratio, `Left` / `Center` / `Right` alignment, optional **Figure Caption & Source** metadata, image replacement, and deletion. Binary blobs are stored cleanly in IndexedDB's `images` store (only lightweight `imageId` references are saved in note Delta JSON — never bloated Base64 strings).
  - **Interactive Comparison Tables**: Insert custom row/column tables with header row toggle, direct cell typing with `Tab`/`Shift+Tab` navigation, inline bold/italic/underline/code formatting in cells, contextual `+ Row`, `- Row`, `+ Col`, `- Col`, `Header` toggle, and horizontal scroll wrapper for wide tables.
  - **Mathematical Equations (LaTeX via KaTeX)**: Insert inline or display (`$$...$$`) equations with live KaTeX preview and quick symbol buttons, and click any rendered equation to re-edit its raw LaTeX source.
- **Reliable Autosave & Navigation Safety**: Debounced autosave (`1200ms`) waits for pending image writes and shows clear live status (`Saving...`, `Unsaved changes`, `Saved`, `Save failed`), plus `Ctrl+S` manual save and flush-before-export/navigation guards.
- **Formatted Read-Only Preview**: Clean academic reading view hydrating IndexedDB images, tables, formatted text, and rendered KaTeX equations.

### 2. Professional Layout-Aware Vector PDF Export (`pdfmake`)
- Generates clean, selectable multi-page **A4 PDFs** (`<SanitizedTitle>_Review_Notes.pdf`) via `js/pdf-export.js` and locally embedded Noto fonts (`NotoSans`, `NotoSansBengali`, `NotoSansMono`):
  - Full **English + Bengali Unicode** text shaping (including conjuncts and vowel marks) inside metadata banners, headings, paragraphs, code blocks, captions, and table cells.
  - Preserves exact block ordering across all 10 sections with clean page breaks (`dontBreakRows: true`, `keepWithHeaderRows: 1` & `headerRows: 1` repeating table headers across pages, `unbreakable: true` figure + caption groups).
  - Converts WEBP figures to PNG cleanly when needed and scales embedded images proportionally to printable page width.
  - Rasterizes inline & display KaTeX equations at high DPI with embedded KaTeX SVG fonts (no raw fallback LaTeX leaks), clickable hyperlinks, running headers, and `Page X of Y` footers.

### 3. Enhanced Portable Backup & Restore (Format V2 + Backward-Compatible V1)
- **Export Full Backup (.ZIP)** (`backupVersion: 2`):
  - Packages `backup-info.json`, `papers.json`, `notes.json`, `images.json`, `original-pdfs/`, and `images/`.
- **Import / Restore Backup (.ZIP)**:
  - Restores both **V2** archives and **legacy V1/V1.1** archives (automatically upgrading plain-text notes safely into structured Quill Delta format).
  - Supports **Merge with Existing Data** with per-paper conflict resolution (`Keep Existing` vs `Replace with Backup`), plus **Replace All Existing Data** with confirmation guard and quota-exceeded atomic protection.
- **Export Notes Only (.JSON)**: Exports paper bibliographic metadata, rich structured Delta notes (tables, raw LaTeX source, and image metadata references), clearly noting that binary PDFs and embedded image files require Full Backup (`.ZIP`).

### 4. Preserved V1.1 Capabilities
- Two paper creation workflows (**Add Manually** or **Upload Research Paper PDF** with client-side metadata extraction).
- Local binary original PDF storage (`pdfs` store) and one-click **"View Original PDF"** tab opening.

---

## 📚 10 Core Literature Review Dimensions

1. `01. Research Problem` — What problem are the researchers trying to solve?
2. `02. Research Objective` — What is the main objective or goal of this research?
3. `03. Dataset` — Dataset name, size, source, characteristics, and important data notes.
4. `04. Methodology / Proposed Method` — Proposed methodology, algorithms/models, main approach, details.
5. `05. Evaluation Protocol` — Train/test splits, validation strategy, baselines, setup.
6. `06. Evaluation Metrics` — Accuracy, Precision, Recall, F1, RMSE, MAE, or other relevant metrics.
7. `07. Key Findings` — Experimental results, discoveries, and contributions.
8. `08. Limitations` — Weaknesses, dataset/experimental limitations, unresolved problems.
9. `09. Future Work` — Future research directions suggested by the authors.
10. `10. My Critical Analysis & Research Opportunities` — Personal understanding, learnings, criticisms, research gaps, and ideas.

---

## 🛠️ Technology Stack

- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+).
- **Database**: Native Browser IndexedDB (`ResearchMateDB`, Version 3 — auto-migrates V1/V2 plain-text records cleanly on upgrade).
- **Rich Editor & Math**: `Quill 2.0.2` + `KaTeX` (all JS/CSS/woff2 fonts locally vendored).
- **PDF Generation**: `pdfmake 0.2.20` with embedded `NotoSans`, `NotoSansBengali`, and `NotoSansMono` fonts (locally vendored in `js/vendor/`).
- **ZIP Archiving**: `JSZip` (`js/vendor/jszip.min.js`).
- **Offline & Static Ready**: 100% browser-local; deploys directly to GitHub Pages or runs from any static HTTP server with zero backend/Node dependencies.

---

## 📂 Project Structure

```text
ResearchMate/
│
├── index.html                        # Application shell, views & editor modals
│
├── css/
│   ├── style.css                     # Academic minimal theme, rich editor & responsive layout
│   └── vendor/
│       ├── quill.snow.css            # Vendored Quill 2 theme stylesheet
│       ├── katex.min.css             # Vendored KaTeX stylesheet
│       └── fonts/                    # Local KaTeX woff2/woff/ttf font files
│
├── js/
│   ├── app.js                        # Navigation router, unsaved guards & Data Management UI
│   ├── database.js                   # IndexedDB V3 (papers, notes, pdfs, images, ZIP V1/V2 backup)
│   ├── rich-editor.js                # Unified Quill 2 editor, image store, tables & KaTeX math
│   ├── pdf-export.js                 # Vector A4 PDF exporter (pdfmake + KaTeX SVG + Noto fonts)
│   ├── papers.js                     # Manual entry, PDF upload, metadata extraction & viewing
│   ├── notes.js                      # 10-section editor controller, autosave & preview mode
│   └── vendor/
│       ├── jszip.min.js              # JSZip offline bundle
│       ├── quill.js                  # Quill 2.0.2 offline bundle
│       ├── katex.min.js              # KaTeX offline bundle
│       ├── katex-svg-style.js        # Embedded WOFF2 KaTeX CSS for SVG math export
│       ├── pdfmake.min.js            # pdfmake 0.2.20 vector PDF engine
│       └── pdf-fonts.js              # Compiled NotoSans, NotoSansBengali & NotoSansMono VFS
│
├── assets/
│   └── icons/
│       └── book.svg                  # Vector emblem
│
├── tests/                            # Automated verification suites (Headless Chrome)
│   ├── test_runner.html              # Core DB, V2->V3 migration, backup/restore & PDF tests
│   ├── e2e_runner.html               # End-to-end interactive UI, mobile & rich editor tests
│   ├── test_pdf.html                 # Multi-page V1.2 PDF generation verification fixture
│   ├── run.py                        # Python runner for core unit/integration tests
│   └── run_e2e.py                    # Python runner for E2E UI tests
│
├── start.bat                         # One-click Windows local server launcher
└── README.md                         # Documentation & operational guide
```

---

## 💻 How to Run Locally

### Method 1: Using `start.bat` (Windows)
Double-click `start.bat` in File Explorer. It launches a local Python HTTP server on `http://localhost:8000` and opens your browser.

### Method 2: Using Python
```powershell
cd d:\ResearchMate
python -m http.server 8000
```
Navigate to: `http://localhost:8000`

---

## 🗄️ How IndexedDB Stores the Data (Schema V3)

ResearchMate uses **IndexedDB** (`ResearchMateDB`, Version 3):

1. **`papers` Store** (`keyPath: 'id'`, indexes: `createdAt`, `title`, `authors`): Bibliographic metadata, `hasPdf`, `pdfFileName`, `pdfFileSize`.
2. **`notes` Store** (`keyPath: 'paperId'`, index: `updatedAt`): All 10 section fields stored as structured `{ format: 'quill-delta-v1', delta: { ops: [...] } }` objects (V1/V2 plain strings are normalized non-destructively during DB upgrade and load).
3. **`pdfs` Store** (`keyPath: 'paperId'`, indexes: `uploadedAt`, `fileName`): Original paper PDF binary `Blob`.
4. **`images` Store** (`keyPath: 'id'`, indexes: `paperId`, `sectionId`, `createdAt`): Embedded figure binary `Blob`s (`PNG`, `JPG/JPEG`, `WEBP`) with original filename, MIME type, dimensions, and byte size.

---

## 🧪 Automated Testing

Run both headless Chrome automated verification suites after changes:
```powershell
# 1. Run Core DB, Migration, Backup/Restore & PDF Export Tests
python tests/run.py

# 2. Run Interactive End-to-End Browser UI Workflow Tests
python tests/run_e2e.py
```

---

## ⚠️ Known Limitations & Considerations

1. **Browser Profile Sandbox**: Data lives locally in your browser's IndexedDB profile. Periodically use **Export Full Backup (.ZIP)** to keep an offline archive across machines/browsers.
2. **Immutable Bibliographic Info**: Paper metadata and attached original PDFs remain fixed after creation to preserve citation integrity.
3. **Notes-Only JSON Export Scope**: `.JSON` exports keep formatted text, tables, raw LaTeX source, and image reference metadata, but exclude binary PDFs and binary images; use **Export Full Backup (.ZIP)** for a complete transferable archive.
