# 🤝 **Contributing to satai-mcp-proxy**

Welcome to the satware® AI MCP Proxy project! This guide will help you contribute effectively to our enterprise-grade MCP proxy solution.

## 🌿 **Git Workflow**

### **Branch Strategy**

We use a modified GitFlow strategy optimized for enterprise development:

```
main (production) ← release/x.x.x ← develop ← feature/ticket-description
                 ← hotfix/x.x.x
```

### **Branch Types**

| Branch Pattern | Purpose | Base Branch | Merge Target |
|---------------|---------|-------------|--------------|
| `feature/[ticket]-[description]` | New features | `develop` | `develop` |
| `bugfix/[ticket]-[description]` | Bug fixes | `develop` | `develop` |
| `hotfix/[version]-[description]` | Critical fixes | `main` | `main` + `develop` |
| `release/[version]` | Release prep | `develop` | `main` |
| `experiment/[description]` | R&D work | `develop` | `develop` (optional) |

### **Naming Conventions**

- **Feature branches**: `feature/SAT-123-add-alesi-integration`
- **Bug fixes**: `bugfix/SAT-456-fix-auth-timeout`
- **Hotfixes**: `hotfix/1.2.3-security-patch`
- **Releases**: `release/2.0.0`

## 🚀 **Development Process**

### **1. Starting New Work**

```bash
# Update your local develop branch
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/SAT-123-your-feature-name

# Start development
```

### **2. Development Guidelines**

- **Commit Messages**: Use conventional commits format
  ```
  feat(auth): add satware® AI token validation
  fix(server): resolve client connection timeout
  docs(readme): update installation instructions
  ```

- **Code Standards**:
  - Follow existing code style
  - Add JSDoc comments for functions
  - Include error handling
  - Write tests for new features

### **3. Pull Request Process**

1. **Push your branch**:
   ```bash
   git push origin feature/SAT-123-your-feature-name
   ```

2. **Create PR** targeting `develop` branch

3. **PR Requirements**:
   - [ ] Descriptive title and description
   - [ ] All tests pass
   - [ ] Code review completed
   - [ ] Documentation updated
   - [ ] Security considerations addressed

4. **Review Process**:
   - Minimum 1 reviewer required
   - All conversations must be resolved
   - CI/CD checks must pass

## 🧪 **Testing**

### **Running Tests**
```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run with coverage
pnpm test:coverage
```

### **Test Requirements**
- Unit tests for new functions
- Integration tests for API endpoints
- Manual testing documentation

## 📋 **Code Standards**

### **JavaScript/Node.js**
- Use modern ES6+ features
- Prefer `const` over `let`, avoid `var`
- Use async/await over promises
- Implement proper error handling

### **API Design**
- RESTful endpoints
- Consistent error responses
- Proper HTTP status codes
- Input validation

### **Security**
- Validate all inputs
- Use parameterized queries
- Implement rate limiting
- Follow OWASP guidelines

## 🔄 **Release Process**

### **Version Numbering**
We use semantic versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### **Release Steps**
1. Create release branch from `develop`
2. Update version numbers
3. Update CHANGELOG.md
4. Test thoroughly
5. Merge to `main` with tag
6. Deploy to production

## 🐛 **Bug Reports**

When reporting bugs, include:
- Environment details (Node.js version, OS)
- Steps to reproduce
- Expected vs actual behavior
- Error logs/screenshots
- Minimal reproduction case

## 💡 **Feature Requests**

For new features:
- Describe the use case
- Explain the business value
- Consider implementation complexity
- Discuss with team before starting

## 🔒 **Security**

- Never commit secrets or credentials
- Use environment variables for configuration
- Report security issues privately
- Follow responsible disclosure

## 📞 **Getting Help**

- **Technical Questions**: Create GitHub issue
- **Architecture Discussions**: Tag @satwareAG-ironMike
- **Security Issues**: Contact security@satware.ai

## 🏆 **Recognition**

Contributors will be recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project documentation

Thank you for contributing to satware® AI! 🚀