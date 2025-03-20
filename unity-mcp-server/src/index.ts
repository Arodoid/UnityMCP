#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';

interface UnityEditorState {
  activeGameObjects: string[];
  selectedObjects: string[];
  playModeState: string;
  sceneHierarchy: any;
  projectStructure: {
    [key: string]: string[];
  };
}

interface LogEntry {
  message: string;
  stackTrace: string;
  logType: string;
  timestamp: string;
}

class UnityMCPServer {
  private server: Server;
  private wsServer: WebSocketServer;
  private unityConnection: WebSocket | null = null;
  private editorState: UnityEditorState = {
    activeGameObjects: [],
    selectedObjects: [],
    playModeState: 'Stopped',
    sceneHierarchy: {},
    projectStructure: {}
  };

  private logBuffer: LogEntry[] = [];
  private readonly maxLogBufferSize = 1000;
  
  // Add command result promise handling
  private commandResultPromise: {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  } | null = null;
  private commandStartTime: number | null = null;

  constructor() {
    // Initialize MCP Server
    this.server = new Server(
      {
        name: 'unity-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize WebSocket Server for Unity communication
    this.wsServer = new WebSocketServer({ port: 8080 });
    this.setupWebSocket();
    this.setupTools();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private setupWebSocket() {
    console.error('[Unity MCP] WebSocket server starting on port 8080');
    
    this.wsServer.on('listening', () => {
      console.error('[Unity MCP] WebSocket server is listening for connections');
    });

    this.wsServer.on('error', (error) => {
      console.error('[Unity MCP] WebSocket server error:', error);
    });

    this.wsServer.on('connection', (ws: WebSocket) => {
      console.error('[Unity MCP] Unity Editor connected');
      this.unityConnection = ws;

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          console.error('[Unity MCP] Received message:', message.type);
          this.handleUnityMessage(message);
        } catch (error) {
          console.error('[Unity MCP] Error handling message:', error);
        }
      });

      ws.on('error', (error) => {
        console.error('[Unity MCP] WebSocket error:', error);
      });

      ws.on('close', () => {
        console.error('[Unity MCP] Unity Editor disconnected');
        this.unityConnection = null;
      });
    });
  }

  private handleUnityMessage(message: any) {
    switch (message.type) {
      case 'editorState':
        // Create a simplified version of the state
        const filteredData: UnityEditorState = {
          activeGameObjects: message.data.activeGameObjects || [],
          selectedObjects: message.data.selectedObjects || [],
          playModeState: message.data.playModeState || 'Stopped',
          sceneHierarchy: message.data.sceneHierarchy || {},
          projectStructure: {}
        };

        // Filter project structure to only include user files
        if (message.data.projectStructure) {
          Object.keys(message.data.projectStructure).forEach(key => {
            if (Array.isArray(message.data.projectStructure[key])) {
              filteredData.projectStructure[key] = (message.data.projectStructure[key] as string[]).filter(
                (path: string) => !path.startsWith('Packages/')
              );
            }
          });
        }

        this.editorState = filteredData;
        break;
      
      case 'commandResult':
      case 'menuItemResult':
        // Resolve the pending command result promise
        if (this.commandResultPromise) {
          this.commandResultPromise.resolve(message.data);
          this.commandResultPromise = null;
        }
        break;

      case 'log':
        this.handleLogMessage(message.data);
        break;
      
      default:
        console.error('[Unity MCP] Unknown message type:', message.type);
    }
  }

  private setupTools() {
    // List available tools with comprehensive documentation
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_editor_state',
          description: 'Retrieve the current state of the Unity Editor, including active GameObjects, selection state, play mode status, scene hierarchy, and project structure. This tool provides a comprehensive snapshot of the editor\'s current context.',
          category: 'Editor State',
          tags: ['unity', 'editor', 'state', 'hierarchy', 'project'],
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: ['Raw', 'scripts only', 'no scripts'],
                description: 'Specify the output format:\n- Raw: Complete editor state including all available data\n- scripts only: Returns only the list of script files in the project\n- no scripts: Returns everything except script-related information',
                default: 'Raw'
              }
            },
            additionalProperties: false
          },
          returns: {
            type: 'object',
            description: 'Returns a JSON object containing the requested editor state information',
            format: 'The response format varies based on the format parameter:\n- Raw: Full UnityEditorState object\n- scripts only: Array of script file paths\n- no scripts: UnityEditorState minus script-related fields'
          },
          examples: [
            {
              description: 'Get complete editor state',
              input: {},
              output: '{ "activeGameObjects": ["Main Camera", "Directional Light"], ... }'
            },
            {
              description: 'Get only script files',
              input: { format: 'scripts only' },
              output: '["Assets/Scripts/Player.cs", "Assets/Scripts/Enemy.cs"]'
            }
          ]
        },
        {
          name: 'execute_menu_item',
          description: 'Execute a Unity menu item by path. This allows you to trigger any menu command available in the Unity Editor, such as creating objects, running menu commands, or executing editor functions.',
          category: 'Editor Control',
          tags: ['unity', 'editor', 'menu', 'command'],
          inputSchema: {
            type: 'object',
            properties: {
              menuPath: {
                type: 'string',
                description: 'The path to the menu item to execute (e.g. "GameObject/Create Empty" or "Window/Package Manager")',
                minLength: 1,
                examples: [
                  'GameObject/Create Empty',
                  'Window/Package Manager',
                  'Assets/Create/C# Script'
                ]
              }
            },
            required: ['menuPath'],
            additionalProperties: false
          },
          returns: {
            type: 'object',
            description: 'Returns the execution result including success status and message',
            format: 'JSON object containing "success" and "message" fields'
          },
          examples: [
            {
              description: 'Create an empty GameObject',
              input: {
                menuPath: 'GameObject/Create Empty'
              },
              output: '{ "success": true, "message": "Successfully executed menu item: GameObject/Create Empty" }'
            },
            {
              description: 'Open Package Manager',
              input: {
                menuPath: 'Window/Package Manager'
              },
              output: '{ "success": true, "message": "Successfully executed menu item: Window/Package Manager" }'
            }
          ]
        },
        {
          name: 'execute_editor_command',
          description: 'Execute arbitrary C# code within the Unity Editor context. This powerful tool allows for direct manipulation of the Unity Editor, GameObjects, components, and project assets using the Unity Editor API.',
          category: 'Editor Control',
          tags: ['unity', 'editor', 'command', 'c#', 'scripting'],
          inputSchema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'C# code to execute in the Unity Editor context. The code has access to all UnityEditor and UnityEngine APIs.',
                minLength: 1,
                examples: [
                  'Selection.activeGameObject.transform.position = Vector3.zero;',
                  'EditorApplication.isPlaying = !EditorApplication.isPlaying;'
                ]
              }
            },
            required: ['code'],
            additionalProperties: false
          },
          returns: {
            type: 'object',
            description: 'Returns the execution result and any logs generated during execution',
            format: 'JSON object containing "result" and "logs" fields'
          },
          errorHandling: {
            description: 'Common error scenarios and their handling:',
            scenarios: [
              {
                error: 'Compilation error',
                handling: 'Returns compilation error details in logs'
              },
              {
                error: 'Runtime exception',
                handling: 'Returns exception details and stack trace'
              },
              {
                error: 'Timeout',
                handling: 'Command execution timeout after 5 seconds'
              }
            ]
          },
          examples: [
            {
              description: 'Center selected object',
              input: {
                code: 'var selected = Selection.activeGameObject; if(selected != null) { selected.transform.position = Vector3.zero; }'
              },
              output: '{ "result": true, "logs": ["[UnityMCP] Command executed successfully"] }'
            }
          ]
        },
        {
          name: 'get_logs',
          description: 'Retrieve and filter Unity Editor logs with comprehensive filtering options. This tool provides access to editor logs, console messages, warnings, errors, and exceptions with powerful filtering capabilities.',
          category: 'Debugging',
          tags: ['unity', 'editor', 'logs', 'debugging', 'console'],
          inputSchema: {
            type: 'object',
            properties: {
              types: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['Log', 'Warning', 'Error', 'Exception'],
                  description: 'Log entry types to include'
                },
                description: 'Filter logs by type. If not specified, all types are included.',
                examples: [['Error', 'Exception'], ['Log', 'Warning']]
              },
              count: {
                type: 'number',
                description: 'Maximum number of log entries to return',
                minimum: 1,
                maximum: 1000,
                default: 100
              },
              fields: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['message', 'stackTrace', 'logType', 'timestamp']
                },
                description: 'Specify which fields to include in the output. If not specified, all fields are included.',
                examples: [['message', 'logType'], ['message', 'stackTrace', 'timestamp']]
              },
              messageContains: {
                type: 'string',
                description: 'Filter logs to only include entries where the message contains this string (case-sensitive)',
                minLength: 1
              },
              stackTraceContains: {
                type: 'string',
                description: 'Filter logs to only include entries where the stack trace contains this string (case-sensitive)',
                minLength: 1
              },
              timestampAfter: {
                type: 'string',
                description: 'Filter logs after this ISO timestamp (inclusive)',
                format: 'date-time',
                example: '2024-01-14T00:00:00Z'
              },
              timestampBefore: {
                type: 'string',
                description: 'Filter logs before this ISO timestamp (inclusive)',
                format: 'date-time',
                example: '2024-01-14T23:59:59Z'
              }
            },
            additionalProperties: false
          },
          returns: {
            type: 'array',
            description: 'Returns an array of log entries matching the specified filters',
            format: 'Array of objects containing requested log entry fields'
          },
          examples: [
            {
              description: 'Get recent error logs',
              input: {
                types: ['Error', 'Exception'],
                count: 10,
                fields: ['message', 'timestamp']
              },
              output: '[{"message": "NullReferenceException", "timestamp": "2024-01-14T12:00:00Z"}, ...]'
            },
            {
              description: 'Search logs for specific message',
              input: {
                messageContains: 'Player',
                fields: ['message', 'logType']
              },
              output: '[{"message": "Player position updated", "logType": "Log"}, ...]'
            }
          ]
        },
      ],
    }));

    // Handle tool calls with enhanced validation and error handling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Verify Unity connection with detailed error message
      if (!this.unityConnection) {
        throw new McpError(
          ErrorCode.InternalError,
          'Unity Editor is not connected. Please ensure the Unity Editor is running and the UnityMCP window is open.'
        );
      }

      const { name, arguments: args } = request.params;

      // Validate tool exists with helpful error message
      const availableTools = ['get_editor_state', 'execute_editor_command', 'execute_menu_item', 'get_logs'];
      if (!availableTools.includes(name)) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}. Available tools are: ${availableTools.join(', ')}`
        );
      }

      // Validate arguments based on tool schemas
      switch (name) {
        case 'get_editor_state': {
          // Validate format parameter
          const validFormats = ['Raw', 'scripts only', 'no scripts'];
          const format = args?.format as string || 'Raw';
          
          if (args?.format && !validFormats.includes(format)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid format: "${format}". Valid formats are: ${validFormats.join(', ')}`
            );
          }

          let responseData: any;

          try {
            switch (format) {
              case 'Raw':
                responseData = this.editorState;
                break;
              case 'scripts only':
                responseData = this.editorState.projectStructure.scripts || [];
                break;
              case 'no scripts': {
                const { projectStructure, ...stateWithoutScripts } = {...this.editorState};
                const { scripts, ...otherStructure } = {...projectStructure};
                responseData = {
                  ...stateWithoutScripts,
                  projectStructure: otherStructure
                };
                break;
              }
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(responseData, null, 2)
              }]
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to process editor state: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        case 'execute_menu_item': {
          // Validate menuPath parameter
          if (!args?.menuPath) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The menuPath parameter is required'
            );
          }
          
          if (typeof args.menuPath !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The menuPath parameter must be a string'
            );
          }

          if (args.menuPath.trim().length === 0) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The menuPath parameter cannot be empty'
            );
          }

          try {
            // Send command to Unity
            this.unityConnection.send(JSON.stringify({
              type: 'executeMenuItem',
              data: { menuPath: args.menuPath },
            }));

            // Wait for result with timeout handling
            const timeoutMs = 5000;
            const result = await Promise.race([
              new Promise((resolve, reject) => {
                this.commandResultPromise = { resolve, reject };
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                  `Menu item execution timed out after ${timeoutMs/1000} seconds. This may indicate a long-running menu operation or that the menu item doesn't exist.`
                )), timeoutMs)
              )
            ]);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            // Enhanced error handling
            if (error instanceof Error) {
              if (error.message.includes('timed out')) {
                throw new McpError(
                  ErrorCode.InternalError,
                  error.message
                );
              }
            }

            // Generic error fallback
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to execute menu item: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        case 'execute_editor_command': {
          // Validate code parameter
          if (!args?.code) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The code parameter is required'
            );
          }
          
          if (typeof args.code !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The code parameter must be a string'
            );
          }

          if (args.code.trim().length === 0) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'The code parameter cannot be empty'
            );
          }

          try {
            // Clear previous logs and set command start time
            const startLogIndex = this.logBuffer.length;
            this.commandStartTime = Date.now();

            // Send command to Unity
            this.unityConnection.send(JSON.stringify({
              type: 'executeEditorCommand',
              data: { code: args.code },
            }));

            // Wait for result with enhanced timeout handling
            const timeoutMs = 5000;
            const result = await Promise.race([
              new Promise((resolve, reject) => {
                this.commandResultPromise = { resolve, reject };
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                  `Command execution timed out after ${timeoutMs/1000} seconds. This may indicate a long-running operation or an issue with the Unity Editor.`
                )), timeoutMs)
              )
            ]);

            // Get logs that occurred during command execution
            const commandLogs = this.logBuffer
              .slice(startLogIndex)
              .filter(log => log.message.includes('[UnityMCP]'));

            // Calculate execution time
            const executionTime = Date.now() - this.commandStartTime;

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    result,
                    logs: commandLogs,
                    executionTime: `${executionTime}ms`,
                    status: 'success'
                  }, null, 2),
                },
              ],
            };
          } catch (error) {
            // Enhanced error handling with specific error types
            if (error instanceof Error) {
              if (error.message.includes('timed out')) {
                throw new McpError(
                  ErrorCode.InternalError,
                  error.message
                );
              }
              
              // Check for common Unity-specific errors
              if (error.message.includes('NullReferenceException')) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  'The code attempted to access a null object. Please check that all GameObject references exist.'
                );
              }

              if (error.message.includes('CompileError')) {
                throw new McpError(
                  ErrorCode.InvalidParams,
                  'C# compilation error. Please check the syntax of your code.'
                );
              }
            }

            // Generic error fallback
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        case 'get_logs': {
          const options = {
            types: args?.types as string[] | undefined,
            count: args?.count as number || 100,
            fields: args?.fields as string[] | undefined,
            messageContains: args?.messageContains as string | undefined,
            stackTraceContains: args?.stackTraceContains as string | undefined,
            timestampAfter: args?.timestampAfter as string | undefined,
            timestampBefore: args?.timestampBefore as string | undefined
          };
          
          const logs = this.filterLogs(options);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(logs, null, 2),
              },
            ],
          };
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
      }
    });
  }

  private handleLogMessage(logEntry: LogEntry) {
    // Add to buffer, removing oldest if at capacity
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > this.maxLogBufferSize) {
      this.logBuffer.shift();
    }
  }

  private filterLogs(options: {
    types?: string[],
    count?: number,
    fields?: string[],
    messageContains?: string,
    stackTraceContains?: string,
    timestampAfter?: string,
    timestampBefore?: string
  }): any[] {
    const {
      types,
      count = 100,
      fields,
      messageContains,
      stackTraceContains,
      timestampAfter,
      timestampBefore
    } = options;

    // First apply all filters
    let filteredLogs = this.logBuffer
      .filter(log => {
        // Type filter
        if (types && !types.includes(log.logType)) return false;
        
        // Message content filter
        if (messageContains && !log.message.includes(messageContains)) return false;
        
        // Stack trace content filter
        if (stackTraceContains && !log.stackTrace.includes(stackTraceContains)) return false;
        
        // Timestamp filters
        if (timestampAfter && new Date(log.timestamp) < new Date(timestampAfter)) return false;
        if (timestampBefore && new Date(log.timestamp) > new Date(timestampBefore)) return false;
        
        return true;
      });

    // Then apply count limit
    filteredLogs = filteredLogs.slice(-count);

    // Finally apply field selection if specified
    if (fields?.length) {
      return filteredLogs.map(log => {
        const selectedFields: Partial<LogEntry> = {};
        fields.forEach(field => {
          if (field in log && (field === 'message' || field === 'stackTrace' ||
              field === 'logType' || field === 'timestamp')) {
            selectedFields[field as keyof LogEntry] = log[field as keyof LogEntry];
          }
        });
        return selectedFields;
      });
    }

    return filteredLogs;
  }

  private async cleanup() {
    if (this.unityConnection) {
      this.unityConnection.close();
    }
    this.wsServer.close();
    await this.server.close();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Unity MCP server running on stdio');
    
    // Wait for WebSocket server to be ready
    await new Promise<void>((resolve) => {
      this.wsServer.once('listening', () => {
        console.error('[Unity MCP] WebSocket server is ready on port 8080');
        resolve();
      });
    });
  }
}

const server = new UnityMCPServer();
server.run().catch(console.error);
