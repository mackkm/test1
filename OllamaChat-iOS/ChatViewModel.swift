import Foundation

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isLoading = false
    @Published var serverUrl: String = "http://localhost:11434"
    @Published var selectedModel: String = "llama2"
    @Published var isConnected = false
    @Published var connectionStatus = ""
    @Published var serverStatus = "Checking connection..."
    @Published var availableModels = ["llama2", "mistral", "orca-mini", "neural-chat", "dolphin-phi"]

    private let apiClient = OllamaAPIClient()

    init() {
        loadSettings()
        checkConnection()
    }

    func sendMessage(_ content: String) {
        let userMessage = ChatMessage(
            id: UUID(),
            content: content,
            isUser: true,
            timestamp: getCurrentTime()
        )
        messages.append(userMessage)

        isLoading = true

        Task {
            do {
                let response = try await apiClient.generateResponse(
                    prompt: content,
                    model: selectedModel,
                    serverUrl: serverUrl
                )

                let assistantMessage = ChatMessage(
                    id: UUID(),
                    content: response,
                    isUser: false,
                    timestamp: getCurrentTime()
                )
                messages.append(assistantMessage)
            } catch {
                let errorMessage = ChatMessage(
                    id: UUID(),
                    content: "Error: \(error.localizedDescription)",
                    isUser: false,
                    timestamp: getCurrentTime()
                )
                messages.append(errorMessage)
            }

            isLoading = false
        }
    }

    func testConnection(serverUrl: String) {
        Task {
            do {
                connectionStatus = "Testing connection..."
                let success = try await apiClient.testConnection(serverUrl: serverUrl)
                if success {
                    connectionStatus = "✓ Connected successfully!"
                    isConnected = true
                } else {
                    connectionStatus = "✗ Connection failed"
                    isConnected = false
                }
            } catch {
                connectionStatus = "✗ Error: \(error.localizedDescription)"
                isConnected = false
            }
        }
    }

    func checkConnection() {
        Task {
            do {
                let success = try await apiClient.testConnection(serverUrl: serverUrl)
                isConnected = success
                serverStatus = success ? "Connected" : "Not connected"
            } catch {
                isConnected = false
                serverStatus = "Connection error"
            }
        }
    }

    func updateSettings(serverUrl: String, model: String) {
        self.serverUrl = serverUrl
        self.selectedModel = model
        saveSettings()
        checkConnection()
    }

    private func loadSettings() {
        if let savedUrl = UserDefaults.standard.string(forKey: "serverUrl") {
            serverUrl = savedUrl
        }
        if let savedModel = UserDefaults.standard.string(forKey: "selectedModel") {
            selectedModel = savedModel
        }
    }

    private func saveSettings() {
        UserDefaults.standard.set(serverUrl, forKey: "serverUrl")
        UserDefaults.standard.set(selectedModel, forKey: "selectedModel")
    }

    private func getCurrentTime() -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: Date())
    }
}

struct ChatMessage: Identifiable {
    let id: UUID
    let content: String
    let isUser: Bool
    let timestamp: String
}

class OllamaAPIClient {
    func generateResponse(
        prompt: String,
        model: String,
        serverUrl: String
    ) async throws -> String {
        let endpoint = "\(serverUrl)/api/generate"

        guard let url = URL(string: endpoint) else {
            throw APIError.invalidURL
        }

        let request = OllamaGenerateRequest(
            model: model,
            prompt: prompt,
            stream: false
        )

        let encoder = JSONEncoder()
        let requestBody = try encoder.encode(request)

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = requestBody
        urlRequest.timeoutInterval = 300 // 5 minute timeout for large responses

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError("Invalid response from server")
        }

        let decoder = JSONDecoder()
        let result = try decoder.decode(OllamaGenerateResponse.self, from: data)

        return result.response.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func testConnection(serverUrl: String) async throws -> Bool {
        let endpoint = "\(serverUrl)"

        guard let url = URL(string: endpoint) else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.timeoutInterval = 5

        do {
            let (_, response) = try await URLSession.shared.data(for: urlRequest)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

struct OllamaGenerateRequest: Codable {
    let model: String
    let prompt: String
    let stream: Bool
}

struct OllamaGenerateResponse: Codable {
    let response: String
}

enum APIError: LocalizedError {
    case invalidURL
    case serverError(String)
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .serverError(let message):
            return message
        case .decodingError:
            return "Failed to decode response"
        }
    }
}
