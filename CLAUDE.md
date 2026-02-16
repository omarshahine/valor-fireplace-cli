# Valor Fireplace CLI

A command-line tool to control Valor Fireplaces (powered by Mertik) via TCP/IP.

## Quick Reference

```bash
npm install        # Install dependencies
npm run build      # Build TypeScript
```

## Project Structure

```
src/
├── fp.ts          # CLI entry point (commander.js)
├── index.ts       # Library entry point
├── fireplace.ts   # TCP socket communication (port 2000)
└── models/        # Shared with homebridge-valor-fireplace
```

## Code Hygiene

- No hardcoded user paths (`/Users/[name]/`) - use `~/` or `${HOME}`
- No personal email addresses in tracked files (allowed: `@example.com`, `@anthropic.com`, `@noreply`)
- No API keys or secrets in code - use environment variables
- No phone numbers or PII in examples - use generic placeholders
