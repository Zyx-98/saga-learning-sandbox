# -------- Development Stage --------
FROM node:22-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev"]

# -------- Build Stage --------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=development /app /app

RUN npm run build

# -------- Production Stage --------
FROM node:22-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.env ./.env

EXPOSE 3000

CMD ["npm", "run", "start"]