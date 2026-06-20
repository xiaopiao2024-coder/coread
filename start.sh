#!/bin/bash
cd /home/claude/coread
export COREAD_PORT=3002
export COREAD_MCP_PORT=3003
node server.mjs &
node mcp-sse.mjs &
wait
