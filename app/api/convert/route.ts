// app/api/convert/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, readFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import mammoth from 'mammoth';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { extractPdfInfo, extractTextWithPdfJs } from '@/lib/pdfExtractor';
// Hapus import langsung pdf-parse
// import pdfParse from 'pdf-parse';

const execPromise = promisify(exec);

export const config = {
    api: {
        bodyParser: false,
        responseLimit: '50mb',
    },
};

// Fungsi untuk mendapatkan pdf-parse secara dinamis
async function getPdfParser() {
    try {
        // Import pdf-parse secara dinamis saat dibutuhkan
        const pdfParseModule = await import('pdf-parse');
        return pdfParseModule.default || pdfParseModule;
    } catch (error) {
        console.error('Error loading pdf-parse:', error);
        throw new Error('Gagal memuat modul pdf-parse');
    }
}

// Tipe untuk hasil konversi file
interface ConversionResult {
    filePath: string;
    fileName: string;
    mimeType: string;
}

// Tipe untuk informasi file yang diupload
interface FileInfo {
    inputFilePath: string;
    originalName: string;
    fileExtension: string;
    conversionType: 'wordToPdf' | 'pdfToWord' | null;
    tempDir: string;
}

// Helper untuk menghasilkan nama file unik
function generateUniqueFileName(originalName: string, extension: string): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${timestamp}-${random}${extension}`;
}

// Helper untuk menentukan jenis konversi
function getConversionType(fileExtension: string): 'wordToPdf' | 'pdfToWord' | null {
    if (['.doc', '.docx'].includes(fileExtension.toLowerCase())) {
        return 'wordToPdf';
    }
    if (fileExtension.toLowerCase() === '.pdf') {
        return 'pdfToWord';
    }
    return null;
}

// Helper untuk memproses upload file multipart/form-data
async function processFileUpload(request: NextRequest): Promise<FileInfo> {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
        throw new Error('File tidak valid');
    }

    // Dapatkan ekstensi file
    const originalName = file.name;
    const fileExtension = path.extname(originalName);
    const conversionType = getConversionType(fileExtension);

    if (!conversionType) {
        throw new Error('Format file tidak didukung');
    }

    // Buat dan gunakan direktori temp khusus untuk konversi
    const tempBaseDir = os.tmpdir();
    const tempDir = path.join(tempBaseDir, `word-pdf-converter-${Date.now()}`);

    if (!existsSync(tempDir)) {
        await mkdir(tempDir, { recursive: true });
    }

    const inputFilePath = path.join(tempDir, generateUniqueFileName(originalName, fileExtension));

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputFilePath, buffer);

    return {
        inputFilePath,
        originalName,
        fileExtension,
        conversionType,
        tempDir,
    };
}

// Metode 1: Menggunakan LibreOffice untuk konversi (jika tersedia di server)
async function convertWordToPdfUsingLibreOffice(inputFilePath: string, tempDir: string): Promise<string> {
    try {
        // Periksa ketersediaan LibreOffice
        try {
            await execPromise('which libreoffice || which soffice');
        } catch (error) {
            throw new Error('LibreOffice tidak tersedia di server');
        }

        // Jalankan konversi menggunakan LibreOffice
        const command = `libreoffice --headless --convert-to pdf --outdir "${tempDir}" "${inputFilePath}"`;
        await execPromise(command);

        // LibreOffice menyimpan file dengan nama asli tetapi ekstensi yang berbeda
        const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
        const outputPath = path.join(tempDir, `${baseName}.pdf`);

        if (!existsSync(outputPath)) {
            throw new Error('Konversi gagal: File output tidak ditemukan');
        }

        return outputPath;
    } catch (error) {
        console.error('Error saat menggunakan LibreOffice:', error);
        throw new Error(`Gagal mengkonversi dengan LibreOffice: ${(error as Error).message}`);
    }
}

// Metode 2: Menggunakan mammoth + pdf-lib untuk konversi (jika LibreOffice tidak tersedia)
async function convertWordToPdfUsingMammoth(inputFilePath: string, tempDir: string): Promise<string> {
    try {
        // Ekstrak HTML dari dokumen Word menggunakan mammoth
        // const { value: htmlContent } = await mammoth.convertToHtml({ path: inputFilePath });

        // Ekstrak teks biasa dari dokumen Word untuk penempatan sederhana dalam PDF
        const { value: textContent } = await mammoth.extractRawText({ path: inputFilePath });

        // Buat PDF baru
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Fungsi helper untuk menambahkan halaman baru dengan teks (menggunakan function expression)
        const addTextPage = (text: string, title?: string): void => {
            const page = pdfDoc.addPage([595, 842]); // A4 size
            const { width, height } = page.getSize();

            const fontSize = 11;
            const lineHeight = fontSize * 1.2;
            let currentY = height - 50; // Mulai dari atas dengan margin

            // Tambahkan judul jika tersedia
            if (title) {
                page.drawText(title, {
                    x: 50,
                    y: currentY,
                    size: 16,
                    font: boldFont,
                    color: rgb(0, 0, 0),
                });
                currentY -= 30;
            }

            // Proses teks per baris
            const lines = text.split('\n');
            for (const line of lines) {
                // Jika baris kosong, tambahkan sedikit ruang
                if (line.trim() === '') {
                    currentY -= lineHeight;
                    continue;
                }

                // Bungkus teks yang panjang
                const words = line.split(' ');
                let currentLine = words[0] || '';

                for (let i = 1; i < words.length; i++) {
                    const word = words[i];
                    const testLine = `${currentLine} ${word}`;
                    const textWidth = font.widthOfTextAtSize(testLine, fontSize);

                    if (textWidth < width - 100) {
                        currentLine = testLine;
                    } else {
                        // Gambar baris saat ini dan mulai baris baru
                        page.drawText(currentLine, {
                            x: 50,
                            y: currentY,
                            size: fontSize,
                            font: font,
                            color: rgb(0, 0, 0),
                        });
                        currentY -= lineHeight;
                        currentLine = word;

                        // Jika kita mencapai bawah halaman, buat halaman baru
                        if (currentY < 50) {
                            // Buat halaman baru jika diperlukan
                            pdfDoc.addPage([595, 842]);
                            currentY = height - 50;
                        }
                    }
                }

                // Gambar sisa baris
                if (currentLine.trim()) {
                    page.drawText(currentLine, {
                        x: 50,
                        y: currentY,
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                    currentY -= lineHeight;
                }

                // Jika kita mencapai bawah halaman, buat halaman baru
                if (currentY < 50) {
                    // Buat halaman baru jika diperlukan
                    pdfDoc.addPage([595, 842]);
                    currentY = height - 50;
                }
            }
        };

        // Pecah konten menjadi halaman-halaman
        const textChunks = chunkText(textContent, 3000); // 3000 karakter per halaman

        // Tambahkan informasi konversi ke halaman pertama
        addTextPage(textChunks[0], 'Dokumen Word yang Dikonversi');

        // Tambahkan halaman tambahan jika diperlukan
        for (let i = 1; i < textChunks.length; i++) {
            addTextPage(textChunks[i]);
        }

        // Simpan PDF ke file
        const outputPath = path.join(tempDir, `converted-${Date.now()}.pdf`);
        const pdfBytes = await pdfDoc.save();
        await writeFile(outputPath, pdfBytes);

        return outputPath;
    } catch (error) {
        console.error('Error saat menggunakan mammoth:', error);
        throw new Error(`Gagal mengkonversi dengan mammoth: ${(error as Error).message}`);
    }
}

// Helper untuk membagi teks menjadi potongan-potongan
function chunkText(text: string, chunkSize: number): string[] {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks.length > 0 ? chunks : [''];
}

// Fungsi utama untuk mengkonversi Word ke PDF
async function convertWordToPdf(inputFilePath: string, originalName: string, tempDir: string): Promise<ConversionResult> {
    let outputFilePath: string;

    // Coba metode LibreOffice terlebih dahulu
    try {
        outputFilePath = await convertWordToPdfUsingLibreOffice(inputFilePath, tempDir);
    } catch (libreOfficeError) {
        console.log('LibreOffice tidak tersedia atau gagal, beralih ke mammoth:', libreOfficeError);
        // Jika LibreOffice gagal, gunakan metode mammoth + pdf-lib
        outputFilePath = await convertWordToPdfUsingMammoth(inputFilePath, tempDir);
    }

    const outputFileName = originalName.replace(/\.docx?$/, '.pdf');

    return {
        filePath: outputFilePath,
        fileName: outputFileName,
        mimeType: 'application/pdf',
    };
}

// Fungsi untuk mengkonversi PDF ke Word menggunakan LibreOffice
async function convertPdfToWordUsingLibreOffice(inputFilePath: string, tempDir: string): Promise<string> {
    try {
        // Periksa ketersediaan LibreOffice
        try {
            await execPromise('which libreoffice || which soffice');
        } catch (error) {
            throw new Error('LibreOffice tidak tersedia di server');
        }

        // Jalankan konversi menggunakan LibreOffice
        const command = `libreoffice --headless --convert-to docx --outdir "${tempDir}" "${inputFilePath}"`;
        await execPromise(command);

        // LibreOffice menyimpan file dengan nama asli tetapi ekstensi yang berbeda
        const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
        const outputPath = path.join(tempDir, `${baseName}.docx`);

        if (!existsSync(outputPath)) {
            throw new Error('Konversi gagal: File output tidak ditemukan');
        }

        return outputPath;
    } catch (error) {
        console.error('Error saat menggunakan LibreOffice untuk PDF ke Word:', error);
        throw new Error(`Gagal mengkonversi dengan LibreOffice: ${(error as Error).message}`);
    }
}

// Fungsi untuk mengekstrak teks dari PDF menggunakan pdf-lib
async function extractTextFromPdfUsingPdfLib(pdfPath: string): Promise<string[]> {
    try {
        const pdfBuffer = await readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBuffer);

        const numPages = pdfDoc.getPageCount();
        const result: string[] = [];

        // Tambahkan informasi dasar dokumen
        result.push("Dokumen PDF");
        result.push(`Jumlah halaman: ${numPages}`);
        result.push("");

        // Dapatkan metadata jika tersedia
        const title = pdfDoc.getTitle();
        const author = pdfDoc.getAuthor();
        const subject = pdfDoc.getSubject();
        const keywords = pdfDoc.getKeywords();

        if (title) result.push(`Judul: ${title}`);
        if (author) result.push(`Penulis: ${author}`);
        if (subject) result.push(`Subjek: ${subject}`);
        if (keywords) result.push(`Kata Kunci: ${keywords}`);

        result.push("");
        result.push("-- Konten Dokumen --");
        result.push("");

        // PDF-lib tidak memiliki fitur ekstraksi teks,
        // jadi kita hanya akan menambahkan informasi halaman dasar
        for (let i = 0; i < numPages; i++) {
            result.push(`-- Halaman ${i + 1} --`);
            const page = pdfDoc.getPage(i);
            const { width, height } = page.getSize();
            result.push(`Ukuran halaman: ${width.toFixed(2)} x ${height.toFixed(2)} points`);
            result.push("");
        }

        return result;
    } catch (error) {
        console.error('Error saat mengekstrak teks dengan pdf-lib:', error);
        return [`Error saat mengekstrak teks: ${(error as Error).message}`];
    }
}

// Fungsi untuk mengekstrak teks dari PDF menggunakan pdf-parse
async function extractTextFromPdf(pdfPath: string): Promise<string[]> {
    try {
        // Baca file PDF
        const pdfBuffer = await readFile(pdfPath);

        try {
            // Gunakan pdf-parse secara dinamis
            const pdfParse = await getPdfParser();
            const data = await pdfParse(pdfBuffer, {
                // Opsi untuk menghindari masalah dengan file test
                max: 0, // Tidak ada batas halaman
                version: 'ignore' // Coba abaikan pemeriksaan versi
            });

            // Memecah teks menjadi baris-baris
            const lines = data.text.split('\n');

            // Membersihkan baris kosong berlebih
            const cleanedLines = [];
            let consecutiveEmptyLines = 0;

            for (const line of lines) {
                if (line.trim() === '') {
                    consecutiveEmptyLines++;
                    // Hanya simpan satu baris kosong
                    if (consecutiveEmptyLines <= 1) {
                        cleanedLines.push('');
                    }
                } else {
                    consecutiveEmptyLines = 0;
                    cleanedLines.push(line);
                }
            }

            return cleanedLines.length > 0 ? cleanedLines : ["Tidak ada teks yang dapat diekstrak dari PDF"];
        } catch (pdfParseError) {
            // Jika pdf-parse gagal, coba menggunakan pdfjs-dist
            console.error('PDF-parse error, beralih ke pdfjs-dist:', pdfParseError);

            try {
                // Gunakan fungsi ekstraksi dari pdfExtractor.ts
                return await extractTextWithPdfJs(pdfBuffer);
            } catch (pdfjsError) {
                console.error('pdfjs-dist error, beralih ke pdf-lib:', pdfjsError);
                // Jika pdfjs juga gagal, gunakan pdf-lib sebagai fallback terakhir
                return await extractPdfInfo(pdfBuffer);
            }
        }
    } catch (error) {
        console.error('Error saat mengekstrak teks dari PDF:', error);
        return [`Error saat mengekstrak teks: ${(error as Error).message}`];
    }
}

// Fungsi untuk mengkonversi PDF ke Word menggunakan pdf-parse dan docx
async function convertPdfToWordUsingPdfParse(inputFilePath: string, tempDir: string): Promise<string> {
    try {
        debugLog(`Mulai konversi PDF ke Word: ${inputFilePath}`);

        // Coba ekstrak teks dari PDF menggunakan beberapa metode
        let textLines: string[] = [];
        let extractionMethod = "pdf-parse";

        try {
            // Coba metode utama: pdf-parse
            textLines = await extractTextFromPdf(inputFilePath);
            debugLog(`Berhasil mengekstrak ${textLines.length} baris teks menggunakan pdf-parse`);

            // Periksa apakah hasil ekstraksi sebenarnya berisi teks yang bermakna
            if (textLines.length <= 3 && textLines.some(line => line.includes("Tidak ada teks yang dapat diekstrak"))) {
                debugLog("Hasil ekstraksi pdf-parse menunjukkan tidak ada teks yang bermakna, coba metode alternatif");
                throw new Error("Tidak ada teks bermakna yang diekstrak");
            }
        } catch (e) {
            extractionMethod = "pdfjs";
            debugLog("Beralih ke ekstraksi menggunakan pdfjs-dist");

            try {
                // Impor modul ekstraksi alternatif jika belum ada
                if (typeof extractTextWithPdfJs !== "function") {
                    // Jika fungsi tidak tersedia di lingkup global, impor dari modul
                    const pdfExtractor = await import('@/lib/pdfExtractor');
                    const pdfBuffer = await readFile(inputFilePath);
                    textLines = await pdfExtractor.extractTextWithPdfJs(pdfBuffer);
                } else {
                    // Jika fungsi sudah tersedia
                    const pdfBuffer = await readFile(inputFilePath);
                    textLines = await extractTextWithPdfJs(pdfBuffer);
                }
                debugLog(`Berhasil mengekstrak ${textLines.length} baris teks menggunakan pdfjs-dist`);
            } catch (pdfJsError) {
                extractionMethod = "pdf-lib";
                debugLog("Beralih ke ekstraksi dasar menggunakan pdf-lib");
                textLines = await extractTextFromPdfUsingPdfLib(inputFilePath);
            }
        }

        // Tampilkan sampel teks untuk debugging
        if (textLines.length > 0) {
            debugLog("Sampel konten yang diekstrak:");
            const sampleSize = Math.min(5, textLines.length);
            for (let i = 0; i < sampleSize; i++) {
                debugLog(`  ${i + 1}: ${textLines[i]}`);
            }
        }

        // Buat array paragraf untuk dokumen
        const paragraphs = [];

        // Paragraf judul
        paragraphs.push(
            new Paragraph({
                text: "Dokumen Hasil Konversi PDF",
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: {
                    after: 200,
                }
            })
        );

        // Tambahkan informasi tentang metode ekstraksi yang digunakan
        paragraphs.push(
            new Paragraph({
                text: `File PDF dikonversi menggunakan metode: ${extractionMethod}`,
                alignment: AlignmentType.CENTER,
                spacing: {
                    after: 200,
                }
            })
        );

        // Fungsi untuk mendeteksi heading - mengubah ke arrow function
        const isHeading = (line: string): boolean => {
            // Heading biasanya lebih pendek dan mungkin diakhiri dengan titik dua
            return line.trim().length < 60 &&
                // Heading biasanya dimulai dengan huruf kapital
                /^[A-Z]/.test(line.trim()) &&
                // Heading tidak diakhiri dengan tanda baca selain titik dua atau titik
                (!line.trim().endsWith('.') || line.trim().endsWith(':'));
        };

        // Tambahkan setiap baris teks sebagai paragraf
        for (const line of textLines) {
            if (line.trim() === '') {
                // Tambahkan spasi untuk baris kosong
                paragraphs.push(
                    new Paragraph({
                        text: "",
                        spacing: {
                            after: 100,
                        }
                    })
                );
            } else if (isHeading(line) ||
                (line.trim().length < 50 && line.trim().endsWith(':')) ||
                line.trim().startsWith('--') && line.trim().endsWith('--')) {
                // Ini adalah heading
                paragraphs.push(
                    new Paragraph({
                        text: line,
                        heading: HeadingLevel.HEADING_2,
                        spacing: {
                            before: 200,
                            after: 100,
                        }
                    })
                );
            } else {
                // Tambahkan sebagai paragraf normal
                paragraphs.push(
                    new Paragraph({
                        text: line,
                    })
                );
            }
        }

        // Tambahkan catatan di akhir
        paragraphs.push(
            new Paragraph({
                text: "",
                spacing: {
                    before: 200,
                }
            })
        );

        paragraphs.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Catatan: ",
                        bold: true,
                    }),
                    new TextRun("Dokumen ini dihasilkan dari konversi PDF. Beberapa format mungkin hilang dalam proses konversi. ")
                ],
                spacing: {
                    before: 200,
                }
            })
        );

        // Tambahkan informasi tambahan jika menggunakan metode fallback
        if (extractionMethod !== "pdf-parse") {
            paragraphs.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "Penggunaan LibreOffice ",
                            bold: true
                        }),
                        new TextRun("untuk konversi PDF ke Word menghasilkan kualitas yang lebih baik dengan mempertahankan format dan tata letak.")
                    ],
                    spacing: {
                        before: 100,
                    }
                })
            );
        }

        // Buat dokumen Word dengan semua paragraf
        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs
            }],
        });

        // Simpan dokumen Word
        const outputFileName = `converted-${Date.now()}.docx`;
        const outputFilePath = path.join(tempDir, outputFileName);

        // debugLog(`Menyimpan hasil konversi ke: ${outputFilePath}`);
        const buffer = await Packer.toBuffer(doc);
        await writeFile(outputFilePath, buffer);

        // debugLog("Konversi PDF ke Word selesai");
        return outputFilePath;
    } catch (error) {
        console.error('Error saat menggunakan pdf-parse untuk konversi:', error);
        throw new Error(`Gagal mengkonversi PDF ke Word: ${(error as Error).message}`);
    }
}

// Fungsi utama untuk mengkonversi PDF ke Word
async function convertPdfToWord(inputFilePath: string, originalName: string, tempDir: string): Promise<ConversionResult> {
    let outputFilePath: string;

    // Coba metode LibreOffice terlebih dahulu
    try {
        outputFilePath = await convertPdfToWordUsingLibreOffice(inputFilePath, tempDir);
    } catch (libreOfficeError) {
        console.log('LibreOffice tidak tersedia atau gagal untuk PDF ke Word, beralih ke metode alternatif:', libreOfficeError);
        // Jika LibreOffice gagal, gunakan metode alternatif
        outputFilePath = await convertPdfToWordUsingPdfParse(inputFilePath, tempDir);
    }

    const outputFileName = originalName.replace(/\.pdf$/, '.docx');

    return {
        filePath: outputFilePath,
        fileName: outputFileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
}

// Helper untuk membaca file
async function readFileBuffer(filePath: string): Promise<Buffer> {
    try {
        return await readFile(filePath);
    } catch (error) {
        throw new Error(`Gagal membaca file: ${(error as Error).message}`);
    }
}

// Helper untuk membersihkan file sementara
async function cleanupTempFiles(tempDir: string, filePaths: string[]) {
    try {
        // Hapus file-file individu
        for (const filePath of filePaths) {
            await unlink(filePath).catch(() => { });
        }

        // Coba hapus direktori tempDir jika kosong
        // Ini bisa gagal jika direktori tidak kosong
        await rmdir(tempDir).catch(() => { });
    } catch (error) {
        console.error('Error saat membersihkan file sementara:', error);
    }
}

// Helper untuk menghapus direktori
async function rmdir(dirPath: string) {
    try {
        // Gunakan rmdir untuk menghapus direktori
        await execPromise(`rmdir "${dirPath}"`);
    } catch (error) {
        // Diabaikan jika direktori tidak kosong atau tidak ada
    }
}

export async function POST(request: NextRequest) {
    try {
        // Proses upload file
        const { inputFilePath, originalName, conversionType, tempDir } = await processFileUpload(request);

        let result: ConversionResult;

        // Konversi file berdasarkan jenisnya
        if (conversionType === 'wordToPdf') {
            result = await convertWordToPdf(inputFilePath, originalName, tempDir);
        } else if (conversionType === 'pdfToWord') {
            result = await convertPdfToWord(inputFilePath, originalName, tempDir);
        } else {
            throw new Error('Jenis konversi tidak didukung');
        }

        // Baca file hasil konversi
        let fileBuffer: Buffer;
        try {
            fileBuffer = await readFileBuffer(result.filePath);
        } catch (readError) {
            throw new Error(`Gagal membaca file hasil konversi: ${(readError as Error).message}`);
        }

        // Bersihkan file sementara
        cleanupTempFiles(tempDir, [inputFilePath, result.filePath]);

        // Buat response - Pastikan header yang benar
        const response = new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': result.mimeType,
                'Content-Disposition': `attachment; filename=${encodeURIComponent(result.fileName)}`,
                'Cache-Control': 'no-store',
            },
        });

        return response;
    } catch (error) {
        console.error('Error konversi file:', error);

        // Selalu kembalikan respons JSON untuk error dengan header yang eksplisit
        return NextResponse.json(
            { error: (error as Error).message || 'Terjadi kesalahan saat mengkonversi file' },
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                }
            }
        );
    }
}

function debugLog(arg0: string) {
    throw new Error('Function not implemented.');
}
