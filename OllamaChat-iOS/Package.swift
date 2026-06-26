// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "OllamaChat",
    platforms: [
        .iOS(.v15)
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "OllamaChat",
            dependencies: [],
            path: "Sources"
        )
    ]
)
