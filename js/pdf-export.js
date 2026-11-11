/**
 * pdf-export.js - Individual PDF Generator for ResearchMate
 * Generates an elegant, publication-quality academic literature review PDF
 * for a specific research paper, containing the immutable paper metadata
 * and all 10 literature review analysis sections.
 * 
 * Supports Bengali and full Unicode seamlessly via html2pdf / jsPDF.
 */

(function () {
  'use strict';

  const SECTIONS = [
    {
      id: 'researchProblem',
      num: '01',
      title: 'Research Problem',
      guiding: 'What problem are the researchers trying to solve?'
    },
    {
      id: 'researchObjective',
      num: '02',
      title: 'Research Objective',
      guiding: 'What is the main objective or goal of this research?'
    },
    {
      id: 'dataset',
      num: '03',
      title: 'Dataset',
      guiding: 'Dataset name, size, source, characteristics, and important data notes.'
    },
    {
      id: 'methodology',
      num: '04',
      title: 'Methodology / Proposed Method',
      guiding: 'Proposed methodology, algorithms or models used, main approach, and implementation details.'
    },
    {
      id: 'evaluationProtocol',
      num: '05',
      title: 'Evaluation Protocol',
      guiding: 'Train/test split, validation strategy, cross-validation, experimental setup, baseline comparison.'
    },
    {
      id: 'evaluationMetrics',
      num: '06',
      title: 'Evaluation Metrics',
      guiding: 'Accuracy, Precision, Recall, F1-score, RMSE, MAE, or other relevant metrics.'
    },
    {
      id: 'keyFindings',
      num: '07',
      title: 'Key Findings',
      guiding: 'Main experimental results, important discoveries, contributions, and observations.'
    },
    {
      id: 'limitations',
      num: '08',
      title: 'Limitations',
      guiding: 'Weaknesses of proposed approach, dataset/experimental limitations, unresolved problems.'
    },
    {
      id: 'futureWork',
      num: '09',
      title: 'Future Work',
      guiding: 'Future research directions suggested by the authors.'
    },
    {
      id: 'criticalAnalysis',
      num: '10',
      title: 'My Critical Analysis & Research Opportunities',
      guiding: 'Personal understanding, learnings, potential improvements, criticisms, research gaps, and ideas.'
    }
  ];

  /**
   * Sanitizes a string for use in a safe filename.
   */
  function sanitizeFilename(title) {
    if (!title) return 'Paper_Analysis';
    // Remove characters illegal in filenames
    const clean = title
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 60);
    return clean || 'Paper_Analysis';
  }

  /**
   * Escapes HTML for safe injection into print template.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Formats text content preserving paragraphs and bullet points.
   */
  function formatContent(text) {
    if (!text || !text.trim()) {
      return '<div class="pdf-empty-section"><em>No notes recorded for this section.</em></div>';
    }
    const escaped = escapeHtml(text);
    // Replace newlines with <br> or wrap in paragraphs
    const paragraphs = escaped.split(/\n\s*\n/);
    return paragraphs
      .map(p => `<p class="pdf-paragraph">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  /**
   * Formats date nicely for academic documents.
   */
  function formatDate(isoString) {
    if (!isoString) return 'N/A';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Generates the printable HTML element for the paper.
   */
  function buildPrintElement(paper, notes) {
    const container = document.createElement('div');
    container.className = 'pdf-render-document';

    const safeTitle = escapeHtml(paper.title);
    const safeAuthors = escapeHtml(paper.authors);
    const safeYear = paper.year ? escapeHtml(paper.year) : 'Year not specified';
    const safeDoi = paper.doiUrl ? escapeHtml(paper.doiUrl) : null;
    const exportDate = formatDate(new Date().toISOString());
    const lastUpdated = formatDate(notes.updatedAt || paper.createdAt);

    let sectionsHtml = '';
    SECTIONS.forEach(sec => {
      const content = notes[sec.id];
      const hasContent = content && content.trim().length > 0;
      sectionsHtml += `
        <div class="pdf-section-block ${hasContent ? 'has-content' : 'is-empty'}">
          <div class="pdf-section-header">
            <span class="pdf-section-num">${sec.num}</span>
            <div class="pdf-section-title-wrap">
              <h2 class="pdf-section-title">${sec.title}</h2>
              <p class="pdf-section-guiding">${escapeHtml(sec.guiding)}</p>
            </div>
          </div>
          <div class="pdf-section-body">
            ${formatContent(content)}
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="pdf-page-container">
        <!-- Document Header / Watermark Banner -->
        <div class="pdf-doc-header">
          <div class="pdf-doc-branding">
            <span class="pdf-brand-title">ResearchMate</span>
            <span class="pdf-brand-tag">Literature Review Notebook</span>
          </div>
          <div class="pdf-doc-meta">
            <span>Exported: ${exportDate}</span>
          </div>
        </div>

        <!-- Academic Paper Meta Header Card -->
        <div class="pdf-paper-card">
          <h1 class="pdf-paper-title">${safeTitle}</h1>
          <div class="pdf-meta-grid">
            <div class="pdf-meta-item">
              <span class="pdf-meta-label">Author(s):</span>
              <span class="pdf-meta-value">${safeAuthors}</span>
            </div>
            <div class="pdf-meta-item">
              <span class="pdf-meta-label">Publication Year:</span>
              <span class="pdf-meta-value">${safeYear}</span>
            </div>
            ${
              safeDoi
                ? `
            <div class="pdf-meta-item pdf-meta-full">
              <span class="pdf-meta-label">DOI / URL:</span>
              <span class="pdf-meta-value"><a href="${safeDoi}" class="pdf-link">${safeDoi}</a></span>
            </div>
            `
                : ''
            }
            <div class="pdf-meta-item">
              <span class="pdf-meta-label">Notes Last Updated:</span>
              <span class="pdf-meta-value">${lastUpdated}</span>
            </div>
          </div>
        </div>

        <div class="pdf-analysis-divider">
          <span>Literature Review Analysis (10 Core Sections)</span>
        </div>

        <!-- 10 Sections -->
        <div class="pdf-sections-container">
          ${sectionsHtml}
        </div>

        <!-- Footer Notice -->
        <div class="pdf-doc-footer">
          <span>Generated by ResearchMate • Personal Academic Research &amp; Learning</span>
        </div>
      </div>
    `;

    return container;
  }

  /**
   * Main export method: downloads an individual PDF for the given paper and notes.
   * Uses html2pdf (with html2canvas & jsPDF) to ensure full Unicode / Bengali
   * rendering, automatic page splitting, and clean typography.
   * 
   * @param {Object} paper
   * @param {Object} notes
   * @returns {Promise<void>}
   */
  async function exportPaperNotesAsPDF(paper, notes) {
    if (!paper) {
      throw new Error('Paper record is required for PDF export.');
    }
    if (!notes) {
      notes = await window.ResearchMateDB.getNotesByPaperId(paper.id);
    }

    const filename = `ResearchMate_${sanitizeFilename(paper.title)}.pdf`;
    const renderNode = buildPrintElement(paper, notes);

    // Mount offscreen for rendering
    renderNode.style.position = 'fixed';
    renderNode.style.left = '-9999px';
    renderNode.style.top = '0';
    renderNode.style.width = '780px'; // optimal A4 portrait pixel width at 96 DPI
    renderNode.style.backgroundColor = '#ffffff';
    document.body.appendChild(renderNode);

    try {
      // Check if html2pdf is available
      if (typeof window.html2pdf === 'function') {
        const opt = {
          margin: [12, 12, 14, 12], // top, left, bottom, right (mm)
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            letterRendering: true,
            scrollX: 0,
            scrollY: 0
          },
          jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'portrait'
          },
          pagebreak: {
            mode: ['avoid-all', 'css', 'legacy']
          }
        };

        await window.html2pdf().set(opt).from(renderNode).save();
      } else if (window.jspdf && window.jspdf.jsPDF) {
        // Fallback: direct jsPDF vector renderer
        await generateDirectJsPDF(paper, notes, filename);
      } else {
        // Ultimate fallback: Browser Print Dialog
        fallbackPrintWindow(paper, notes);
      }
    } finally {
      // Clean up offscreen node
      if (renderNode.parentNode) {
        renderNode.parentNode.removeChild(renderNode);
      }
    }
  }

  /**
   * Fallback pure jsPDF vector export when html2pdf is unavailable.
   */
  async function generateDirectJsPDF(paper, notes, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    function checkPageBreak(spaceNeeded) {
      if (y + spaceNeeded > pageHeight - margin) {
        doc.addPage();
        y = margin;
        printRunningHeader();
      }
    }

    function printRunningHeader() {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 130);
      doc.text('ResearchMate — Personal Literature Review Notebook', margin, 10);
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, 12, pageWidth - margin, 12);
      y = Math.max(y, 16);
    }

    printRunningHeader();

    // Document Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(26, 86, 219); // Royal Blue
    doc.text('Literature Review Notes', margin, y);
    y += 8;

    // Paper Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    const splitTitle = doc.splitTextToSize(paper.title, contentWidth);
    doc.text(splitTitle, margin, y);
    y += splitTitle.length * 6 + 2;

    // Authors & Meta
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const metaText = `Author(s): ${paper.authors} | Year: ${paper.year || 'N/A'}`;
    doc.text(metaText, margin, y);
    y += 5;

    if (paper.doiUrl) {
      doc.setTextColor(37, 99, 235);
      const doiText = doc.splitTextToSize(`DOI/URL: ${paper.doiUrl}`, contentWidth);
      doc.text(doiText, margin, y);
      y += doiText.length * 4.5 + 2;
    }

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;

    // Iterate sections
    SECTIONS.forEach(sec => {
      checkPageBreak(25);

      // Section Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(`${sec.num}. ${sec.title}`, margin, y);
      y += 4.5;

      // Guiding question
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(110, 110, 110);
      const guidingLines = doc.splitTextToSize(sec.guiding, contentWidth);
      doc.text(guidingLines, margin, y);
      y += guidingLines.length * 3.5 + 3;

      // Section Content
      const content = (notes[sec.id] || '').trim();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);

      if (!content) {
        doc.setTextColor(160, 160, 160);
        doc.setFont('helvetica', 'italic');
        doc.text('No notes recorded for this section.', margin + 2, y);
        y += 7;
      } else {
        doc.setTextColor(40, 40, 40);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(content, contentWidth - 4);
        lines.forEach(line => {
          checkPageBreak(5);
          doc.text(line, margin + 2, y);
          y += 4.2;
        });
        y += 4;
      }

      // Sub-border
      checkPageBreak(4);
      doc.setDrawColor(240, 240, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    });

    // Add page numbers
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 15, pageHeight - 8);
    }

    doc.save(filename);
  }

  /**
   * Browser print window fallback.
   */
  function fallbackPrintWindow(paper, notes) {
    const renderNode = buildPrintElement(paper, notes);
    const win = window.open('', '_blank');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups to print/save your PDF.');
      return;
    }
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ResearchMate - ${escapeHtml(paper.title)}</title>
        <link rel="stylesheet" href="css/style.css">
        <style>
          body { background: white; margin: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .pdf-page-container { max-width: 800px; margin: 0 auto; }
        </style>
      </head>
      <body>
        ${renderNode.outerHTML}
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `);
    win.document.close();
  }

  // Expose PDF export module
  window.PDFExporter = {
    exportPaperNotesAsPDF,
    SECTIONS,
    sanitizeFilename
  };
})();

