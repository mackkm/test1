# Ollama Chat - iOS App

A native iOS app for chatting with Ollama language models. Built with SwiftUI for iOS 15+.

## Features

✨ **Chat Interface**
- Clean, modern chat UI
- Real-time message streaming
- Auto-scrolling to latest messages
- Loading indicators while AI responds

🔧 **Settings**
- Configure Ollama server URL
- Switch between models (llama2, mistral, etc.)
- Test connection to server
- Persistent settings (saved locally)

🌐 **Network**
- HTTP/REST API communication with Ollama
- Connection status monitoring
- Automatic reconnection attempts
- 5-minute timeout for long responses

## Requirements

- **iOS 15.0 or later**
- **Xcode 14.0 or later**
- **Swift 5.9+**
- **Ollama server running** (local or remote)

## Installation

### Option 1: Open in Xcode (Easiest)

1. **Open Xcode**
2. **File → Open**
3. Select the `OllamaChat-iOS` folder
4. Select the `.xcodeproj` file (or create one from Package.swift)
5. **Select your target device** (iPhone simulator or physical device)
6. **Press Play** (or Cmd + R) to build and run

### Option 2: Command Line

```bash
# Build
xcodebuild -scheme OllamaChat -configuration Debug

# Run on simulator
xcrun simctl install booted OllamaChat.app
xcrun simctl launch booted com.yourcompany.OllamaChat
```

### Option 3: From Source (SwiftUI Project)

Create a new Xcode project:

1. **Xcode → Create New Project**
2. Choose **App** template
3. Set **Interface** to **SwiftUI**
4. Replace the default files with:
   - `OllamaChatApp.swift`
   - `ContentView.swift`
   - `ChatViewModel.swift`
5. Build and run!

## Quick Start

### 1. Start Ollama Server

Make sure Ollama is running with the server accessible:

**Local Machine:**
```bash
ollama serve
# Server runs at http://localhost:11434
```

**If running on different device:**
- Note your machine's IP address (e.g., `192.168.1.100`)
- Server will be at `http://192.168.1.100:11434`

### 2. Configure App

1. Open the app on your iOS device
2. Tap the ⚙️ (settings) icon in top right
3. Enter your server URL:
   - Local: `http://localhost:11434`
   - Network: `http://YOUR_IP:11434`
4. Select your preferred model
5. Tap "Test Connection" to verify
6. Tap "Done"

### 3. Start Chatting!

- Type your message in the text field
- Tap the send button (✈️)
- Wait for the AI response
- Keep the conversation going!

## Architecture

```
OllamaChatApp (Entry Point)
└── ContentView (Main UI)
    ├── Chat Messages Display
    ├── Input Area
    └── SettingsView (⚙️)
        └── Server Configuration
            └── ChatViewModel
                ├── Message Management
                ├── API Communication
                └── Settings Persistence
                    └── OllamaAPIClient
                        └── HTTP Requests to Ollama
```

## File Structure

```
OllamaChat-iOS/
├── OllamaChatApp.swift          # App entry point
├── ContentView.swift             # Main chat UI
├── ChatViewModel.swift           # Logic & networking
├── Package.swift                 # Swift package manifest
└── README.md                     # This file
```

## Supported Models

Out of the box:
- `llama2` - Meta's Llama 2 (7B, ~4GB)
- `mistral` - Mistral 7B (~4GB)
- `orca-mini` - Smaller, faster (~3GB)
- `neural-chat` - Good for conversations
- `dolphin-phi` - Very small and quick (~2GB)

To add more models, edit `availableModels` in `ChatViewModel.swift`:

```swift
@Published var availableModels = [
    "llama2",
    "mistral",
    "your-new-model",
    // ... add more
]
```

## Configuration

### Change Default Server URL

Edit `ChatViewModel.swift`:
```swift
@Published var serverUrl: String = "http://YOUR_IP:11434"
```

### Change Default Model

Edit `ChatViewModel.swift`:
```swift
@Published var selectedModel: String = "mistral"
```

### Adjust Timeout

Edit `ChatViewModel.swift` in `generateResponse`:
```swift
urlRequest.timeoutInterval = 600  // 10 minutes
```

## Network Setup

### Accessing Ollama from Another Device

**On your Mac (running Ollama):**
```bash
# Allow connections from other devices
ollama serve --host 0.0.0.0:11434
```

**On your iPhone:**
1. Find your Mac's IP: `ifconfig | grep inet`
2. In app settings, enter: `http://YOUR_MAC_IP:11434`
3. Tap "Test Connection"

### Using ngrok for Remote Access

If accessing from outside your network:

```bash
# Install ngrok (https://ngrok.com)
brew install ngrok

# Expose Ollama through ngrok
ngrok http 11434

# Use the generated URL in the app
# Example: https://abc123.ngrok.io
```

## Troubleshooting

### "Connection Failed"
- Check if Ollama server is running: `ollama serve`
- Verify server URL in app settings
- Check firewall settings
- Ensure device is on same network (for local IP)

### "Invalid Server URL"
- Verify URL format: `http://localhost:11434`
- No trailing slash needed
- Check IP address if using remote

### App Crashes
- Check Xcode console for error messages
- Ensure iOS version is 15+
- Try clearing app cache: Settings → General → iPhone Storage

### Slow Responses
- Check internet connection speed
- Try a smaller model (orca-mini, dolphin-phi)
- Ensure Ollama server has enough resources

### Model Not Found
- Verify model is installed: `ollama list`
- Pull the model: `ollama pull mistral`
- Restart the app

## Build & Distribution

### Build for Release

```bash
xcodebuild -scheme OllamaChat -configuration Release
```

### Create IPA for Distribution

```bash
xcodebuild -scheme OllamaChat -archivePath build/OllamaChat.xcarchive -configuration Release
xcodebuild -exportArchive -archivePath build/OllamaChat.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/
```

### App Store Submission

1. Create Apple Developer account
2. Create App ID
3. Create provisioning profile
4. Configure signing in Xcode
5. Build archive
6. Use Transporter to submit

## Privacy & Security

✅ **Privacy Features:**
- All data stays on your device
- Messages not sent to external servers
- Only communicates with your Ollama instance
- No analytics or tracking
- Settings stored locally in UserDefaults

⚠️ **Security Notes:**
- Use HTTPS URLs if Ollama is exposed to internet
- Consider authentication for remote Ollama instances
- Be cautious with sensitive prompts on shared devices

## API Details

### Ollama Generate Endpoint

```
POST /api/generate
Content-Type: application/json

Request:
{
  "model": "llama2",
  "prompt": "Hello, how are you?",
  "stream": false
}

Response:
{
  "response": "I'm doing well, thank you for asking!",
  ...
}
```

## Customization

### Change App Name

Edit `OllamaChatApp.swift`:
```swift
@main
struct MyAppName: App {
    // ...
}
```

### Change Colors

Edit `ContentView.swift`, replace:
```swift
.background(Color.blue)
```

With your color:
```swift
.background(Color(red: 0.5, green: 0.5, blue: 1.0))
```

### Add System Prompts

Edit `ChatViewModel.swift`, modify `sendMessage`:
```swift
let systemPrompt = "You are a helpful assistant."
let fullPrompt = "\(systemPrompt)\n\nUser: \(content)"
```

## Performance Tips

1. **Use Smaller Models** - orca-mini is 3x faster
2. **Increase RAM** - Give Ollama more system memory
3. **GPU Acceleration** - Enable CUDA/ROCm on Ollama server
4. **Close Background Apps** - Free up system resources
5. **Use WiFi** - Faster than cellular

## Future Enhancements

Possible improvements:
- Voice input/output
- Message persistence (save chat history)
- Multiple chat sessions
- Image support
- Custom system prompts
- Dark mode support
- Push notifications

## Contributing

To improve the app:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This app is provided as-is for educational and personal use.

## Support

For issues with:
- **The App**: Check this README or file an issue
- **Ollama**: Visit https://github.com/ollama/ollama
- **SwiftUI**: Check Apple Developer Documentation

## Resources

- [SwiftUI Documentation](https://developer.apple.com/xcode/swiftui/)
- [Ollama GitHub](https://github.com/ollama/ollama)
- [Ollama API Docs](https://github.com/ollama/ollama/blob/main/README.md#api)
- [iOS Development Guide](https://developer.apple.com/ios/)

---

**Enjoy chatting with Ollama on your iPhone!** 🚀📱
