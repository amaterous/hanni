FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/home/hanni

# Base dependencies
RUN apt-get update && apt-get install -y \
    curl wget git jq unzip sudo ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Create user with sudo access (container is isolated, allows autonomous package installs)
RUN useradd -m -s /bin/bash hanni \
    && echo "hanni ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Node.js (for npx / MCP servers)
USER root
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Chromium deps for Playwright (headless screenshots)
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 \
    libxfixes3 libxext6 libx11-6 libx11-xcb1 libxcb1 libxdamage1 \
    fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# OpenClaw CLI for agentic capabilities (requires nodejs)
USER root
RUN npm install -g openclaw

# Bun
USER hanni
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/hanni/.bun/bin:${PATH}"

# Claude Code CLI
USER root
RUN mkdir -p /home/hanni/.cache/claude /home/hanni/.local/bin \
    && chown -R hanni:hanni /home/hanni/.cache /home/hanni/.local
USER hanni
RUN curl -fsSL https://claude.ai/install.sh > /tmp/install-claude.sh \
    && bash /tmp/install-claude.sh \
    && rm /tmp/install-claude.sh
ENV PATH="/home/hanni/.local/bin:${PATH}"

# Claude onboarding skip + CLAUDE.md staged for entrypoint (not directly in .claude/ — volume may override)
RUN mkdir -p /home/hanni/.claude \
    && echo '{"hasCompletedOnboarding":true}' > /home/hanni/.claude.json
COPY --chown=hanni:hanni CLAUDE.md /opt/hanni/CLAUDE.md.default

# Caddy (run as root for port 443, then switch)
USER root
RUN apt-get update && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null \
    && apt-get update && apt-get install -y caddy \
    && rm -rf /var/lib/apt/lists/*

# App directory
RUN mkdir -p /opt/hanni && chown hanni:hanni /opt/hanni
WORKDIR /opt/hanni

# Copy dependency manifests first (changes rarely → cached)
COPY --chown=hanni:hanni package.json bun.lock /opt/hanni/

# Install dependencies (cached unless package.json/bun.lock change)
USER hanni
RUN cd /opt/hanni && bun install

# Install Playwright Chromium browser (cached with deps)
RUN cd /opt/hanni && npx playwright install chromium

# Copy app source (changes often, but only invalidates this layer)
COPY --chown=hanni:hanni . /opt/hanni/

# Data directories
RUN mkdir -p /opt/hanni/repos /opt/hanni/worktrees /opt/hanni/logs

USER root
COPY infra/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3460
ENTRYPOINT ["/entrypoint.sh"]
