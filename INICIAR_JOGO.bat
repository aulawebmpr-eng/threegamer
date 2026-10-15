@echo off
cd /d "%~dp0"
title TRREE GAMER QUIZ - Servidor
color 0A
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo =====================================================
  echo   NODE.JS NAO FOI ENCONTRADO
  echo =====================================================
  echo.
  echo Instale o Node.js LTS e depois execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo.
  echo Instalando os componentes do jogo pela primeira vez...
  echo Isso pode levar alguns minutos.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar os componentes.
    pause
    exit /b 1
  )
)
echo.
echo =====================================================
echo   TRREE GAMER - QUIZ MULTIPLAYER
echo =====================================================
echo.
call npm start
pause
