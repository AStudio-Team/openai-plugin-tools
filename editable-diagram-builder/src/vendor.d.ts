declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(info: unknown);
    registerTool(name: string, config: unknown, handler: (input: any) => Promise<any> | any): void;
    registerResource(name: string, uri: string, config: unknown, handler: () => Promise<any> | any): void;
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  }
}
declare module "@modelcontextprotocol/sdk/server/streamableHttp.js" {
  export class StreamableHTTPServerTransport {
    constructor(options: unknown);
    handleRequest(request: unknown, response: unknown, body: unknown): Promise<void>;
    close(): Promise<void>;
  }
}
