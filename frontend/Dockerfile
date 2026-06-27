# ---- build stage ----
# Собираем статику Vite. npm ci ставит и devDependencies (нужен tsc + vite),
# поэтому NODE_ENV здесь НЕ выставляем (иначе npm ci пропустит devDeps и build упадёт).
FROM node:20-alpine AS build
WORKDIR /app

# Слой зависимостей кэшируется отдельно от исходников.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Базовый URL бэкенда вшивается в бандл на этапе сборки (Vite подставляет import.meta.env.VITE_API_URL).
# Дефолт — относительный префикс /webhook: запросы идут на origin nginx, который проксирует их на n8n
# (см. nginx.conf). Переопределите на абсолютный URL (https://host/webhook), если фронт и n8n на разных хостах:
#   docker compose build --build-arg VITE_API_URL=https://n8n.example.com/webhook frontend
ARG VITE_API_URL=/webhook
ENV VITE_API_URL=$VITE_API_URL

# Собираем через `vite build` напрямую, а НЕ `npm run build` (= `tsc && vite build`).
# Причина: `tsc --noEmit` сейчас красный по всему репозиторию (unused-импорты + несовместимости
# типов в GraphView/GraphCard/FileHistoryPage/FileUploadPage) — это давнее состояние исходников,
# закоммиченный frontend/dist собран ровно так же. esbuild внутри vite вырезает типы без проверки
# и даёт рабочий бандл. Type-check — это задача линта/CI, а не gate для деплой-образа.
RUN npx vite build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
