@echo off
REM Ollama Installation and Setup Script for Windows
REM Automatically installs Ollama and runs the llama2 model

setlocal enabledelayedexpansion

echo.
echo ====================================================
echo     Ollama Installation and Setup Script (Windows)
echo ====================================================
echo.

REM Check if Ollama is already installed
where ollama >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Ollama is already installed
    ollama --version
) else (
    echo [*] Ollama is not installed
    echo.
    echo Choose installation method:
    echo 1. Using Scoop (requires scoop installed)
    echo 2. Using Chocolatey (requires chocolatey installed)
    echo 3. Download manually from https://ollama.ai
    echo.
    set /p choice="Enter your choice (1-3): "

    if "!choice!"=="1" (
        echo [*] Installing Ollama with Scoop...
        scoop install ollama
        if !errorlevel! equ 0 (
            echo [OK] Ollama installed successfully with Scoop
        ) else (
            echo [!] Scoop installation failed
            echo [*] Please download manually from https://ollama.ai
            pause
            exit /b 1
        )
    ) else if "!choice!"=="2" (
        echo [*] Installing Ollama with Chocolatey...
        choco install ollama -y
        if !errorlevel! equ 0 (
            echo [OK] Ollama installed successfully with Chocolatey
        ) else (
            echo [!] Chocolatey installation failed
            echo [*] Please download manually from https://ollama.ai
            pause
            exit /b 1
        )
    ) else (
        echo [*] Please download Ollama from https://ollama.ai and run the installer
        pause
        exit /b 1
    )
)

echo.
echo [*] Verifying Ollama installation...
where ollama >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Ollama is ready to use
) else (
    echo [ERROR] Ollama installation verification failed
    pause
    exit /b 1
)

echo.
set /p start="Start Ollama server and run llama2? (y/n): "

if /i "!start!"=="y" (
    echo.
    echo [*] Starting Ollama server...
    start cmd /k "ollama serve"

    timeout /t 3 /nobreak

    echo [*] Pulling and running llama2 model...
    echo [!] This may take a few minutes as it downloads the model (^~4GB)
    echo.

    ollama run llama2
) else (
    echo.
    echo Setup complete! To start using Ollama, run:
    echo.
    echo   REM Start the server
    echo   ollama serve
    echo.
    echo   REM In another terminal, run a model
    echo   ollama run llama2
    echo.
)

pause
