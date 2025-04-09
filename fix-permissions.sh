#!/bin/bash
# Script untuk memperbaiki masalah izin direktori di server Ubuntu
# Simpan sebagai fix-permissions.sh dan jalankan dengan sudo

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Memperbaiki masalah izin untuk konversi PDF${NC}"

# 1. Identifikasi pengguna yang menjalankan aplikasi web
WEB_USER=$(ps aux | grep -E 'node|nodejs|npm|next' | grep -v grep | head -1 | awk '{print $1}')
echo -e "Pengguna aplikasi web terdeteksi: ${GREEN}$WEB_USER${NC}"

if [ -z "$WEB_USER" ]; then
  echo -e "${RED}Tidak dapat mendeteksi pengguna aplikasi web. Menggunakan 'www-data' sebagai default${NC}"
  WEB_USER="www-data"
fi

# 2. Buat direktori khusus untuk konversi
CONV_DIR="/var/pdf-converter"
echo -e "Membuat direktori konversi di: ${GREEN}$CONV_DIR${NC}"

# Buat direktori
mkdir -p $CONV_DIR
chmod 777 $CONV_DIR
chown $WEB_USER:$WEB_USER $CONV_DIR

echo -e "Izin direktori diatur: ${GREEN}777${NC}"
echo -e "Kepemilikan direktori diatur: ${GREEN}$WEB_USER:$WEB_USER${NC}"

# 3. Memperbaiki izin /tmp
echo -e "Memperbaiki izin direktori /tmp..."
chmod 1777 /tmp
echo -e "Izin /tmp diatur: ${GREEN}1777${NC}"

# 4. Periksa dan perbaiki izin untuk LibreOffice
echo -e "Memeriksa instalasi LibreOffice..."
if command -v libreoffice &> /dev/null; then
  echo -e "${GREEN}LibreOffice terinstal${NC}"
  LIBRE_PATH=$(which libreoffice)
  echo -e "Path LibreOffice: ${GREEN}$LIBRE_PATH${NC}"
  
  # Pastikan LibreOffice dapat diakses oleh pengguna web
  LIBRE_DIR=$(dirname "$LIBRE_PATH")
  chmod -R 755 "$LIBRE_DIR"
  echo -e "Izin direktori LibreOffice diperbaiki"
else
  echo -e "${RED}LibreOffice tidak terinstal. Menginstal...${NC}"
  apt-get update
  apt-get install -y libreoffice
  echo -e "${GREEN}LibreOffice berhasil diinstal${NC}"
fi

# 5. Membuat file .env dengan pengaturan direktori temporer
ENV_FILE=$(find /var/www -name ".env" 2>/dev/null | head -1)
if [ -z "$ENV_FILE" ]; then
  ENV_FILE=$(find /home -name ".env" 2>/dev/null | head -1)
fi

if [ -n "$ENV_FILE" ]; then
  echo -e "File .env ditemukan di: ${GREEN}$ENV_FILE${NC}"
  
  # Periksa apakah PDF_CONVERTER_TEMP_DIR sudah ada
  if grep -q "PDF_CONVERTER_TEMP_DIR" "$ENV_FILE"; then
    echo -e "Variabel PDF_CONVERTER_TEMP_DIR sudah ada di .env. Memperbarui..."
    sed -i "s|PDF_CONVERTER_TEMP_DIR=.*|PDF_CONVERTER_TEMP_DIR=$CONV_DIR|g" "$ENV_FILE"
  else
    echo -e "Menambahkan variabel PDF_CONVERTER_TEMP_DIR ke .env"
    echo "PDF_CONVERTER_TEMP_DIR=$CONV_DIR" >> "$ENV_FILE"
  fi
  
  echo -e "${GREEN}File .env diperbarui dengan direktori temporer${NC}"
else
  echo -e "${YELLOW}File .env tidak ditemukan. Buat file .env secara manual dan tambahkan:${NC}"
  echo -e "${GREEN}PDF_CONVERTER_TEMP_DIR=$CONV_DIR${NC}"
fi

# 6. Memeriksa dan mengakhiri proses LibreOffice yang menggantung
echo -e "Memeriksa proses LibreOffice yang menggantung..."
if pgrep -f "soffice.bin" > /dev/null; then
  echo -e "${YELLOW}Proses LibreOffice yang berjalan terdeteksi. Mengakhiri...${NC}"
  killall soffice.bin
  echo -e "${GREEN}Proses LibreOffice diakhiri${NC}"
else
  echo -e "${GREEN}Tidak ada proses LibreOffice yang menggantung${NC}"
fi

# 7. Menambahkan pengguna web ke grup yang diperlukan
echo -e "Menambahkan pengguna $WEB_USER ke grup yang diperlukan..."
usermod -a -G libreoffice $WEB_USER 2>/dev/null || echo -e "${YELLOW}Grup libreoffice tidak ada atau error lain${NC}"

# 8. Buat direktori alternatif dan atur izinnya
ALT_DIRS=("/tmp/pdf-converter" "$HOME/.tmp/pdf-converter" "/run/pdf-converter" "/dev/shm/pdf-converter")

for DIR in "${ALT_DIRS[@]}"; do
  echo -e "Membuat direktori alternatif: ${GREEN}$DIR${NC}"
  mkdir -p "$DIR"
  chmod 777 "$DIR"
  chown $WEB_USER:$WEB_USER "$DIR"
  echo -e "Direktori $DIR dibuat dan izin diatur"
done

echo -e "\n${GREEN}=== SELESAI ===${NC}"
echo -e "Anda perlu ${YELLOW}restart aplikasi web${NC} agar perubahan diterapkan."
echo -e "Jika masih mengalami masalah, tambahkan baris berikut ke file .env Anda:"
echo -e "${GREEN}PDF_CONVERTER_TEMP_DIR=$CONV_DIR${NC}"
echo -e "Dan restart aplikasi web Anda."