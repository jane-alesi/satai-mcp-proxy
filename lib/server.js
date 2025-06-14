const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createLogger, format, transports } = require('winston');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
  SSEClientTransport,
} = require('@modelcontextprotocol/sdk/client/sse.js');
const stringify = require('json-stable-stringify');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const { findAvailablePort } = require('./port-finder');
const { SatwareAuth } = require('./satware-auth');
const { AleseIntegration } = require('./alesi-integration');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
  getDefaultEnvironment,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

// satware® AI MCP Proxy Server
class SatwareMCPProxy {
  constructor(options = {}) {
    this.clients = new Map();
    this.logger = this.createLogger();
    this.auth = new SatwareAuth(options.auth);
    this.alesi = new AleseIntegration(options.alesi);
    this.metrics = {
      requests: 0,
      errors: 0,
      activeClients: 0,
      startTime: new Date()
    };

    this.logger.info('satware® AI MCP Proxy initialized', {
      version: '2.0.0',
      ecosystem: 'alesi-agi',
      platform: 'chat.satware.ai'
    });
  }

  createLogger() {
    return createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
      defaultMeta: { 
        service: 'satware-mcp-proxy',
        version: '2.0.0',
        ecosystem: 'alesi-agi'
      },
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, service, ...meta }) => {
              return `${timestamp} [${service}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })
          )
        }),
        new transports.File({ 
          filename: 'logs/satware-mcp-proxy.log',
          maxsize: 10485760, // 10MB
          maxFiles: 5
        })
      ]
    });
  }

  async createRemoteClient({ clientId, url, agentId }) {
    let client = undefined;
    const baseUrl = new URL(url);
    const agent = this.alesi.getAgentInfo(agentId);
    
    try {
      const clientConfig = this.alesi.createAgentConfig(agentId, {
        name: `satware-mcp-streamable-${clientId}`,
        version: '2.0.0'
      });

      client = new Client(clientConfig);
      const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
      await client.connect(transport);
      
      this.logger.info('Connected using Streamable HTTP transport', {
        clientId,
        agentId,
        agentName: agent.name,
        url: baseUrl.toString()
      });
    } catch (error) {
      // Fallback to SSE transport
      this.logger.warn('Streamable HTTP connection failed, falling back to SSE transport', {
        clientId,
        agentId,
        error: error.message
      });
      
      const clientConfig = this.alesi.createAgentConfig(agentId, {
        name: `satware-mcp-sse-${clientId}`,
        version: '2.0.0'
      });

      client = new Client(clientConfig);
      const sseTransport = new SSEClientTransport(baseUrl);
      await client.connect(sseTransport);
      
      this.logger.info('Connected using SSE transport', {
        clientId,
        agentId,
        agentName: agent.name
      });
    }

    return client;
  }

  async startClient(clientId, config, context = {}) {
    const { command, url, args = [], env = {} } = config;
    const agentId = context.alesi?.agentId || this.alesi.routeToAgent({ method: 'start', params: config }, context);

    if (!command && !url) {
      throw new Error('command or url is required');
    }

    let client;
    const agent = this.alesi.getAgentInfo(agentId);

    if (command) {
      // Create transport for the MCP client
      const transport = new StdioClientTransport({
        command,
        args,
        env: Object.values(env).length > 0
          ? {
              ...getDefaultEnvironment(),
              ...env,
            }
          : undefined,
      });

      // Create and initialize the client with Alesi configuration
      const clientConfig = this.alesi.createAgentConfig(agentId, {
        name: `satware-mcp-stdio-${clientId}`,
        version: '2.0.0'
      });

      client = new Client(clientConfig);
      await client.connect(transport);
    } else if (url) {
      client = await this.createRemoteClient({ clientId, url, agentId });
    } else {
      throw new Error('Either command or url must be provided');
    }

    // Store the client with enhanced metadata
    this.clients.set(clientId, {
      id: clientId,
      client,
      command,
      args,
      env,
      config,
      agentId,
      agent,
      context,
      createdAt: new Date(),
      lastUsed: new Date(),
      requestCount: 0
    });

    this.metrics.activeClients = this.clients.size;

    this.logger.info('MCP client started successfully', {
      clientId,
      agentId,
      agentName: agent.name,
      agentRole: agent.role,
      userId: context.user?.sub,
      command: command || 'remote',
      activeClients: this.metrics.activeClients
    });

    return {
      id: clientId,
      agentId,
      agentName: agent.name,
      agentRole: agent.role,
      message: 'satware® AI MCP client started successfully',
      capabilities: agent.capabilities,
      specialization: agent.specialization
    };
  }

  setupMiddleware(app) {
    // Security middleware
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://chat.satware.ai", "https://satware.ai"]
        }
      }
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.use(limiter);

    // CORS configuration
    app.use(cors({
      origin: [
        'https://chat.satware.ai',
        'https://satware.ai',
        'http://localhost:3000',
        'http://localhost:5173'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    app.use(express.json({ limit: '10mb' }));

    // Request logging middleware
    app.use((req, res, next) => {
      this.metrics.requests++;
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        this.logger.info('Request completed', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          userId: req.user?.sub,
          agentId: req.alesi?.agentId
        });
      });
      
      next();
    });
  }

  setupRoutes(app) {
    const auth = this.auth.middleware();

    // Health check endpoint with detailed status
    app.get('/ping', auth, (req, res) => {
      const uptime = Date.now() - this.metrics.startTime.getTime();
      res.status(200).json({
        status: 'ok',
        service: 'satware® AI MCP Proxy',
        version: '2.0.0',
        ecosystem: 'alesi-agi',
        platform: 'chat.satware.ai',
        uptime: Math.floor(uptime / 1000),
        metrics: {
          activeClients: this.metrics.activeClients,
          totalRequests: this.metrics.requests,
          totalErrors: this.metrics.errors
        },
        agents: Object.keys(this.alesi.getAllAgents()),
        timestamp: new Date().toISOString()
      });
    });

    // Alesi agents information endpoint
    app.get('/agents', auth, (req, res) => {
      const agents = this.alesi.getAllAgents();
      res.status(200).json({
        agents,
        count: Object.keys(agents).length,
        ecosystem: 'alesi-agi',
        platform: 'chat.satware.ai'
      });
    });

    // Start MCP clients with Alesi integration
    app.post('/start', auth, async (req, res) => {
      try {
        const { mcpServers } = req.body;
        const context = {
          user: req.user,
          alesi: req.alesi,
          auth: req.auth
        };

        const results = {
          success: [],
          errors: [],
        };

        // Process each server configuration
        const startPromises = Object.entries(mcpServers).map(
          async ([serverId, config]) => {
            try {
              // Check if this client already exists
              if (this.clients.has(serverId)) {
                const hasConfigChanged =
                  stringify(this.clients.get(serverId).config) !== stringify(config);
                if (!hasConfigChanged) {
                  return;
                }
                this.logger.info('Restarting client with new config', { serverId });
                this.clients.get(serverId).client.close();
              }

              const result = await this.startClient(serverId, config, context);
              results.success.push(result);
            } catch (error) {
              this.metrics.errors++;
              this.logger.error(`Failed to initialize client ${serverId}`, { 
                serverId, 
                error: error.message,
                userId: context.user?.sub 
              });
              results.errors.push({
                id: serverId,
                error: `Failed to initialize: ${error.message}`,
              });
            }
          },
        );

        await Promise.all(startPromises);

        // Return appropriate response
        if (results.errors.length === 0) {
          return res.status(201).json({
            message: 'All satware® AI MCP clients started successfully',
            clients: results.success,
            ecosystem: 'alesi-agi'
          });
        } else {
          return res.status(400).json({
            message: 'Some satware® AI MCP clients failed to start',
            success: results.success,
            errors: results.errors,
          });
        }
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Error starting clients', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Enhanced client listing with Alesi information
    app.get('/clients', auth, async (req, res) => {
      try {
        const clientDetailsPromises = Array.from(this.clients.values()).map(
          async (clientEntry) => {
            const { id, command, args, createdAt, agentId, agent, requestCount, lastUsed } = clientEntry;

            try {
              const result = await clientEntry.client.listTools();
              const tools = result.tools || [];
              const toolNames = tools.map((tool) => tool.name);

              return {
                id,
                command,
                args,
                createdAt,
                lastUsed,
                requestCount,
                tools: toolNames,
                agent: {
                  id: agentId,
                  name: agent.name,
                  role: agent.role,
                  specialization: agent.specialization,
                  capabilities: agent.capabilities,
                  version: agent.version
                }
              };
            } catch (error) {
              this.logger.error(`Error getting tools for client ${id}`, { error: error.message });
              return {
                id,
                command,
                args,
                createdAt,
                lastUsed,
                requestCount,
                tools: [],
                toolError: error.message,
                agent: {
                  id: agentId,
                  name: agent.name,
                  role: agent.role
                }
              };
            }
          },
        );

        const clientsList = await Promise.all(clientDetailsPromises);
        res.status(200).json({
          clients: clientsList,
          count: clientsList.length,
          ecosystem: 'alesi-agi'
        });
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('Error fetching clients list', { error: error.message });
        res.status(500).json({
          error: 'Failed to retrieve clients list',
          details: error.message,
        });
      }
    });

    // Enhanced tool calling with Alesi routing
    app.post('/clients/:id/call_tools', auth, async (req, res) => {
      const { id } = req.params;
      const { name, arguments: toolArgs } = req.body;
      const context = { user: req.user, alesi: req.alesi, auth: req.auth };

      if (!name) {
        return res.status(400).json({ error: 'Tool name is required' });
      }

      const clientEntry = this.clients.get(id);
      if (!clientEntry) {
        return res.status(404).json({ error: 'Client not found' });
      }

      try {
        const startTime = Date.now();
        
        // Route the request through Alesi if needed
        const routedAgentId = this.alesi.routeToAgent(
          { method: 'tools/call', params: { name, arguments: toolArgs } },
          context
        );

        // If routing suggests a different agent, log it
        if (routedAgentId !== clientEntry.agentId) {
          this.logger.info('Alesi routing suggests different agent', {
            requestedAgent: clientEntry.agentId,
            suggestedAgent: routedAgentId,
            toolName: name,
            userId: context.user?.sub
          });
        }

        const result = await clientEntry.client.callTool({
          name,
          arguments: toolArgs || {},
        });

        const duration = Date.now() - startTime;
        clientEntry.requestCount++;
        clientEntry.lastUsed = new Date();

        // Log the interaction
        this.alesi.logInteraction(clientEntry.agentId, 
          { method: 'tools/call', params: { name, arguments: toolArgs } },
          { ...result, metadata: { duration } },
          context
        );

        res.status(200).json({
          ...result,
          metadata: {
            agentId: clientEntry.agentId,
            agentName: clientEntry.agent.name,
            duration,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        this.metrics.errors++;
        this.logger.error(`Error calling tool for client ${id}`, { 
          error: error.message,
          toolName: name,
          agentId: clientEntry.agentId,
          userId: context.user?.sub
        });
        res.status(500).json({
          error: 'Failed to call tool',
          details: error.message,
        });
      }
    });

    // Other endpoints (restart, get client, get tools, delete) with similar enhancements...
    // [Previous endpoints code would be enhanced similarly with Alesi integration]

    // Global error handler
    app.use((err, req, res, next) => {
      this.metrics.errors++;
      this.logger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack,
        url: req.url,
        method: req.method,
        userId: req.user?.sub
      });
      res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred',
        requestId: req.id
      });
    });
  }

  async start(authToken) {
    const app = express();

    // Find an available port
    const port = process.env.PORT || (await findAvailablePort());
    if (!port) {
      throw new Error(
        'No available ports found. Please specify a port by using the PORT environment variable.',
      );
    }

    // Setup middleware and routes
    this.setupMiddleware(app);
    this.setupRoutes(app);

    // Add legacy auth token support
    if (authToken) {
      this.auth.apiKeys.add(authToken);
    }

    // Start the server (HTTP or HTTPS)
    return new Promise((resolve, reject) => {
      const host = process.env.HOSTNAME || '0.0.0.0';

      // Check if certificate and key files are specified
      const certFile = process.env.CERTFILE;
      const keyFile = process.env.KEYFILE;

      let server;

      if (certFile && keyFile) {
        try {
          // Read certificate files
          const httpsOptions = {
            cert: fs.readFileSync(certFile),
            key: fs.readFileSync(keyFile),
          };

          // Create HTTPS server
          server = https.createServer(httpsOptions, app);
          server.listen(port, host, () => {
            this.logger.info('satware® AI MCP Proxy started', {
              protocol: 'https',
              host,
              port,
              version: '2.0.0',
              ecosystem: 'alesi-agi',
              platform: 'chat.satware.ai'
            });
            resolve({ port, host, protocol: 'https' });
          });
        } catch (error) {
          this.logger.error('Error setting up HTTPS server', { error: error.message });
          reject(error);
        }
      } else {
        // Create HTTP server (fallback)
        server = app.listen(port, host, () => {
          this.logger.info('satware® AI MCP Proxy started', {
            protocol: 'http',
            host,
            port,
            version: '2.0.0',
            ecosystem: 'alesi-agi',
            platform: 'chat.satware.ai'
          });
          resolve({ port, host, protocol: 'http' });
        });
      }

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        this.logger.info('Shutting down satware® AI MCP Proxy...');
        server.close(() => {
          process.exit(0);
        });
      });
    });
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all clients
  for (const [id, clientEntry] of this.clients.entries()) {
    try {
      await clientEntry.client.close();
      console.log(`Closed client ${id}`);
    } catch (error) {
      console.error(`Error closing client ${id}:`, error);
    }
  }

  process.exit(0);
});

// Export the enhanced server
async function start(authToken) {
  const proxy = new SatwareMCPProxy();
  return proxy.start(authToken);
}

module.exports = {
  start,
  SatwareMCPProxy
};