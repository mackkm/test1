#!/bin/bash

# Ollama One-Command Setup & Run Script
# Download and run: curl -fsSL https://raw.githubusercontent.com/yourusername/test1/claude/odsb-special-diet-form-4j53o4/run_ollama.sh | bash
# Or save and run: chmod +x run_ollama.sh && ./run_ollama.sh

set -e

OS=$(uname -s)

echo "╔════════════════════════════════════════════════════════╗"
echo "║           Ollama Auto-Install & Run Script             ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "[*] Detected OS: $OS"
echo ""

# macOS Installation
if [[ "$OS" == "Darwin" ]]; then
    echo "[*] Installing Ollama on macOS..."

    if command -v brew &> /dev/null; then
        echo "[*] Using Homebrew..."
        brew install ollama
    else
        echo "[*] Using official installer..."
        curl -fsSL https://ollama.ai/install.sh | sh
    fi

    echo "[✓] Ollama installed!"
    echo "[*] Starting Ollama server..."
    nohup /Applications/Ollama.app/Contents/MacOS/Ollama > /tmp/ollama.log 2>&1 &
    sleep 3
    echo "[✓] Server started!"
    echo ""
    echo "[*] Running llama2 model..."
    echo "[!] First run will download the model (~4GB). This may take a few minutes..."
    echo ""
    ollama run llama2

# Linux Installation
elif [[ "$OS" == "Linux" ]]; then
    echo "[*] Installing Ollama on Linux..."

    if command -v apt &> /dev/null; then
        echo "[*] Using apt..."
        sudo apt update
        sudo apt install -y ollama
    elif command -v dnf &> /dev/null; then
        echo "[*] Using dnf..."
        sudo dnf install -y ollama
    else
        echo "[*] Using official installer..."
        curl -fsSL https://ollama.ai/install.sh | sh
    fi

    echo "[✓] Ollama installed!"
    echo "[*] Starting Ollama server..."
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    sleep 3
    echo "[✓] Server started!"
    echo ""
    echo "[*] Running llama2 model..."
    echo "[!] First run will download the model (~4GB). This may take a few minutes..."
    echo ""
    ollama run llama2

# Windows (Git Bash / WSL)
elif [[ "$OS" == "MINGW64_NT"* ]] || [[ "$OS" == "MSYS_NT"* ]]; then
    echo "[!] Windows detected - please run install_and_run_ollama.bat instead"
    echo "[*] Or download from: https://ollama.ai"
    exit 1

else
    echo "[✗] Unsupported OS: $OS"
    exit 1
fi
