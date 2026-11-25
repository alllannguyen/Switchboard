# Switchboard

Blue-green deployment dashboard built on Docker Compose and Nginx.
Deploy a demo app version to the inactive environment, health-check it,
switch traffic through Nginx, and roll back if something goes wrong.

## Layout

| Path | Purpose |
| --- | --- |
| `demo-app/` | The demo website deployed to the blue and green environments |
| `dashboard/` | Node dashboard (no dependencies): deploy, health-check, switch, roll back |
| `nginx/` | Reverse proxy that routes user traffic to the active environment |
| `docker-compose.yml` | Local stack: Nginx, blue, green |

## Usage

```sh
docker compose up -d --build   # start Nginx, blue and green (site on :8080)
node dashboard/server.js       # dashboard on http://localhost:9000
```

1. **Deploy** a version, message and color. It always goes to the inactive environment.
2. The dashboard **health-checks** the new environment. A broken release (tick "Simulate a broken release") stays unhealthy and cannot receive traffic.
3. **Switch traffic**: rewrites `nginx/switchboard/active.conf`, validates it with `nginx -t`, reloads Nginx, and waits until Nginx is really routing to the new side.
4. **Roll back** returns traffic to the previous environment, which still runs the old version.

Dashboard state lives in `dashboard/state.json` and the per-environment settings in `.env` (both ignored by git).
`nginx/switchboard/active.conf` is rewritten on every switch, so it will show as modified in `git status`.
