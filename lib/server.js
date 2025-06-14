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
        return res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to start satware® AI MCP clients'
        });
      }
    });

    // Enhanced MCP request handling with Alesi routing
    app.post('/mcp/:clientId', auth, async (req, res) => {
      const { clientId } = req.params;
      const request = req.body;
      const context = {
        user: req.user,
        alesi: req.alesi,
        auth: req.auth
      };

      try {
        const clientData = this.clients.get(clientId);
        if (!clientData) {
          return res.status(404).json({
            error: 'Client not found',
            message: `MCP client '${clientId}' not found or not started`
          });
        }

        // Update client usage metrics
        clientData.lastUsed = new Date();
        clientData.requestCount++;

        // Route request through Alesi if needed
        const selectedAgentId = this.alesi.routeToAgent(request, context);
        if (selectedAgentId !== clientData.agentId) {
          this.logger.info('Request routed to different agent', {
            clientId,
            originalAgent: clientData.agentId,
            selectedAgent: selectedAgentId,
            method: request.method
          });
        }

        const startTime = Date.now();
        const response = await clientData.client.request(request);
        const duration = Date.now() - startTime;

        // Add satware® AI metadata to response
        if (response && typeof response === 'object') {
          response._satware = {
            ecosystem: 'alesi-agi',
            agentId: clientData.agentId,
            agentName: clientData.agent.name,
            version: '2.0.0',
            duration,
            timestamp: new Date().toISOString()
          };
        }

        // Log interaction for analytics
        this.alesi.logInteraction(clientData.agentId, request, response, context);

        res.status(200).json(response);
      } catch (error) {
        this.metrics.errors++;
        this.logger.error('MCP request failed', {
          clientId,
          method: request.method,
          error: error.message,
          userId: context.user?.sub
        });

        res.status(500).json({
          error: 'MCP request failed',
          message: error.message,
          clientId,
          method: request.method
        });
      }
    });

    // List active clients with enhanced information
    app.get('/clients', auth, (req, res) => {
      const clientList = Array.from(this.clients.entries()).map(([id, data]) => ({
        id,
        agentId: data.agentId,
        agentName: data.agent.name,
        agentRole: data.agent.role,
        capabilities: data.agent.capabilities,
        specialization: data.agent.specialization,
        command: data.command || 'remote',
        createdAt: data.createdAt,
        lastUsed: data.lastUsed,
        requestCount: data.requestCount,
        userId: data.context.user?.sub
      }));

      res.status(200).json({
        clients: clientList,
        count: clientList.length,
        ecosystem: 'alesi-agi',
        platform: 'chat.satware.ai'
      });
    });

    // Stop specific client
    app.delete('/clients/:clientId', auth, (req, res) => {
      const { clientId } = req.params;
      const clientData = this.clients.get(clientId);

      if (!clientData) {
        return res.status(404).json({
          error: 'Client not found',
          message: `MCP client '${clientId}' not found`
        });
      }

      try {
        clientData.client.close();
        this.clients.delete(clientId);
        this.metrics.activeClients = this.clients.size;

        this.logger.info('MCP client stopped', {
          clientId,
          agentId: clientData.agentId,
          userId: req.user?.sub
        });

        res.status(200).json({
          message: `satware® AI MCP client '${clientId}' stopped successfully`,
          clientId,
          agentId: clientData.agentId
        });
      } catch (error) {
        this.logger.error('Error stopping client', {
          clientId,
          error: error.message
        });

        res.status(500).json({
          error: 'Failed to stop client',
          message: error.message
        });
      }
    });

    // Generate test token (development only)
    if (process.env.NODE_ENV === 'development') {
      app.post('/auth/token', (req, res) => {
        const { payload } = req.body;
        const token = this.auth.generateToken(payload);
        
        res.status(200).json({
          token,
          message: 'Development token generated',
          expires: '24 hours'
        });
      });
    }

    // Metrics endpoint
    app.get('/metrics', auth, (req, res) => {
      const uptime = Date.now() - this.metrics.startTime.getTime();
      const clientMetrics = Array.from(this.clients.values()).reduce((acc, client) => {
        acc.totalRequests += client.requestCount;
        acc.agents[client.agentId] = (acc.agents[client.agentId] || 0) + 1;
        return acc;
      }, { totalRequests: 0, agents: {} });

      res.status(200).json({
        service: 'satware® AI MCP Proxy',
        version: '2.0.0',
        ecosystem: 'alesi-agi',
        uptime: Math.floor(uptime / 1000),
        metrics: {
          ...this.metrics,
          activeClients: this.clients.size,
          clientRequests: clientMetrics.totalRequests,
          agentDistribution: clientMetrics.agents
        },
        timestamp: new Date().toISOString()
      });
    });

    // Error handling middleware
    app.use((error, req, res, next) => {
      this.metrics.errors++;
      this.logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        userId: req.user?.sub
      });

      res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred',
        service: 'satware® AI MCP Proxy'
      });
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        message: 'Endpoint not found',
        service: 'satware® AI MCP Proxy',
        availableEndpoints: [
          'GET /ping',
          'GET /agents',
          'POST /start',
          'POST /mcp/:clientId',
          'GET /clients',
          'DELETE /clients/:clientId',
          'GET /metrics'
        ]
      });
    });
  }

  async start(port = 50880) {
    const app = express();
    
    // Ensure logs directory exists
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    this.setupMiddleware(app);
    this.setupRoutes(app);

    // Find available port if specified port is in use
    const availablePort = await findAvailablePort(port);
    
    return new Promise((resolve, reject) => {
      const server = app.listen(availablePort, (error) => {
        if (error) {
          this.logger.error('Failed to start server', { error: error.message });
          reject(error);
        } else {
          this.logger.info('satware® AI MCP Proxy started successfully', {
            port: availablePort,
            version: '2.0.0',
            ecosystem: 'alesi-agi',
            platform: 'chat.satware.ai',
            environment: process.env.NODE_ENV || 'development'
          });
          resolve({ server, port: availablePort });
        }
      });

      // Graceful shutdown
      process.on('SIGTERM', () => {
        this.logger.info('Received SIGTERM, shutting down gracefully');
        server.close(() => {
          this.logger.info('satware® AI MCP Proxy stopped');
          process.exit(0);
        });
      });

      process.on('SIGINT', () => {
        this.logger.info('Received SIGINT, shutting down gracefully');
        server.close(() => {
          this.logger.info('satware® AI MCP Proxy stopped');
          process.exit(0);
        });
      });
    });
  }
}

module.exports = { SatwareMCPProxy };