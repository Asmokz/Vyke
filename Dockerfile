FROM python:3.12-slim

# Install system runtimes needed for code execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy application
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Persistent storage for saved projects
RUN mkdir -p projects

# Mount point for user workspace (configured via volume)
RUN mkdir -p /workspace

EXPOSE 4242

ENV VYKE_PORT=4242 \
    VYKE_OLLAMA_URL=http://host.docker.internal:11434 \
    VYKE_CHAT_MODEL=mistral-small3.2:24b \
    VYKE_CODE_MODEL=qwen2.5-coder:7b \
    VYKE_WORKSPACE=/workspace

WORKDIR /app/backend

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${VYKE_PORT:-4242} --log-level warning"]
