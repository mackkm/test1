# Ollama Installation & Setup Scripts

These scripts automate the installation and setup of Ollama (a tool for running large language models locally).

## Quick Start

### macOS & Linux
```bash
./install_and_run_ollama.sh
```

### Windows
```cmd
install_and_run_ollama.bat
```

## What These Scripts Do

1. **Detect your operating system**
2. **Install Ollama** using the appropriate method:
   - macOS: Homebrew or official installer
   - Linux: apt, dnf, or official installer
   - Windows: Scoop, Chocolatey, or manual download
3. **Verify installation**
4. **Start the Ollama server** (background process)
5. **Download and run the llama2 model** (interactive chat)

## Features

✅ **Cross-platform** - Works on macOS, Linux, and Windows  
✅ **Automatic** - No manual configuration needed  
✅ **Intelligent** - Detects and uses the best installation method  
✅ **Interactive** - Prompts for confirmation before installing  
✅ **Error handling** - Validates each step  

## Script Details

### `install_and_run_ollama.sh` (macOS & Linux)

**Features:**
- Auto-detects macOS or Linux
- Installs using Homebrew (macOS) or apt/dnf (Linux)
- Starts Ollama server as background process
- Waits for server to be ready
- Runs llama2 model interactively

**Usage:**
```bash
chmod +x install_and_run_ollama.sh
./install_and_run_ollama.sh
```

**What happens:**
1. Detects OS (macOS/Linux)
2. Installs Ollama
3. Verifies installation
4. Asks if you want to start the server and run llama2
5. Pulls the llama2 model (~4GB)
6. Starts interactive chat with llama2

**Logs:**
- Server logs are saved to `/tmp/ollama.log`
- View with: `tail -f /tmp/ollama.log`

### `install_and_run_ollama.bat` (Windows)

**Features:**
- Supports Scoop, Chocolatey, or manual installation
- Prompts for installation method
- Starts Ollama server in new window
- Runs llama2 model interactively

**Prerequisites:**
- Windows 10/11
- Command Prompt or PowerShell
- (Optional) Scoop or Chocolatey for automatic installation

**Usage:**
```cmd
install_and_run_ollama.bat
```

**What happens:**
1. Checks if Ollama is installed
2. If not installed, offers installation options:
   - Via Scoop: `scoop install ollama`
   - Via Chocolatey: `choco install ollama`
   - Manual: Download from https://ollama.ai
3. Verifies installation
4. Asks if you want to start the server and run llama2
5. Starts Ollama server in new terminal window
6. Pulls the llama2 model (~4GB)
7. Starts interactive chat with llama2

## Manual Usage

If you prefer to run Ollama manually after installation:

### Start the Ollama Server
```bash
ollama serve
```

This starts the Ollama server (required for running models)

### Run a Model (in another terminal)
```bash
# Run llama2 (default model)
ollama run llama2

# Run other models
ollama run mistral
ollama run neural-chat
ollama run openchat
```

### List Available Models
```bash
ollama list
```

### Pull a Model Without Running
```bash
ollama pull llama2
ollama pull mistral
```

## Available Models

Popular models available on Ollama:

- **llama2** - Meta's Llama 2 model (7B parameters, ~4GB)
- **mistral** - Mistral 7B model (7B parameters, ~4GB)
- **neural-chat** - Intel's Neural Chat model
- **openchat** - OpenChat model
- **starling-lm** - Starling LM model
- **orca-mini** - Orca Mini model (smaller, faster)
- **dolphin-phi** - Dolphin Phi model (smaller, faster)

For more models, visit: https://ollama.ai/library

## System Requirements

### Minimum Requirements
- **CPU**: Modern processor (2+ cores)
- **RAM**: 8GB minimum
- **Storage**: 4-10GB per model (llama2 is ~4GB)
- **Network**: Internet connection (for downloading models)

### Recommended
- **RAM**: 16GB+
- **GPU**: Optional but speeds up inference (NVIDIA with CUDA, AMD with ROCm, or Apple Silicon)
- **Storage**: SSD for better performance

## Troubleshooting

### Script Won't Run (Linux/macOS)
```bash
# Make script executable
chmod +x install_and_run_ollama.sh

# Run with bash explicitly
bash install_and_run_ollama.sh
```

### Ollama Server Won't Start
```bash
# Check if port 11434 is already in use
lsof -i :11434

# Check server logs
tail -f /tmp/ollama.log

# Try starting manually
ollama serve
```

### Model Download Fails
- Check your internet connection
- Check available disk space (models are large, ~4GB each)
- Try pulling a smaller model first:
  ```bash
  ollama pull orca-mini
  ```

### Server Not Responding
- Check if server is running: `curl http://localhost:11434`
- Give server more time to start
- Check system resources (RAM, disk space)

### Out of Memory
- Close other applications
- Try a smaller model: `ollama run orca-mini`
- Add more RAM to your system

## Performance Tips

1. **Use GPU Acceleration** (if available)
   - NVIDIA: Install CUDA
   - AMD: Install ROCm
   - Apple Silicon: Supported natively

2. **Use Smaller Models** for faster response
   - `ollama run orca-mini` (3GB)
   - `ollama run dolphin-phi` (2GB)

3. **Run on SSD** for better model loading performance

4. **Allocate Sufficient RAM** - Close other applications

## API Usage

Ollama provides a REST API (default: http://localhost:11434):

### Generate Text
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "llama2",
  "prompt": "Why is the sky blue?",
  "stream": false
}'
```

### Chat
```bash
curl http://localhost:11434/api/chat -d '{
  "model": "llama2",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}'
```

## Integration with Other Tools

### Python
```python
import requests

response = requests.post('http://localhost:11434/api/generate', json={
    'model': 'llama2',
    'prompt': 'Hello, how are you?',
    'stream': False
})

print(response.json()['response'])
```

### Node.js
```javascript
const response = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  body: JSON.stringify({
    model: 'llama2',
    prompt: 'Hello, how are you?',
    stream: false
  })
});

const data = await response.json();
console.log(data.response);
```

## Additional Resources

- **Ollama Website**: https://ollama.ai
- **Model Library**: https://ollama.ai/library
- **GitHub**: https://github.com/ollama/ollama
- **Documentation**: https://github.com/ollama/ollama/wiki

## License & Attribution

- Ollama is open-source: https://github.com/ollama/ollama
- These scripts are provided as-is for convenience

## Support

For issues with:
- **Ollama**: https://github.com/ollama/ollama/issues
- **These scripts**: Check the script comments or create an issue in your repository
