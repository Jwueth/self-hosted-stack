# Self-Hosted Stack

A modular Docker Compose homelab stack running 20+ services behind a single Nginx reverse proxy with Authelia SSO. Every service is an independent compose file, all sharing one external Docker network and one centralized `.env` for configuration.

## Architecture

```
                        ┌─────────────┐
                   :80  │             │  :443
            ┌──────────►│    Nginx    │◄──────────┐
            │           │  (reverse   │           │
            │           │   proxy)    │           │
            │           └──────┬──────┘           │
            │                  │                  │
            │           ┌──────▼──────┐           │
            │           │  Authelia   │           │
            │           │   (SSO)     │           │
            │           └──────┬──────┘           │
            │                  │                  │
     ┌──────┴──────────────────┼──────────────────┴──────┐
     │                    localnet                        │
     │                  (Docker network)                  │
     ├───────────┬───────────┬───────────┬───────────┐    │
     │           │           │           │           │    │
  ┌──▼──┐   ┌───▼──┐   ┌───▼──┐   ┌───▼──┐   ┌───▼──┐ │
  │ n8n │   │Next- │   │Glance│   │Ollama│   │ ...  │ │
  │     │   │cloud │   │      │   │+ Web │   │      │ │
  └──┬──┘   └───┬──┘   └──────┘   │  UI  │   └──────┘ │
     │          │                  └───┬──┘             │
     │          │                      │                │
  ┌──▼──────────▼──────────────────────▼──┐             │
  │         Shared PostgreSQL 16          │             │
  │  (n8n, gitea, nocodb, metabase DBs)   │             │
  └───────────────────────────────────────┘             │
     └──────────────────────────────────────────────────┘
```

All services bind to a Tailscale IP for LAN/VPN access and get public HTTPS subdomains via Nginx.

## Services

| Directory | Services | Description |
|-----------|----------|-------------|
| `nginx/` | Nginx | Reverse proxy, TLS termination |
| `authelia/` | Authelia | Single sign-on & 2FA |
| `database/` | PostgreSQL 16, pgAdmin | Shared database for multiple services |
| `n8n/` | n8n | Workflow automation |
| `ai/` | Ollama, Open WebUI, Qdrant | Local LLMs + vector DB for RAG |
| `nextcloud/` | Nextcloud, MariaDB | File sync & cloud storage |
| `gitea/` | Gitea | Self-hosted Git |
| `media/` | Calibre, Calibre-Web, YourSpotify, MongoDB | E-books & Spotify stats |
| `mediamanager/` | MediaManager, PostgreSQL 17, qBittorrent | Media library management |
| `nocodb/` | NocoDB | Airtable alternative (on shared Postgres) |
| `metabase/` | Metabase | Analytics dashboards (on shared Postgres) |
| `monitoring/` | Uptime Kuma | Service uptime monitoring |
| `glance/` | Glance | Main dashboard (Docker status, Spotify, weather, news) |
| `homepage/` | Homepage, LoL Matches API | Secondary dashboard |
| `portainer/` | Portainer CE | Container management UI |
| `ig-profile/` | VNC Firefox, Playwright | Instagram screenshot automation |
| `zerobyte/` | Zerobyte | Encrypted backup agent |

## Prerequisites

- Docker & Docker Compose v2+
- An external Docker network: `docker network create localnet`
- (Optional) Tailscale for VPN access
- (Optional) TLS certificates for HTTPS

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Jwueth/self-hosted-stack.git
cd self-hosted-stack

# 2. Configure
cp .env.example .env
nano .env  # Fill in your domain, IP, passwords, API keys

# 3. Create symlinks (one per service directory)
for dir in ai authelia database gitea glance homepage ig-profile \
  media mediamanager metabase monitoring n8n nextcloud nginx \
  nocodb portainer zerobyte; do
  ln -sf ../.env "$dir/.env"
done

# 4. Create the Docker network
docker network create localnet

# 5. Start core services first
cd database && docker compose up -d && cd ..
cd nginx && docker compose up -d && cd ..
cd authelia && docker compose up -d && cd ..

# 6. Start any other service
cd n8n && docker compose up -d && cd ..
```

## Environment Variables

All configuration lives in a single `.env` at the root. Each service directory has a symlink (`.env -> ../.env`) so Docker Compose picks it up automatically.

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Your base domain (services become `n8n.yourdomain.com`, etc.) |
| `TAILSCALE_IP` | VPN IP for direct port bindings |
| `ADMIN_USER` | Shared admin username |
| `ADMIN_PASSWORD` | Shared admin password |
| `TZ` | Timezone for all services |
| `PUID` / `PGID` | Linux user/group ID mapping |

## Nginx & Authelia

Each service has a vhost config in `nginx/config/conf.d/`. To protect a service with SSO, include the Authelia auth block:

```nginx
location /authelia {
    internal;
    set $upstream_authelia http://authelia:9091/api/verify;
    proxy_pass $upstream_authelia;
    # ... headers
}

location / {
    auth_request /authelia;
    error_page 401 =302 https://authelia.yourdomain.com/?rd=$scheme://$http_host$request_uri;
    proxy_pass http://service:port;
}
```

See `nginx/config/conf.d/authelia_auth.txt` for the full snippet.

## Glance Dashboard

The main dashboard (`glance/config/glance.yml`) auto-discovers services via Docker labels. Add these labels to any compose service:

```yaml
labels:
  glance.name: My Service
  glance.icon: sh:service-name      # sh: or si: prefix
  glance.url: https://service.${DOMAIN}
  glance.description: What it does
  glance.category: auto             # auto | medias | ia | monitoring | bdds
  glance.id: parent-id              # for parent containers
  glance.parent: parent-id          # for child containers
```

## Adding a New Service

1. Create `<service>/docker-compose.yml`
2. Symlink the env: `cd <service> && ln -sf ../.env .env`
3. Use `${VAR}` for domain, IP, timezone, credentials
4. Join the shared network:
   ```yaml
   networks:
     localnet:
       external: true
   ```
5. Add `glance.*` labels for dashboard visibility
6. Add `nginx/config/conf.d/<service>.conf` for public access
7. `docker exec nginx nginx -s reload`

## License

MIT
