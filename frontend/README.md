# Meowdiobooks frontend

React + TypeScript + Vite wizard. The HTTP client uses `/api`; production contains no mock-data fallback. Brand artwork is served locally and typography uses an offline-safe editorial system stack.

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

Vite proxies `/api` to `http://127.0.0.1:8000` in development. The production build is emitted to `dist/` for FastAPI to serve.
