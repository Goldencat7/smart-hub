#!/bin/bash
# Roda no Mac para gerar build/icon.icns a partir do build/icon.ico
# Uso: bash scripts/make-icns.sh

set -e
cd "$(dirname "$0")/.."

echo "Extraindo PNG do .ico..."
sips -s format png build/icon.ico --out build/icon-tmp.png

echo "Criando iconset..."
mkdir -p build/icon.iconset
sips -z 16 16     build/icon-tmp.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon-tmp.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon-tmp.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon-tmp.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon-tmp.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon-tmp.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon-tmp.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon-tmp.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon-tmp.png --out build/icon.iconset/icon_512x512.png

echo "Gerando .icns..."
iconutil -c icns build/icon.iconset --output build/icon.icns

echo "Limpando arquivos temporários..."
rm -rf build/icon.iconset build/icon-tmp.png

echo "Pronto! build/icon.icns criado."
