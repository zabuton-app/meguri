# EXIF fixtures

Tiny images carrying the EXIF and XMP that `exif.test.ts` reads. They are
committed because CI has no exiftool. To make them again, from this folder:

```sh
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 base.jpg
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 no-exif.png
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 base.webp

cp base.jpg dated-offset.jpg
exiftool -overwrite_original -DateTimeOriginal="2019:07:21 14:35:00" \
  -OffsetTimeOriginal="+09:00" -Make=Canon -Model="Canon EOS R5" \
  -LensModel="RF24-105mm F4 L IS USM" -FNumber=4 -ExposureTime=1/125 \
  -ISO=200 -FocalLength=50 -FocalLengthIn35mmFormat=50 dated-offset.jpg

cp base.jpg dated-local.jpg
exiftool -overwrite_original -DateTimeOriginal="2019:07:21 14:35:00" dated-local.jpg

cp base.jpg zero-date.jpg
exiftool -overwrite_original '-DateTimeOriginal#=0000:00:00 00:00:00' \
  -Make=Apple -Model="iPhone 15 Pro" zero-date.jpg

cp no-exif.png xmp-only.png
exiftool -overwrite_original \
  -XMP-exif:DateTimeOriginal="2020:01:02 03:04:05+01:00" xmp-only.png

cp base.webp dated.webp
exiftool -overwrite_original -DateTimeOriginal="2021:05:06 07:08:09" \
  -Make=Google -Model="Pixel 8" dated.webp

cp ../grid-1024x512.heic dated.heic
exiftool -overwrite_original -DateTimeOriginal="2022:03:04 05:06:07" \
  -Make=Apple -Model="iPhone 15 Pro" dated.heic

rm base.*
```

The TIFF, and a PNG with an `eXIf` chunk:

```sh
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 dated.tiff
exiftool -overwrite_original -DateTimeOriginal="2023:08:09 10:11:12" \
  -Make=Nikon -Model="NIKON Z 8" dated.tiff

ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 dated.png
exiftool -overwrite_original -DateTimeOriginal="2024:01:02 03:04:05" \
  -Make=Apple -Model="iPhone 15 Pro" dated.png
```

A camera that writes ISOSpeedRatings twice:

```sh
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 iso-pair.jpg
exiftool -overwrite_original '-ISO=100 100' -Model="X-T4" iso-pair.jpg
```

A photo with every field the detail view lists, and a GPS position that must
not be read (#725):

```sh
ffmpeg -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 full.jpg
exiftool -overwrite_original -DateTimeOriginal="2019:07:21 14:35:00" \
  -OffsetTimeOriginal="+09:00" -Make=Canon -Model="Canon EOS R5" \
  -LensModel="RF24-105mm F4 L IS USM" -FNumber=4 -ExposureTime=1/125 \
  -ISO=200 -ExposureCompensation=-0.7 -FocalLength=50 \
  -FocalLengthIn35mmFormat=50 -MeteringMode#=5 -EXIF:Flash#=16 -WhiteBalance#=0 \
  -ExposureProgram#=3 -ExifImageWidth=8192 -ExifImageHeight=5464 \
  -Software="Adobe Lightroom 7.0" -Artist="Jane Doe" -Copyright="(c) Jane Doe" \
  -GPSLatitude=35.0 -GPSLatitudeRef=N full.jpg
```
