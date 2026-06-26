import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = ChatViewModel()
    @State private var messageText = ""
    @State private var showSettings = false

    var body: some View {
        ZStack {
            VStack {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Ollama Chat")
                            .font(.title2)
                            .fontWeight(.bold)
                        Text(viewModel.serverStatus)
                            .font(.caption)
                            .foregroundColor(viewModel.isConnected ? .green : .red)
                    }

                    Spacer()

                    Button(action: { showSettings = true }) {
                        Image(systemName: "gear")
                            .font(.title2)
                    }
                }
                .padding()
                .background(Color(.systemGray6))

                // Chat Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(viewModel.messages) { message in
                                ChatBubble(message: message)
                                    .id(message.id)
                            }

                            if viewModel.isLoading {
                                HStack {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                    Text("Thinking...")
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                    Spacer()
                                }
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(8)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        if let lastMessage = viewModel.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                }

                // Input Area
                HStack(spacing: 8) {
                    TextField("Message...", text: $messageText)
                        .textFieldStyle(.roundedBorder)
                        .disabled(viewModel.isLoading)

                    Button(action: sendMessage) {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.blue)
                            .cornerRadius(8)
                    }
                    .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isLoading)
                }
                .padding()
            }

            // Settings Sheet
            .sheet(isPresented: $showSettings) {
                SettingsView(viewModel: viewModel, isPresented: $showSettings)
            }
        }
    }

    private func sendMessage() {
        let trimmedMessage = messageText.trimmingCharacters(in: .whitespaces)
        guard !trimmedMessage.isEmpty else { return }

        messageText = ""
        viewModel.sendMessage(trimmedMessage)
    }
}

struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isUser {
                Spacer()
            }

            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(message.isUser ? Color.blue : Color(.systemGray6))
                    .foregroundColor(message.isUser ? .white : .black)
                    .cornerRadius(12)

                if !message.timestamp.isEmpty {
                    Text(message.timestamp)
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }

            if !message.isUser {
                Spacer()
            }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Binding var isPresented: Bool
    @State private var serverUrl = ""
    @State private var selectedModel = "llama2"

    var body: some View {
        NavigationView {
            Form {
                Section("Server Configuration") {
                    TextField("Server URL", text: $serverUrl)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onAppear {
                            serverUrl = viewModel.serverUrl
                        }

                    Picker("Model", selection: $selectedModel) {
                        ForEach(viewModel.availableModels, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }

                    Button(action: testConnection) {
                        Text("Test Connection")
                    }

                    if !viewModel.connectionStatus.isEmpty {
                        Text(viewModel.connectionStatus)
                            .font(.caption)
                            .foregroundColor(viewModel.isConnected ? .green : .red)
                    }
                }

                Section("About") {
                    Text("Ollama Chat v1.0")
                    Text("Built with SwiftUI")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        viewModel.updateSettings(
                            serverUrl: serverUrl,
                            model: selectedModel
                        )
                        isPresented = false
                    }
                }
            }
        }
    }

    private func testConnection() {
        viewModel.testConnection(serverUrl: serverUrl)
    }
}

#Preview {
    ContentView()
}
