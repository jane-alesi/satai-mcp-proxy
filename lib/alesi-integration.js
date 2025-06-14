const { createLogger, format, transports } = require('winston');

/**
 * Alesi AGI Integration System
 * Manages connections and routing to the Alesi AGI family
 */
class AleseIntegration {
  constructor(options = {}) {
    this.logger = this.createLogger();
    this.aleseAgents = this.initializeAleseAgents();
    this.routingRules = this.initializeRoutingRules();
    this.capabilities = this.initializeCapabilities();
    
    // Configuration
    this.chatSatwareUrl = options.chatSatwareUrl || process.env.CHAT_SATWARE_URL || 'https://chat.satware.ai';
    this.aleseApiKey = options.aleseApiKey || process.env.ALESI_API_KEY;
    
    this.logger.info('Alesi AGI Integration initialized', {
      agentCount: Object.keys(this.aleseAgents).length,
      chatUrl: this.chatSatwareUrl
    });
  }

  createLogger() {
    return createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
      defaultMeta: { service: 'alesi-integration' },
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        })
      ]
    });
  }

  /**
   * Initialize the Alesi AGI family agents
   */
  initializeAleseAgents() {
    return {
      'jane-alesi': {
        name: 'Jane Alesi',
        role: 'Lead AI Architect & Foundation AGI',
        specialization: ['architecture', 'reasoning', 'leadership', 'integration'],
        description: 'Advanced AI architecture and system design, technical leadership and strategic planning',
        version: '9.3.2',
        capabilities: ['multi-phase-reasoning', 'verification-first', 'tool-orchestration', 'satway-integration'],
        priority: 1,
        status: 'active'
      },
      'wolfgang-alesi': {
        name: 'Wolfgang Alesi',
        role: 'Scientific Research Specialist',
        specialization: ['research', 'analysis', 'documentation', 'data'],
        description: 'Scientific research and analysis, academic and technical documentation',
        version: '2.1.0',
        capabilities: ['research-analysis', 'data-interpretation', 'academic-writing'],
        priority: 2,
        status: 'active'
      },
      'lenna-alesi': {
        name: 'Lenna Alesi',
        role: 'Visual Analysis Expert',
        specialization: ['image-analysis', 'visual-content', 'design', 'creative'],
        description: 'Image and visual content analysis, creative and design consultation',
        version: '1.8.0',
        capabilities: ['image-processing', 'visual-analysis', 'design-consultation'],
        priority: 3,
        status: 'active'
      },
      'john-alesi': {
        name: 'John Alesi',
        role: 'Software Development Specialist',
        specialization: ['programming', 'development', 'architecture', 'optimization'],
        description: 'Advanced software development and programming, technical architecture',
        version: '2.0.0',
        capabilities: ['code-generation', 'architecture-design', 'optimization'],
        priority: 2,
        status: 'active'
      },
      'leon-alesi': {
        name: 'Leon Alesi',
        role: 'IT Systems Integration Specialist',
        specialization: ['systems', 'integration', 'infrastructure', 'troubleshooting'],
        description: 'System integration and technical implementation, infrastructure planning',
        version: '1.9.0',
        capabilities: ['system-integration', 'infrastructure-planning', 'troubleshooting'],
        priority: 3,
        status: 'active'
      },
      'lara-alesi': {
        name: 'Lara Alesi',
        role: 'Medical AI Assistant & System Architect',
        specialization: ['medical', 'healthcare', 'systems', 'analysis'],
        description: 'Advanced medical AI assistance and healthcare system architecture',
        version: '1.5.0',
        capabilities: ['medical-analysis', 'healthcare-systems', 'clinical-support'],
        priority: 4,
        status: 'active'
      },
      'theo-alesi': {
        name: 'Theo Alesi',
        role: 'Financial & Investment Intelligence Specialist',
        specialization: ['finance', 'investment', 'analysis', 'strategy'],
        description: 'Advanced financial and investment intelligence, market analysis',
        version: '1.4.0',
        capabilities: ['financial-analysis', 'investment-strategy', 'market-intelligence'],
        priority: 4,
        status: 'active'
      }
    };
  }

  /**
   * Initialize routing rules for agent selection
   */
  initializeRoutingRules() {
    return {
      // Technical and Architecture queries
      architecture: ['jane-alesi', 'john-alesi'],
      technical: ['jane-alesi', 'john-alesi', 'leon-alesi'],
      programming: ['john-alesi', 'jane-alesi'],
      systems: ['leon-alesi', 'jane-alesi'],
      
      // Research and Analysis
      research: ['wolfgang-alesi', 'jane-alesi'],
      analysis: ['wolfgang-alesi', 'jane-alesi', 'theo-alesi'],
      data: ['wolfgang-alesi', 'jane-alesi'],
      
      // Visual and Creative
      visual: ['lenna-alesi'],
      image: ['lenna-alesi'],
      design: ['lenna-alesi'],
      creative: ['lenna-alesi'],
      
      // Domain-specific
      medical: ['lara-alesi'],
      healthcare: ['lara-alesi'],
      finance: ['theo-alesi'],
      investment: ['theo-alesi'],
      
      // Default fallback
      general: ['jane-alesi'],
      reasoning: ['jane-alesi'],
      integration: ['jane-alesi']
    };
  }

  /**
   * Initialize capability mappings
   */
  initializeCapabilities() {
    return {
      'multi-phase-reasoning': {
        description: 'Advanced multi-phase reasoning with adaptive complexity',
        agents: ['jane-alesi'],
        priority: 'high'
      },
      'verification-first': {
        description: 'Verification-first paradigm with autonomous fact-checking',
        agents: ['jane-alesi', 'wolfgang-alesi'],
        priority: 'high'
      },
      'tool-orchestration': {
        description: 'Advanced tool orchestration and integration',
        agents: ['jane-alesi', 'john-alesi', 'leon-alesi'],
        priority: 'medium'
      },
      'research-analysis': {
        description: 'Scientific research and data analysis',
        agents: ['wolfgang-alesi', 'jane-alesi'],
        priority: 'medium'
      },
      'visual-analysis': {
        description: 'Image and visual content analysis',
        agents: ['lenna-alesi'],
        priority: 'medium'
      },
      'code-generation': {
        description: 'Advanced code generation and optimization',
        agents: ['john-alesi', 'jane-alesi'],
        priority: 'medium'
      }
    };
  }

  /**
   * Route request to appropriate Alesi agent
   * @param {Object} request - MCP request
   * @param {Object} context - Request context
   * @returns {string} - Selected agent ID
   */
  routeToAgent(request, context = {}) {
    const { method, params } = request;
    const userPreference = context.alesi?.agentId;
    const query = params?.query || params?.name || '';
    
    // Honor user's agent preference if specified and valid
    if (userPreference && this.aleseAgents[userPreference]?.status === 'active') {
      this.logger.info('Using user-preferred agent', { 
        agentId: userPreference,
        method,
        userId: context.user?.sub 
      });
      return userPreference;
    }

    // Analyze query for routing hints
    const routingHints = this.analyzeQuery(query);
    const candidateAgents = this.selectCandidateAgents(routingHints);
    
    // Select best agent based on specialization and availability
    const selectedAgent = this.selectBestAgent(candidateAgents, method, context);
    
    this.logger.info('Agent routing completed', {
      selectedAgent,
      routingHints,
      candidateAgents: candidateAgents.slice(0, 3), // Log top 3 candidates
      method,
      userId: context.user?.sub
    });

    return selectedAgent;
  }

  /**
   * Analyze query for routing hints
   * @param {string} query - Query text
   * @returns {Array} - Array of routing hints
   */
  analyzeQuery(query) {
    const hints = [];
    const lowerQuery = query.toLowerCase();

    // Check for keyword matches
    for (const [category, agents] of Object.entries(this.routingRules)) {
      if (lowerQuery.includes(category)) {
        hints.push({ category, agents, confidence: 0.8 });
      }
    }

    // Check for capability matches
    for (const [capability, info] of Object.entries(this.capabilities)) {
      const keywords = capability.split('-');
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        hints.push({ 
          category: capability, 
          agents: info.agents, 
          confidence: 0.6,
          priority: info.priority 
        });
      }
    }

    // Default to general reasoning if no specific hints
    if (hints.length === 0) {
      hints.push({ category: 'general', agents: ['jane-alesi'], confidence: 0.3 });
    }

    return hints;
  }

  /**
   * Select candidate agents based on routing hints
   * @param {Array} routingHints - Routing hints
   * @returns {Array} - Sorted array of candidate agents
   */
  selectCandidateAgents(routingHints) {
    const agentScores = {};

    // Score agents based on routing hints
    routingHints.forEach(hint => {
      hint.agents.forEach(agentId => {
        if (!agentScores[agentId]) {
          agentScores[agentId] = 0;
        }
        agentScores[agentId] += hint.confidence * (hint.priority === 'high' ? 1.5 : 1.0);
      });
    });

    // Sort by score and agent priority
    return Object.entries(agentScores)
      .map(([agentId, score]) => ({
        agentId,
        score,
        priority: this.aleseAgents[agentId]?.priority || 5
      }))
      .sort((a, b) => {
        // First by score, then by agent priority
        if (Math.abs(a.score - b.score) < 0.1) {
          return a.priority - b.priority;
        }
        return b.score - a.score;
      })
      .map(item => item.agentId);
  }

  /**
   * Select the best agent from candidates
   * @param {Array} candidates - Candidate agent IDs
   * @param {string} method - MCP method
   * @param {Object} context - Request context
   * @returns {string} - Selected agent ID
   */
  selectBestAgent(candidates, method, context) {
    // Filter by active status
    const activeAgents = candidates.filter(agentId => 
      this.aleseAgents[agentId]?.status === 'active'
    );

    if (activeAgents.length === 0) {
      this.logger.warn('No active agents found, falling back to Jane Alesi');
      return 'jane-alesi';
    }

    // For tool calls, prefer agents with relevant capabilities
    if (method === 'tools/call') {
      const toolCapableAgents = activeAgents.filter(agentId => {
        const agent = this.aleseAgents[agentId];
        return agent.capabilities.includes('tool-orchestration') || 
               agent.capabilities.includes('multi-phase-reasoning');
      });
      
      if (toolCapableAgents.length > 0) {
        return toolCapableAgents[0];
      }
    }

    // Return the top candidate
    return activeAgents[0];
  }

  /**
   * Get agent information
   * @param {string} agentId - Agent ID
   * @returns {Object} - Agent information
   */
  getAgentInfo(agentId) {
    return this.aleseAgents[agentId] || this.aleseAgents['jane-alesi'];
  }

  /**
   * Get all available agents
   * @returns {Object} - All agents
   */
  getAllAgents() {
    return Object.entries(this.aleseAgents)
      .filter(([_, agent]) => agent.status === 'active')
      .reduce((acc, [id, agent]) => {
        acc[id] = agent;
        return acc;
      }, {});
  }

  /**
   * Create agent-specific MCP client configuration
   * @param {string} agentId - Agent ID
   * @param {Object} baseConfig - Base MCP configuration
   * @returns {Object} - Agent-specific configuration
   */
  createAgentConfig(agentId, baseConfig = {}) {
    const agent = this.getAgentInfo(agentId);
    
    return {
      ...baseConfig,
      name: `satware-mcp-${agentId}`,
      version: agent.version,
      metadata: {
        agent: agent,
        satware: {
          ecosystem: 'alesi-agi',
          platform: 'chat.satware.ai',
          integration: 'mcp-proxy'
        }
      },
      capabilities: agent.capabilities,
      specialization: agent.specialization
    };
  }

  /**
   * Log agent interaction for analytics
   * @param {string} agentId - Agent ID
   * @param {Object} request - MCP request
   * @param {Object} response - MCP response
   * @param {Object} context - Request context
   */
  logInteraction(agentId, request, response, context) {
    this.logger.info('Agent interaction completed', {
      agentId,
      agentName: this.aleseAgents[agentId]?.name,
      method: request.method,
      success: !response.error,
      userId: context.user?.sub,
      sessionId: context.alesi?.sessionId,
      duration: response.metadata?.duration,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = { AleseIntegration };