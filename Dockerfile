FROM node:18-alpine

# Install required system dependencies
RUN apk add --no-cache curl bash wget tar file

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Create bin directory
RUN mkdir -p /app/bin

# Install Pocket Network CLI v0.1.19 - Direct binary download
RUN wget -q https://github.com/pokt-network/poktroll/releases/download/v0.1.19/pocketd-linux-amd64 -O /app/bin/pocketd && \
    chmod +x /app/bin/pocketd && \
    ln -sf /app/bin/pocketd /usr/local/bin/pocketd && \
    echo "Installation complete. Testing binary:" && \
    /app/bin/pocketd version || echo "ERROR: pocketd CLI not found or invalid"

# Copy application code
COPY . .

# Create directories for migration data
RUN mkdir -p /app/data/input /app/data/output

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD /app/bin/pocketd version || exit 1

# Start the application
CMD ["npm", "run", "start"] 