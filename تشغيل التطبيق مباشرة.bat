@echo off
chcp 65001 > nul
title نظام كاشير ريد ماجيك - RED MAGIC POS
cd /d "%~dp0"
echo ========================================================
echo     جاري تشغيل نظام الكاشير (لفتح السيستم على الكمبيوتر والموبايل)...
echo ========================================================
start /b "" node server.js > nul 2>&1
timeout /t 1 /nobreak > nul
start "" "http://localhost:3000"
exit
