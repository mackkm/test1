# Quick Setup Guide - Ollama Chat iOS App

## 5-Minute Setup

### Step 1: Clone/Get the Files

You have the following files:
- `OllamaChatApp.swift`
- `ContentView.swift`
- `ChatViewModel.swift`
- `Package.swift`

### Step 2: Create Xcode Project

**Easy Way:**
1. Open Xcode
2. Create New Project → App
3. Choose SwiftUI interface
4. Replace the generated files with the ones above
5. File > New > File to add each Swift file

**Or:**
1. Create a folder named `OllamaChat-iOS`
2. Put all the `.swift` files in a `Sources` subfolder
3. Put `Package.swift` in the root
4. Open with Xcode

### Step 3: Run Ollama Server

On your Mac or server machine:

```bash
# Install if you haven't already
curl -fsSL https://ollama.ai/install.sh | sh

# Start the server
ollama serve

# In another terminal, download a model
ollama pull llama2
```

**Server will be at: `http://localhost:11434`**

### Step 4: Build & Run the App

1. **Select simulator** (iPhone 14 or later recommended)
2. **Press Play** (Cmd + R)
3. **Wait for build** (first build takes a minute)
4. **App opens in simulator**

### Step 5: Configure in App

1. **Tap Settings ⚙️** (top right)
2. **Enter server URL:**
   - If on same Mac: `http://localhost:11434`
   - If on different Mac: `http://YOUR_MAC_IP:11434`
3. **Select model:** llama2 (or your preferred)
4. **Tap "Test Connection"**
5. **Should show ✓ Connected!**
6. **Tap Done**

### Step 6: Start Chatting!

1. **Type a message** in the text field
2. **Tap send button** ✈️
3. **Wait for response** (first response takes longer as model loads)
4. **Keep chatting!**

---

## Troubleshooting Quick Fixes

### App Won't Run
```bash
# Make sure you selected a simulator target
# iPhone 15, 14, or 13 recommended
# Then try again: Cmd + R
```

### "Connection Failed" in App
```bash
# Check if Ollama is running
curl http://localhost:11434

# If that fails, start Ollama
ollama serve

# If on different machines, use IP instead
ifconfig | grep inet  # Find your Mac's IP
# Then in app: http://YOUR_IP:11434
```

### Model Takes Forever
```bash
# First response loads the model (3-5 min for llama2)
# This is normal! Subsequent messages are fast

# Or try a smaller, faster model
ollama pull orca-mini
# Then in app, select "orca-mini"
```

### Need to Switch Models
```bash
# Download the model first
ollama pull mistral

# Then in app settings, select it
# Test connection and done!
```

---

## Using on Physical iPhone

### Same Network (Easiest)

1. **Find your Mac's IP:**
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   # Example: 192.168.1.100
   ```

2. **Start Ollama with network access:**
   ```bash
   # Stop current Ollama (Ctrl+C)
   ollama serve --host 0.0.0.0:11434
   ```

3. **On iPhone:**
   - Open Settings ⚙️
   - Enter: `http://192.168.1.100:11434`
   - Test Connection
   - Should work!

### Remote Network (Using ngrok)

1. **Install ngrok** (https://ngrok.com)
   ```bash
   brew install ngrok
   ```

2. **Expose Ollama:**
   ```bash
   ngrok http 11434
   # You'll get: https://abc123.ngrok.io
   ```

3. **On iPhone:**
   - Open Settings ⚙️
   - Enter: `https://abc123.ngrok.io`
   - Test Connection
   - Should work!

---

## File Size Reference

- **llama2** - 4GB (recommended, slow on iPhone)
- **mistral** - 4GB (fast, smart)
- **orca-mini** - 3GB (faster)
- **dolphin-phi** - 2GB (fastest, smaller)

Use smaller models for better iPhone performance!

---

## Performance Tips

1. **Close other apps** on your iPhone
2. **Use 5GHz WiFi** (faster than 2.4GHz)
3. **Ollama server on fast Mac** (M1+ better)
4. **Try orca-mini** (faster than llama2)
5. **Keep Ollama running** in background

---

## Next Steps

- ✅ Check `README.md` for advanced configuration
- ✅ Customize colors and UI in `ContentView.swift`
- ✅ Add new models in `ChatViewModel.swift`
- ✅ Deploy to App Store (requires Apple Developer account)

---

**That's it! You're ready to chat with Ollama on iOS!** 📱✨
