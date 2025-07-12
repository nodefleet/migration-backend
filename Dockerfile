FROM ubuntu:22.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js and other dependencies
RUN apt-get update && \
    apt-get install -y curl wget tar file && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Create bin directory
RUN mkdir -p /app/bin

# Install Pocket Network CLI v0.1.19 - Direct binary download
RUN wget -q https://github.com/pokt-network/poktroll/releases/download/v0.1.26/pocket_linux_amd64.tar.gz -O /tmp/pocket.tar.gz && \
    tar -xzf /tmp/pocket.tar.gz -C /app/bin && \
    chmod +x /app/bin/pocketd && \
    ln -sf /app/bin/pocketd /usr/local/bin/pocketd && \
    rm /tmp/pocket.tar.gz && \
    echo "Installation complete. Testing binary:" && \
    pocketd version || echo "ERROR: pocketd CLI not found or invalid"

# Copy application code
COPY . .

# Create directories for migration data
RUN mkdir -p /app/data/input /app/data/output

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD pocketd version || exit 1

# Start the application
CMD ["npm", "run", "start"] 