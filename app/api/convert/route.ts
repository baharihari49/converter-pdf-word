// app/api/convert/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as fsPromises from 'fs/promises'; // Impor keseluruhan modul fs/promises sebagai fsPromises
import path from 'path';
import os from 'os';
import mammoth from 'mammoth';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { extractPdfInfo, extractTextWithPdfJs } from '@/lib/pdfExtractor';

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
    fileContent?: string; // Opsional, untuk metode berbasis memori
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

    // Buat direktori temporer yang dapat ditulis
    const tempDir = await createWritableDirectory();

    const inputFilePath = path.join(tempDir, generateUniqueFileName(originalName, fileExtension));

    const buffer = Buffer.from(await file.arrayBuffer());
    await fsPromises.writeFile(inputFilePath, buffer);

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

// Fungsi utama untuk mengkonversi Word ke PDF
async function convertWordToPdf(inputFilePath: string, originalName: string, tempDir: string): Promise<ConversionResult> {
    let outputFilePath: string;

    outputFilePath = await convertWordToPdfUsingLibreOffice(inputFilePath, tempDir);

    const outputFileName = originalName.replace(/\.docx?$/, '.pdf');

    return {
        filePath: outputFilePath,
        fileName: outputFileName,
        mimeType: 'application/pdf',
    };
}

// Fungsi untuk konversi PDF ke Word menggunakan LibreOffice
async function convertPdfToWordUsingLibreOffice(inputFilePath: string, tempDir: string): Promise<string> {
    try {
        // Periksa ketersediaan LibreOffice
        let libreOfficePath;
        try {
            // Coba temukan path ke executable LibreOffice
            const { stdout } = await execPromise('which libreoffice || which soffice');
            libreOfficePath = stdout.trim();
            console.log(`LibreOffice ditemukan di: ${libreOfficePath}`);

            if (!libreOfficePath) {
                throw new Error('LibreOffice tidak ditemukan');
            }
        } catch (error) {
            console.error('Error saat mencari LibreOffice:', error);
            throw new Error('LibreOffice tidak tersedia di server');
        }

        // Periksa keberadaan file input
        if (!existsSync(inputFilePath)) {
            throw new Error(`File input tidak ditemukan: ${inputFilePath}`);
        }

        // Periksa izin file input
        try {
            await fsPromises.access(inputFilePath, fsPromises.constants.R_OK);
            console.log(`File input ${inputFilePath} dapat dibaca`);

            // Memeriksa ukuran file
            const stats = await fsPromises.stat(inputFilePath);
            console.log(`Ukuran file input: ${stats.size} bytes`);

            if (stats.size === 0) {
                throw new Error('File input kosong');
            }
        } catch (error) {
            console.error(`Error saat memeriksa file input:`, error);
            throw new Error(`File input tidak dapat diakses: ${(error as Error).message}`);
        }

        // Jalankan konversi menggunakan LibreOffice
        const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
        const outputFileName = `${baseName}.docx`;
        const outputPath = path.join(tempDir, outputFileName);

        // Hapus file output yang sudah ada (jika ada)
        if (existsSync(outputPath)) {
            await fsPromises.unlink(outputPath);
            console.log(`File output lama dihapus: ${outputPath}`);
        }

        // Salin file ke direktori temporer untuk menghindari masalah izin
        const tempInputPath = path.join(tempDir, `input-${Date.now()}.pdf`);
        await fsPromises.copyFile(inputFilePath, tempInputPath);
        console.log(`File input disalin ke: ${tempInputPath}`);

        // Command untuk mengonversi PDF ke Word (docx)
        // Gunakan opsi infilter yang spesifik untuk PDF
        const command = `${libreOfficePath} --headless --infilter="writer_pdf_import" --convert-to docx --outdir "${tempDir}" "${tempInputPath}"`;
        console.log(`Menjalankan perintah: ${command}`);

        // Eksekusi perintah dengan timeout lebih lama
        const { stdout, stderr } = await execPromise(command, { timeout: 60000 });
        console.log('LibreOffice stdout:', stdout);

        if (stderr) {
            console.error('LibreOffice stderr:', stderr);
        }

        // Tunggu sebentar untuk memastikan file sudah selesai ditulis
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Salin file output ke lokasi yang diharapkan jika namanya berbeda
        const expectedOutputPath = path.join(tempDir, path.basename(tempInputPath, '.pdf') + '.docx');
        if (existsSync(expectedOutputPath) && expectedOutputPath !== outputPath) {
            await fsPromises.copyFile(expectedOutputPath, outputPath);
            console.log(`File output disalin dari ${expectedOutputPath} ke ${outputPath}`);
        }

        // Periksa apakah file output ada
        if (!existsSync(outputPath)) {
            console.error(`File output tidak ditemukan di: ${outputPath}`);

            // Coba cari file di direktori temporer
            const files = await fsPromises.readdir(tempDir);
            console.log(`File di direktori temporer: ${files.join(', ')}`);

            // Cek apakah ada file dengan ekstensi .docx di direktori temporer
            const docxFiles = files.filter(file => file.endsWith('.docx'));
            if (docxFiles.length > 0) {
                // Gunakan file .docx pertama yang ditemukan
                const foundDocx = path.join(tempDir, docxFiles[0]);
                console.log(`Menemukan file docx alternatif: ${foundDocx}`);
                return foundDocx;
            }

            throw new Error('Konversi gagal: File output tidak ditemukan');
        }

        // Periksa ukuran file output
        const outputStats = await fsPromises.stat(outputPath);
        console.log(`Konversi berhasil, file output: ${outputPath}, ukuran: ${outputStats.size} bytes`);

        if (outputStats.size === 0) {
            throw new Error('File output kosong');
        }

        return outputPath;
    } catch (error) {
        console.error('Error saat menggunakan LibreOffice untuk PDF ke Word:', error);
        throw new Error(`Gagal mengkonversi dengan LibreOffice: ${(error as Error).message}`);
    }
}

async function createWritableDirectory(): Promise<string> {
    // Catat pesan debug untuk melihat apa yang terjadi
    console.log('Mencoba membuat direktori yang dapat ditulis...');
    try {
        console.log('User saat ini:', (await execPromise('whoami')).stdout.trim());
        console.log('Grup user:', (await execPromise('groups')).stdout.trim());
    } catch (e) {
        console.log('Tidak dapat mendapatkan info user:', e);
    }

    // Coba tambahkan informasi tentang error yang spesifik untuk setiap lokasi
    const logDirectoryError = async (dir: string, error: any) => {
        console.error(`Gagal menggunakan direktori ${dir}:`, error);

        try {
            // Periksa keberadaan direktori
            const exists = existsSync(dir);
            console.error(`- Direktori ${exists ? 'ada' : 'tidak ada'}`);

            if (exists) {
                // Periksa izin
                try {
                    const { stdout: permissions } = await execPromise(`ls -la ${dir}`);
                    console.error(`- Izin: ${permissions}`);
                } catch (e) {
                    console.error('- Tidak dapat membaca izin');
                }

                // Periksa ruang disk
                try {
                    const { stdout: diskSpace } = await execPromise(`df -h ${dir}`);
                    console.error(`- Ruang disk: ${diskSpace}`);
                } catch (e) {
                    console.error('- Tidak dapat membaca ruang disk');
                }
            }

            // Periksa direktori parent
            const parentDir = path.dirname(dir);
            const parentExists = existsSync(parentDir);
            console.error(`- Direktori parent ${parentExists ? 'ada' : 'tidak ada'}`);

            if (parentExists) {
                try {
                    const { stdout: parentPermissions } = await execPromise(`ls -la ${parentDir}`);
                    console.error(`- Izin parent: ${parentPermissions}`);
                } catch (e) {
                    console.error('- Tidak dapat membaca izin parent');
                }
            }
        } catch (debugError) {
            console.error('Error saat mencoba debug:', debugError);
        }
    };

    // 1. Coba gunakan variabel lingkungan yang dikonfigurasi pengguna (paling banyak disukai)
    const configuredTempDir = process.env.PDF_CONVERTER_TEMP_DIR;
    if (configuredTempDir) {
        try {
            const timestamp = Date.now();
            const dirPath = path.join(configuredTempDir, `job-${timestamp}`);

            // Pastikan direktori basis ada
            if (!existsSync(configuredTempDir)) {
                await fsPromises.mkdir(configuredTempDir, { recursive: true, mode: 0o777 });
            }

            await fsPromises.mkdir(dirPath, { recursive: true, mode: 0o777 });

            // Verifikasi dengan file test
            const testFile = path.join(dirPath, 'test-write.txt');
            await fsPromises.writeFile(testFile, 'Test write permission');
            await fsPromises.unlink(testFile);

            console.log(`Menggunakan direktori konfigurasi: ${dirPath}`);
            return dirPath;
        } catch (error) {
            await logDirectoryError(configuredTempDir, error);
            console.error('Gagal menggunakan direktori yang dikonfigurasi pengguna:', error);
        }
    }

    // 2. Coba direktori aplikasi saat ini (lokasi yang sangat mungkin dapat ditulis)
    try {
        const appDir = process.cwd();
        console.log('Direktori aplikasi saat ini:', appDir);

        const tempDir = path.join(appDir, 'temp-files', Date.now().toString());

        // Pastikan direktori parent ada
        const parentDir = path.join(appDir, 'temp-files');
        if (!existsSync(parentDir)) {
            await fsPromises.mkdir(parentDir, { recursive: true, mode: 0o777 });
        }

        await fsPromises.mkdir(tempDir, { recursive: true, mode: 0o777 });

        // Verifikasi dengan file test
        const testFile = path.join(tempDir, 'test-write.txt');
        await fsPromises.writeFile(testFile, 'Test write permission');
        await fsPromises.unlink(testFile);

        console.log(`Berhasil membuat direktori di app dir: ${tempDir}`);
        return tempDir;
    } catch (error) {
        const appDir = process.cwd();
        await logDirectoryError(path.join(appDir, 'temp-files'), error);
        console.error('Gagal membuat direktori di app dir:', error);
    }

    // 3. Coba lokasi lain satu per satu dan catat error spesifik
    const potentialLocations = [
        { name: 'var-tmp', path: '/var/tmp/pdf-converter' },
        { name: 'tmp', path: '/tmp/pdf-converter' },
        { name: 'home', path: os.homedir() ? path.join(os.homedir(), '.tmp') : null },
        { name: 'os-tmp', path: os.tmpdir() },
        { name: 'run-tmp', path: '/run/user/1000/pdf-converter' }, // Untuk user 1000
        { name: 'dev-shm', path: '/dev/shm/pdf-converter' }        // RAM-based filesystem
    ];

    for (const location of potentialLocations) {
        if (!location.path) continue;

        try {
            const timestamp = Date.now();
            const dirPath = path.join(location.path, `job-${timestamp}`);

            // Buat direktori parent jika tidak ada
            if (!existsSync(location.path)) {
                await fsPromises.mkdir(location.path, { recursive: true, mode: 0o777 });
            }

            // Buat subdirektori dengan timestamp
            await fsPromises.mkdir(dirPath, { recursive: true, mode: 0o777 });

            // Verifikasi dengan file test
            const testFile = path.join(dirPath, 'test-write.txt');
            await fsPromises.writeFile(testFile, 'Test write permission');
            await fsPromises.unlink(testFile);

            console.log(`Berhasil membuat direktori di ${location.name}: ${dirPath}`);
            return dirPath;
        } catch (error) {
            await logDirectoryError(location.path, error);
            console.error(`Gagal membuat direktori di ${location.name}:`, error);
        }
    }

    // 4. Solusi "inline" (simpan file sementara di memory dan gunakan nama acak)
    console.log('Mencoba solusi inline memory...');
    try {
        // Gunakan teknik memory-based yang tidak bergantung pada filesystem
        // Nilai kembali adalah flag khusus untuk penangan inline
        return 'MEMORY_BASED_CONVERSION';
    } catch (error) {
        console.error('Bahkan solusi inline memory juga gagal:', error);
    }

    // 5. Jika semua gagal, coba ubah izin /tmp secara paksa (hanya jika berjalan sebagai sudo/root)
    try {
        console.log('Mencoba memperbaiki izin /tmp sebagai upaya terakhir...');
        try {
            await execPromise('sudo chmod 1777 /tmp');
        } catch (e) {
            console.log('Tidak berjalan sebagai sudo');
        }

        try {
            await execPromise('sudo mkdir -p /tmp/pdf-emergency');
        } catch (e) {
            console.log('Tidak dapat membuat direktori emergency');
        }

        try {
            await execPromise('sudo chmod 777 /tmp/pdf-emergency');
        } catch (e) {
            console.log('Tidak dapat mengubah izin direktori emergency');
        }

        const emergencyDir = '/tmp/pdf-emergency/' + Date.now();
        await fsPromises.mkdir(emergencyDir, { recursive: true, mode: 0o777 });

        // Verifikasi
        const testFile = path.join(emergencyDir, 'test.txt');
        await fsPromises.writeFile(testFile, 'Test');
        await fsPromises.unlink(testFile);

        console.log('Berhasil menggunakan direktori emergency');
        return emergencyDir;
    } catch (error) {
        console.error('Semua upaya gagal untuk membuat direktori yang dapat ditulis:', error);
    }

    // Jika semua upaya gagal, lempar error yang lebih informatif
    let errorMsg = 'Tidak dapat membuat direktori yang dapat ditulis di manapun. Detail diagnostik: ';

    try {
        errorMsg += `User: ${(await execPromise('whoami')).stdout.trim()}, `;
    } catch (e) {
        errorMsg += 'User: unknown, ';
    }

    errorMsg += `Direktori aplikasi: ${process.cwd()}, `;
    errorMsg += `HOME: ${process.env.HOME || 'undefined'}, `;
    errorMsg += `TEMP: ${os.tmpdir()}, `;
    errorMsg += `Node.js version: ${process.version}`;

    throw new Error(errorMsg);
}

// Alternatif: Implementasi konversi berbasis memory (tidak menggunakan filesystem)
async function convertPdfToWordInMemory(inputFilePath: string, originalName: string): Promise<ConversionResult> {
    console.log('Menggunakan metode konversi berbasis memory...');

    try {
        // Baca file input ke memory
        const inputBuffer = await fsPromises.readFile(inputFilePath);

        // Opsi 1: Gunakan librarynya secara langsung tanpa menyimpan file temporary
        // Ini memerlukan penyesuaian pada library yang digunakan

        // Opsi 2: Gunakan base64 untuk mengirim data ke frontend dan melakukan konversi di browser
        // Ini hanya contoh, implementasi aktualnya tergantung kebutuhan aplikasi

        // Opsi 3: Gunakan API eksternal untuk konversi
        console.log('Ukuran file input:', inputBuffer.length, 'bytes');

        // Kembalikan hasil dummy untuk demo (Anda perlu implementasi aktual)
        // Dalam implementasi sebenarnya, Anda bisa:
        // 1. Menggunakan API online untuk konversi
        // 2. Mencoba menggunakan library Node.js yang bekerja tanpa filesystem
        // 3. Implementasi cara khusus untuk libreoffice yang bekerja dengan stdin/stdout

        return {
            filePath: inputFilePath, // Dalam kasus nyata, ini harus berupa path ke file hasil
            fileName: originalName.replace(/\.pdf$/i, '.docx'),
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            // Tambahkan konten file sebagai buffer/base64 jika metode ini digunakan
            fileContent: inputBuffer.toString('base64') // hanya contoh, implementasi sebenarnya akan berbeda
        };
    } catch (error) {
        console.error('Error dalam konversi berbasis memory:', error);
        throw new Error(`Konversi berbasis memory gagal: ${(error as Error).message}`);
    }
}

// Fungsi utama untuk mengkonversi PDF ke Word (disederhanakan, hanya menggunakan LibreOffice)
async function convertPdfToWord(inputFilePath: string, originalName: string): Promise<ConversionResult> {
    try {
        // Tambahkan logging untuk memudahkan debug
        console.log('Memulai konversi PDF ke Word');
        console.log('File input:', inputFilePath);
        console.log('Nama asli:', originalName);

        // Buat direktori temporer
        const tempDir = await createWritableDirectory();
        console.log('Direktori temporer berhasil dibuat:', tempDir);

        // Jika menggunakan mode berbasis memory
        if (tempDir === 'MEMORY_BASED_CONVERSION') {
            throw new Error('Mode konversi berbasis memori tidak didukung, hanya menggunakan LibreOffice');
        }

        // Konversi menggunakan LibreOffice
        const outputFilePath = await convertPdfToWordUsingLibreOffice(inputFilePath, tempDir);
        console.log('Konversi dengan LibreOffice berhasil!');

        // Buat nama file output berdasarkan originalName
        const outputFileName = originalName.replace(/\.pdf$/i, '.docx');

        return {
            filePath: outputFilePath,
            fileName: outputFileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
    } catch (error) {
        console.error('Error dalam konversi PDF ke Word:', error);
        throw error; // Lempar kembali error untuk ditangani oleh pemanggil
    }
}

// Helper untuk membaca file
async function readFileBuffer(filePath: string): Promise<Buffer> {
    try {
        return await fsPromises.readFile(filePath);
    } catch (error) {
        throw new Error(`Gagal membaca file: ${(error as Error).message}`);
    }
}

// Helper untuk membersihkan file sementara
async function cleanupTempFiles(tempDir: string, filePaths: string[]) {
    try {
        // Hapus file-file individu
        for (const filePath of filePaths) {
            await fsPromises.unlink(filePath).catch(() => { });
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
            result = await convertPdfToWord(inputFilePath, originalName);
        } else {
            throw new Error('Jenis konversi tidak didukung');
        }

        // Baca file hasil konversi
        let fileBuffer: Buffer;
        try {
            // Jika konversi berbasis memori, gunakan fileContent
            if (result.fileContent) {
                fileBuffer = Buffer.from(result.fileContent, 'base64');
            } else {
                fileBuffer = await readFileBuffer(result.filePath);
            }
        } catch (readError) {
            throw new Error(`Gagal membaca file hasil konversi: ${(readError as Error).message}`);
        }

        // Bersihkan file sementara
        if (tempDir && tempDir !== 'MEMORY_BASED_CONVERSION') {
            cleanupTempFiles(tempDir, [inputFilePath, result.filePath]);
        }

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