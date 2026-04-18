# UltraTrader API

Signal publishing backend for UltraTrader Bot. Provides license key authentication, signal management, and MT5 broker connection via Puppeteer browser automation.

## Setup

1. Clone this repo
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your values
4. Build: `npm run build`
5. Start: `npm start`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `MONGODB_URI` | MongoDB connection string |
| `ADMIN_KEY` | Admin key for creating licenses/signals (default: `ultratrader-admin-2024`) |
| `NODE_ENV` | Set to `production` for deployment |

## Render Deployment

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **API URL:** https://ultratrader.davidcyril.name.ng

## API Endpoints

### Authentication
- `POST /api/auth/activate` — Activate license key + phone secret
- `GET /api/auth/check` — Check license validity (header: `x-license-key`)

### Admin (requires header: `x-admin-key: ultratrader-admin-2024`)
- `POST /api/auth/license` — Create/update a license key
- `GET /api/auth/licenses` — List all licenses
- `POST /api/signals` — Publish a new signal
- `DELETE /api/signals/:id` — Remove a signal

### Signals (client)
- `GET /api/signals?phone_secret=XXX` — Get signals for a license

### Bot Control
- `GET /api/bot/status` — Bot running status
- `POST /api/bot/start` — Start trading bot
- `POST /api/bot/stop` — Stop trading bot
- `POST /api/bot/account` — Connect MT5 broker account
- `GET /api/bot/account/info` — Get account balance info

### Trades
- `GET /api/trades` — Trade history
- `GET /api/trades/stats` — Trading statistics

## Creating a License Key (Admin)

```bash
curl -X POST https://ultratrader.davidcyril.name.ng/api/auth/license \
  -H "x-admin-key: ultratrader-admin-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "ULTRA-XXXX-XXXX-XXXX",
    "ownerName": "Client Name",
    "ownerEmail": "client@email.com",
    "phoneSecret": "mysecret123",
    "allowedSymbols": ["XAUUSD", "USDZAR", "BTCUSD"]
  }'
```

## Publishing a Signal (Admin)

```bash
curl -X POST https://ultratrader.davidcyril.name.ng/api/signals \
  -H "x-admin-key: ultratrader-admin-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "BUY",
    "asset": "XAUUSD",
    "price": "2350.50",
    "sl": "2340.00",
    "tp": "2370.00",
    "lotSize": 0.01
  }'
```
