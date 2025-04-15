# Use Node.js base image
FROM node:20

# Set working directory
WORKDIR /app

# Copy dependencies first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all remaining files
COPY . .

# Cloud Run expects the app to listen on PORT (set by environment)
EXPOSE 8080

# Start the server
CMD [ "node", "index.js"]
