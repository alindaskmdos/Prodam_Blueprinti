# Контекст сборки — КОРЕНЬ репо (docker-compose.yml: context: ., dockerfile: frontend/Dockerfile):
# фронт импортирует ../contract (фикстуры моков, алиас @contract), без него `tsc` в build не пройдёт.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY contract contract
COPY frontend frontend
# VITE_USE_MOCKS не задан — прод без моков.
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
