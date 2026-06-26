#!/bin/bash

# Ollama Installation and Setup Script
# Automatically installs Ollama and runs the llama2 model
# Supports macOS, Linux, and Windows (Git Bash/WSL)

set -e

# Color output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*)
            echo "macos"
            ;;
        Linux*)
            echo "linux"
            ;;
        MINGW*|MSYS*)
            echo "windows"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# Install Ollama on macOS
install_macos() {
    print_status "Installing Ollama on macOS..."

    if command -v brew &> /dev/null; then
        print_status "Using Homebrew to install Ollama..."
        brew install ollama
        print_success "Ollama installed successfully via Homebrew"
    else
        print_warning "Homebrew not found. Installing Ollama directly..."
        curl -fsSL https://ollama.ai/install.sh | sh
        print_success "Ollama installed successfully"
    fi
}

# Install Ollama on Linux
install_linux() {
    print_status "Installing Ollama on Linux..."

    # Try apt first (Ubuntu/Debian)
    if command -v apt &> /dev/null; then
        print_status "Using apt to install Ollama..."
        sudo apt update
        sudo apt install -y ollama
        print_success "Ollama installed successfully via apt"
        return 0
    fi

    # Try dnf (Fedora/RHEL)
    if command -v dnf &> /dev/null; then
        print_status "Using dnf to install Ollama..."
        sudo dnf install -y ollama
        print_success "Ollama installed successfully via dnf"
        return 0
    fi

    # Fallback to official script
    print_status "Using official install script..."
    curl -fsSL https://ollama.ai/install.sh | sh
    print_success "Ollama installed successfully"
}

# Install Ollama on Windows
install_windows() {
    print_status "Installing Ollama on Windows..."
    print_warning "Please download Ollama from https://ollama.ai and run the installer"
    print_status "Or, if you have scoop or chocolatey, use:"
    echo "  scoop install ollama"
    echo "  # or"
    echo "  choco install ollama"
    read -p "Press Enter once Ollama is installed..."
}

# Verify Ollama installation
verify_installation() {
    print_status "Verifying Ollama installation..."
    if command -v ollama &> /dev/null; then
        print_success "Ollama is installed"
        ollama --version
        return 0
    else
        print_error "Ollama installation not found"
        return 1
    fi
}

# Start Ollama server
start_ollama_server() {
    print_status "Starting Ollama server..."
    print_warning "Ollama server will run in the background"

    if [[ "$OS_TYPE" == "windows" ]]; then
        print_status "Starting Ollama (Windows)..."
        ollama serve &
        sleep 3
    else
        # Check if already running
        if pgrep -f "ollama serve" > /dev/null; then
            print_success "Ollama server is already running"
            return 0
        fi

        print_status "Starting Ollama server..."
        nohup ollama serve > /tmp/ollama.log 2>&1 &
        sleep 3

        if pgrep -f "ollama serve" > /dev/null; then
            print_success "Ollama server started successfully"
            print_status "Server logs: tail -f /tmp/ollama.log"
        else
            print_error "Failed to start Ollama server"
            print_status "Trying direct execution instead..."
            ollama serve &
        fi
    fi
}

# Wait for server to be ready
wait_for_server() {
    print_status "Waiting for Ollama server to be ready..."

    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -s http://localhost:11434 > /dev/null 2>&1; then
            print_success "Ollama server is ready!"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 1
        echo -ne "."
    done

    echo ""
    print_warning "Ollama server may still be starting. You can check logs: tail -f /tmp/ollama.log"
    return 0
}

# Pull and run llama2 model
run_llama2() {
    print_status "Pulling and running llama2 model..."
    print_warning "This may take a few minutes as it downloads the model (~4GB)"

    ollama run llama2
}

# Main execution
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════╗"
    echo "║       Ollama Installation and Setup Script            ║"
    echo "╚═══════════════════════════════════════════════════════╝"
    echo ""

    # Detect OS
    OS_TYPE=$(detect_os)
    print_status "Detected OS: $OS_TYPE"

    case "$OS_TYPE" in
        macos)
            install_macos
            ;;
        linux)
            install_linux
            ;;
        windows)
            install_windows
            ;;
        *)
            print_error "Unsupported operating system"
            exit 1
            ;;
    esac

    echo ""

    # Verify installation
    if ! verify_installation; then
        print_error "Ollama installation failed"
        exit 1
    fi

    echo ""

    # Ask user if they want to start the server
    read -p "$(echo -e ${BLUE}[?]${NC} 'Start Ollama server and run llama2? (y/n): ')" -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        start_ollama_server
        echo ""
        wait_for_server
        echo ""
        run_llama2
    else
        print_status "Setup complete! To start using Ollama, run:"
        echo ""
        echo "  # Start the server"
        echo "  ollama serve"
        echo ""
        echo "  # In another terminal, run a model"
        echo "  ollama run llama2"
        echo ""
    fi
}

# Run main function
main
