// app/lib/pdfExtractor.ts
import { PDFDocument } from 'pdf-lib';

/**
 * Fungsi untuk mengekstrak teks dari PDF menggunakan pdfjs-dist
 * Ini adalah alternatif yang lebih baik jika pdf-parse tidak bekerja
 * @param pdfBuffer Buffer dari file PDF
 * @returns Array baris teks yang diekstrak
 */
export async function extractTextWithPdfJs(pdfBuffer: Buffer): Promise<string[]> {
  try {
    // Import modul secara dinamis
    const pdfjsLib = await import('pdfjs-dist');
    
    // Konfigurasi worker menggunakan URL CDN sebagai pengganti file lokal
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    
    // Muat dokumen
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;
    
    const numPages = pdf.numPages;
    const extractedText: string[] = [];
    
    extractedText.push(`Dokumen PDF - ${numPages} halaman`);
    extractedText.push("");
    
    // Proses tiap halaman
    for (let i = 1; i <= numPages; i++) {
      extractedText.push(`-- Halaman ${i} --`);
      
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Kelompokkan teks per baris
      let lastY: number | null = null;
      let currentLine = "";
      
      for (const item of content.items) {
        // Dengan transformasi untuk koreksi posisi
        // Gunakan type casting untuk mengakses properti
        const itemAny = item as any;
        const text = itemAny.str || '';
        const y = itemAny.transform ? itemAny.transform[5] : null;
        
        if (lastY !== null && y !== lastY) {
          // Tambahkan baris ke hasil
          if (currentLine.trim()) {
            extractedText.push(currentLine);
          }
          currentLine = text;
        } else {
          currentLine += text;
        }
        
        lastY = y;
      }
      
      // Tambahkan baris terakhir
      if (currentLine.trim()) {
        extractedText.push(currentLine);
      }
      
      extractedText.push("");
    }
    
    // Filter baris kosong berlebih
    const result = [];
    let consecutiveEmptyLines = 0;
    
    for (const line of extractedText) {
      if (line.trim() === '') {
        consecutiveEmptyLines++;
        if (consecutiveEmptyLines <= 1) {
          result.push('');
        }
      } else {
        consecutiveEmptyLines = 0;
        result.push(line);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error saat menggunakan pdfjs-dist:', error);
    return [
      "Error saat mengekstrak teks dengan pdfjs-dist.",
      `Error: ${(error as Error).message}`,
      "",
      "Silakan mencoba metode konversi lain atau pastikan PDF valid."
    ];
  }
}

/**
 * Fungsi sederhana untuk mengekstrak metadata dari PDF menggunakan pdf-lib.
 * Fungsi ini dapat digunakan sebagai alternatif jika pdf-parse dan pdfjs-dist bermasalah
 * @param pdfBuffer Buffer dari file PDF
 * @returns Informasi yang diekstrak sebagai array string
 */
export async function extractPdfInfo(pdfBuffer: Buffer): Promise<string[]> {
  try {
    // Load PDF document menggunakan pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    // Dapatkan informasi dasar
    const numPages = pdfDoc.getPageCount();
    const title = pdfDoc.getTitle();
    const author = pdfDoc.getAuthor();
    const subject = pdfDoc.getSubject();
    const keywords = pdfDoc.getKeywords();
    const creator = pdfDoc.getCreator();
    const producer = pdfDoc.getProducer();
    
    // Bangun array hasil
    const result: string[] = [];
    
    // Tambahkan informasi dokumen
    result.push("DOKUMEN PDF");
    result.push("============");
    result.push("");
    
    if (title) result.push(`Judul: ${title}`);
    if (author) result.push(`Penulis: ${author}`);
    if (subject) result.push(`Subjek: ${subject}`);
    if (keywords) result.push(`Kata Kunci: ${keywords}`);
    if (creator) result.push(`Dibuat dengan: ${creator}`);
    if (producer) result.push(`Diproduksi oleh: ${producer}`);
    
    result.push("");
    result.push(`Jumlah halaman: ${numPages}`);
    result.push("");
    
    // Tambahkan informasi untuk setiap halaman
    for (let i = 0; i < numPages; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      
      result.push(`HALAMAN ${i + 1}`);
      result.push(`Ukuran: ${width.toFixed(0)} x ${height.toFixed(0)} points`);
      result.push(""); 
      
      // Pdf-lib tidak bisa mengekstrak teks, jadi kita tambahkan placeholder
      result.push("Konten dokumen tidak dapat diekstrak secara lengkap.");
      result.push("Silakan lihat dokumen PDF asli untuk melihat konten lengkap.");
      result.push("");
    }
    
    result.push("============");
    result.push("Catatan: Konversi PDF ke Word menggunakan pdf-lib memiliki keterbatasan");
    result.push("karena pdf-lib tidak dapat mengekstrak teks dari dokumen PDF.");
    result.push("Untuk hasil terbaik, instal LibreOffice di server atau gunakan layanan konversi online.");
    
    return result;
  } catch (error) {
    console.error('Error saat mengekstrak informasi PDF:', error);
    return [
      "Terjadi kesalahan saat mengekstrak informasi PDF",
      `Error: ${(error as Error).message}`,
      "",
      "Silakan mencoba kembali dengan file PDF yang valid."
    ];
  }
}