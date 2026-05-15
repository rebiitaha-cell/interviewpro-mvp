FROM node:20-alpine

# Install system dependencies needed for shell tools
RUN apk add --no-cache \
    git \
    curl \
    bash \
    postgresql-client \
    openssh-client

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source files
COPY src/ ./src/

# Create non-root user for security
RUN addgroup -S aicc && adduser -S aicc -G aicc
RUN chown -R aicc:aicc /app
USER aicc

EXPOSE 3010

CMD ["node", "src/index.js"]
