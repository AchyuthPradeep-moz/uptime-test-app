# uptime-test-app

A test target for uptime agents: a tiny zero-dependency Node server you can switch
between up, down, slow, timeout, etc. from a control panel.

## Run

```bash
CONTROL_TOKEN=<pick-a-token> PORT=4000 node server.js
ngrok http 4000          # optional: public URL for an external agent
```

- Monitored URL: `/` or `/health` (keyword for content checks: `SITE_IS_UP`)
- Control panel: `/__control?token=<CONTROL_TOKEN>`
- JSON status: `/__control/status?token=<CONTROL_TOKEN>`

## Modes

| Mode | Response |
|---|---|
| `up` | 200 with `SITE_IS_UP` |
| `down` | 503 |
| `error` | 500 |
| `notfound` | 404 |
| `slow` | 200 after a configurable delay |
| `timeout` | never responds |
| `reset` | connection destroyed, no HTTP response |
| `keyword` | 200 without `SITE_IS_UP` |
| `redirect` | 302 loop |

Flap mode toggles up/down automatically every N seconds.

```bash
curl -X POST "http://localhost:4000/__control/mode/down?token=<CONTROL_TOKEN>"
curl -X POST "http://localhost:4000/__control/flap?token=<CONTROL_TOKEN>&seconds=60"
```

State is in memory — restarting resets to `up`.

## Deploy (Render free tier)

`render.yaml` is a Render Blueprint. In Render: **New → Blueprint → pick this repo → Apply**.
`CONTROL_TOKEN` is generated automatically — find it under the service's **Environment** tab.

Free-tier notes:
- The instance sleeps after 15 min without traffic; the uptime agent's checks keep it awake.
  A wake-up (or redeploy) restarts the app, which resets the mode to `up`.
- `timeout` and `reset` go through Render's proxy, so the agent sees Render's own
  error/timeout rather than a raw dropped connection.
