FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# 基本ツール + Node.js 22 インストール
RUN apt-get update && apt-get install -y \
    curl \
    git \
    wget \
    ca-certificates \
    gnupg \
    sudo \
    unzip \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI インストール
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Bun インストール
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Claude Code インストール（hanni が claude コマンドを使えるように）
RUN npm install -g @anthropic-ai/claude-code

# hanni ユーザー作成（sudo 権限付き）
RUN useradd -m -s /bin/bash hanni \
    && echo "hanni ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && cp -r /root/.bun /home/hanni/.bun \
    && chown -R hanni:hanni /home/hanni/.bun

USER hanni
ENV PATH="/home/hanni/.bun/bin:$PATH"

# アプリコードをコピー
WORKDIR /app
COPY --chown=hanni:hanni package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY --chown=hanni:hanni src/ ./src/
COPY --chown=hanni:hanni tsconfig.json ./
COPY --chown=hanni:hanni config.example.jsonc ./

# データディレクトリ（Fly volume がマウントされる）
RUN mkdir -p /data

EXPOSE 3460

# /data を CWD にして起動（config.json, tokens.json, repos/, worktrees/, logs/ が /data 以下に）
CMD ["sh", "-c", "mkdir -p /data/repos /data/worktrees /data/logs /data/.claude && ln -sf /data/.claude /home/hanni/.claude && cd /data && exec bun /app/src/index.ts"]
