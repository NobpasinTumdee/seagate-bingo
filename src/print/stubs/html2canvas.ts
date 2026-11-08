// jsPDF lazily imports html2canvas only for doc.html(). This app draws PDFs as vectors and never
// calls doc.html(), so the real library (~200 kB) is aliased away in vite.config.ts.
export default function html2canvas(): never {
  throw new Error('html2canvas is excluded from this build (PDFs are drawn as vectors)');
}
