#!/bin/bash
# Perbaikan untuk masalah LibreOffice dan Java
# Simpan sebagai fix-libreoffice.sh dan jalankan dengan sudo

echo "Memperbaiki instalasi LibreOffice dan Java..."

# 1. Pastikan libreoffice-java-common terinstal
echo "Menginstal LibreOffice Java Common..."
sudo apt-get update
sudo apt-get install -y libreoffice-java-common default-jre

# 2. Menginstal semua komponen LibreOffice yang diperlukan
echo "Menginstal komponen LibreOffice yang diperlukan..."
sudo apt-get install -y libreoffice-core libreoffice-common libreoffice-writer libreoffice-calc libreoffice-base libreoffice-base-core

# 3. Perbaiki dependensi yang rusak
echo "Memperbaiki dependensi yang rusak..."
sudo apt-get install -f

# 4. Pastikan unoconv terinstal sebagai alternatif
echo "Menginstal unoconv sebagai alternatif..."
sudo apt-get install -y unoconv

# 5. Restart LibreOffice services
echo "Me-restart layanan LibreOffice..."
killall soffice.bin 2>/dev/null
killall -9 soffice.bin 2>/dev/null

# 6. Verifikasi instalasi
echo "Memverifikasi instalasi LibreOffice..."
libreoffice --version

# 7. Mengetes konversi PDF sederhana
echo "Membuat PDF test..."
echo "Test PDF" > /tmp/test.txt
libreoffice --headless --convert-to pdf --outdir /tmp /tmp/test.txt

if [ -f "/tmp/test.pdf" ]; then
  echo "Konversi ke PDF berhasil, menguji konversi ke docx..."
  libreoffice --headless --convert-to docx --outdir /tmp /tmp/test.pdf
  
  if [ -f "/tmp/test.docx" ]; then
    echo "Konversi ke DOCX berhasil! LibreOffice sudah berfungsi dengan baik."
  else
    echo "Konversi ke DOCX gagal. Masih ada masalah dengan LibreOffice."
  fi
else
  echo "Konversi ke PDF gagal. Masih ada masalah dengan LibreOffice."
fi

echo "Selesai memperbaiki LibreOffice dan Java."