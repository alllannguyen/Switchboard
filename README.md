# Switchboard

Blue-green deployment dashboard built on Docker Compose and Nginx.
Deploy a demo app version to the inactive environment, health-check it,
switch traffic through Nginx, and roll back if something goes wrong.

## Layout

| Path | Purpose |
| --- | --- |
| `demo-app/` | The demo website deployed to the blue and green environments |
| `nginx/` | Reverse proxy that routes user traffic to the active environment |
| `docker-compose.yml` | Local stack: Nginx, blue, green |

## Status

Groundwork only. The dashboard is not implemented yet.
