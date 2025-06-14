const jwt = require('jsonwebtoken');
const { createLogger, format, transports } = require('winston');

// satware® AI Authentication & Authorization System
class SatwareAuth {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || process.env.SATWARE_JWT_SECRET || 'satware-ai-secret-key';
    this.apiKeys = new Set(options.apiKeys || []);
    this.logger = this.createLogger();
    
    // Add default API key from environment
    if (process.env.SATWARE_API_KEY) {
      this.apiKeys.add(process.env.SATWARE_API_KEY);
    }
  }

  createLogger() {
    return createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
      ),
      defaultMeta: { service: 'satware-auth' },
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
   * Validate satware® AI JWT token
   * @param {string} token - JWT token
   * @returns {Object|null} - Decoded token or null if invalid
   */
  validateJWT(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Validate satware® AI specific claims
      if (!decoded.iss || !decoded.iss.includes('satware.ai')) {
        this.logger.warn('Invalid issuer in JWT token', { issuer: decoded.iss });
        return null;
      }

      if (!decoded.sub || !decoded.aud) {
        this.logger.warn('Missing required JWT claims', { sub: decoded.sub, aud: decoded.aud });
        return null;
      }

      return decoded;
    } catch (error) {
      this.logger.error('JWT validation failed', { error: error.message });
      return null;
    }
  }

  /**
   * Validate API key
   * @param {string} apiKey - API key to validate
   * @returns {boolean} - True if valid
   */
  validateApiKey(apiKey) {
    return this.apiKeys.has(apiKey);
  }

  /**
   * Extract Alesi agent information from token
   * @param {Object} decodedToken - Decoded JWT token
   * @returns {Object} - Alesi agent info
   */
  extractAleseInfo(decodedToken) {
    return {
      agentId: decodedToken.agent_id || 'jane-alesi',
      agentType: decodedToken.agent_type || 'foundation',
      capabilities: decodedToken.capabilities || ['reasoning', 'analysis'],
      accessLevel: decodedToken.access_level || 'standard',
      userId: decodedToken.sub,
      sessionId: decodedToken.session_id
    };
  }

  /**
   * Check if user has permission for specific operation
   * @param {Object} aleseInfo - Alesi agent info
   * @param {string} operation - Operation to check
   * @returns {boolean} - True if authorized
   */
  hasPermission(aleseInfo, operation) {
    const permissions = {
      'standard': ['read', 'execute'],
      'premium': ['read', 'execute', 'create'],
      'enterprise': ['read', 'execute', 'create', 'admin'],
      'developer': ['read', 'execute', 'create', 'admin', 'debug']
    };

    const userPermissions = permissions[aleseInfo.accessLevel] || permissions['standard'];
    return userPermissions.includes(operation);
  }

  /**
   * Create authentication middleware for Express
   * @param {Object} options - Middleware options
   * @returns {Function} - Express middleware
   */
  middleware(options = {}) {
    const requireAuth = options.requireAuth !== false;
    const requiredPermission = options.permission || 'read';

    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        if (!requireAuth) return next();
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Please provide Authorization header with Bearer token or API key'
        });
      }

      let authResult = null;

      // Try JWT token first
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = this.validateJWT(token);
        
        if (decoded) {
          authResult = {
            type: 'jwt',
            user: decoded,
            alesi: this.extractAleseInfo(decoded)
          };
        }
      }
      
      // Fallback to API key
      if (!authResult && authHeader.startsWith('ApiKey ')) {
        const apiKey = authHeader.substring(7);
        if (this.validateApiKey(apiKey)) {
          authResult = {
            type: 'apikey',
            user: { sub: 'api-user', iss: 'satware.ai' },
            alesi: {
              agentId: 'jane-alesi',
              agentType: 'foundation',
              capabilities: ['reasoning', 'analysis'],
              accessLevel: 'enterprise',
              userId: 'api-user'
            }
          };
        }
      }

      // Legacy Bearer token support (for backward compatibility)
      if (!authResult && authHeader.startsWith('Bearer ') && !authHeader.includes('.')) {
        const legacyToken = authHeader.substring(7);
        if (this.validateApiKey(legacyToken)) {
          authResult = {
            type: 'legacy',
            user: { sub: 'legacy-user', iss: 'satware.ai' },
            alesi: {
              agentId: 'jane-alesi',
              agentType: 'foundation',
              capabilities: ['reasoning', 'analysis'],
              accessLevel: 'standard',
              userId: 'legacy-user'
            }
          };
        }
      }

      if (!authResult) {
        this.logger.warn('Authentication failed', { 
          ip: req.ip, 
          userAgent: req.get('User-Agent'),
          authHeader: authHeader.substring(0, 20) + '...'
        });
        
        return res.status(401).json({
          error: 'Invalid authentication',
          message: 'Invalid token or API key'
        });
      }

      // Check permissions
      if (!this.hasPermission(authResult.alesi, requiredPermission)) {
        this.logger.warn('Insufficient permissions', {
          userId: authResult.user.sub,
          accessLevel: authResult.alesi.accessLevel,
          requiredPermission,
          ip: req.ip
        });

        return res.status(403).json({
          error: 'Insufficient permissions',
          message: `Operation requires '${requiredPermission}' permission`
        });
      }

      // Add auth info to request
      req.auth = authResult;
      req.user = authResult.user;
      req.alesi = authResult.alesi;

      this.logger.info('Authentication successful', {
        userId: authResult.user.sub,
        agentId: authResult.alesi.agentId,
        authType: authResult.type,
        ip: req.ip
      });

      next();
    };
  }

  /**
   * Generate a JWT token for testing/development
   * @param {Object} payload - Token payload
   * @returns {string} - JWT token
   */
  generateToken(payload = {}) {
    const defaultPayload = {
      iss: 'chat.satware.ai',
      sub: 'test-user',
      aud: 'satai-mcp-proxy',
      agent_id: 'jane-alesi',
      agent_type: 'foundation',
      access_level: 'enterprise',
      capabilities: ['reasoning', 'analysis', 'integration'],
      session_id: 'test-session-' + Date.now(),
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 hours
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign({ ...defaultPayload, ...payload }, this.jwtSecret);
  }
}

module.exports = { SatwareAuth };