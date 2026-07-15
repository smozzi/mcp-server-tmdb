# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV MCP_PROXY_HOST=0.0.0.0
ENV MCP_PROXY_PORT=8000

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Install mcp-proxy to expose the stdio MCP server over HTTP transports.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
    && python3 -m venv /opt/mcp-proxy-venv \
    && /opt/mcp-proxy-venv/bin/pip install --no-cache-dir mcp-proxy \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8000

USER node

# mcp-proxy listens on /mcp (streamable HTTP) and /sse, and spawns the local stdio server.
ENTRYPOINT ["/opt/mcp-proxy-venv/bin/mcp-proxy", "--pass-environment", "--stateless", "--host=0.0.0.0", "--port=8000", "node", "dist/index.js"]
