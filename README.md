# UnityMCP

UnityMCP is a powerful Unity Editor plugin that implements the Model Context Protocol (MCP), enabling seamless integration between Unity and AI assistants. It provides real-time editor state monitoring, remote command execution, and comprehensive logging capabilities.

![UnityMCP](https://github.com/user-attachments/assets/53965337-75b8-4f0e-88d2-b2a4069546f4)

## Architecture

The project consists of two main components:

### 1. Unity Plugin (UnityMCPPlugin)

A Unity Editor plugin that provides:
- Debug window for connection status and monitoring
- WebSocket client for real-time communication
- C# code execution engine
- Comprehensive logging system
- Editor state tracking and serialization

### 2. MCP Server (unity-mcp-server)

A TypeScript-based MCP server that exposes Unity Editor functionality through standardized tools:

#### Available Tools

1. `get_editor_state`
   - Retrieves current Unity Editor state
   - Includes active GameObjects, selection state, play mode status
   - Provides scene hierarchy and project structure
   - Supports different output formats (Raw, scripts only, no scripts)

2. `execute_editor_command`
   - Executes C# code directly in the Unity Editor
   - Full access to UnityEngine and UnityEditor APIs
   - Real-time execution with comprehensive error handling
   - Command timeout protection

3. `get_logs`
   - Retrieves and filters Unity Editor logs
   - Supports filtering by type, content, and timestamp
   - Customizable output fields
   - Buffer management for optimal performance

## Installation

### Prerequisites
- Unity 2022.3 or later
- Node.js 18 or later
- npm 9 or later

### Unity Plugin Setup

1. Copy the `UnityMCPPlugin` folder to your Unity project's Assets directory
2. Open Unity Editor
3. Access the plugin through Unity's top menu bar > UnityMCP > Debug Window

### MCP Server Setup

```bash
cd unity-mcp-server
npm install
npm run build
```

## Usage

### Starting the Server

```bash
cd unity-mcp-server
node build/index.js
```

### Connecting from Unity

1. Open your Unity project
2. Open the UnityMCP Debug Window (Window > UnityMCP > Debug Window)
3. The plugin will automatically attempt to connect to the MCP server
4. Monitor connection status and logs in the debug window

### Example: Executing Commands

```csharp
// Center the selected object
Selection.activeGameObject.transform.position = Vector3.zero;

// Toggle play mode
EditorApplication.isPlaying = !EditorApplication.isPlaying;

// Create a new cube
GameObject.CreatePrimitive(PrimitiveType.Cube);
```

## Development

### Building the Server

```bash
cd unity-mcp-server
npm run build
```

### Watching for Changes

```bash
npm run watch
```

### Inspecting MCP Communication

```bash
npm run inspector
```

## Technical Details

### Communication Protocol

- WebSocket-based communication on port 8080
- Bidirectional real-time updates
- JSON message format for all communications
- Automatic reconnection handling

### Security Features

- Command execution timeout protection
- Error handling and validation
- Log buffer management
- Connection state monitoring

### Error Handling

The system provides comprehensive error handling for:
- Connection issues
- Command execution failures
- Compilation errors
- Runtime exceptions
- Timeout scenarios

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0).
