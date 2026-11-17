FROM oven/bun:1-alpine
WORKDIR /app
COPY --chown=bun:bun . .
ENV PORT=3000 PUBLIC_DIR=./public
EXPOSE 3000
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e 'const r = await fetch("http://127.0.0.1:" + process.env.PORT + "/api/links"); if (!r.ok) process.exit(1)'
CMD ["bun", "server.js"]
