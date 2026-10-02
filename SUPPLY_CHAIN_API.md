# Supply Chain (Stock Graph) API

Backend for the supplier / customer graph. Tapping a stock shows that stock in the **centre**, its **suppliers on the left** and its **customers on the right**.

> ⚠️ **Demo data, not verified.** Only 8 links are web-sourced; the rest are plausible examples. Do not present as fact to real users.

## Setup (once per machine)

Run these on your local Postgres, in order, from `Stocksy_Server/migrations/`:

1. `013_supply_chain.sql`
2. `014_seed_supply_chain_demo.sql`

Without them every request returns 404.

## Endpoint

`GET /api/supply-chain/:symbol`

| | |
|---|---|
| Auth | `Authorization: Bearer <JWT>` (same token as login) |
| `:symbol` | NSE symbol, case-insensitive, e.g. `NTPC`, `COALINDIA`, `M&M` |

### Success: 200

- `suppliers` → **left** side. `customers` → **right** side.
- Both are sorted HIGH confidence first, then A-Z.
- Either array can be empty.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Company name to display |
| `symbol` | string \| null | NSE symbol. `null` for government / unlisted / foreign |
| `companyType` | `listed` \| `unlisted` \| `government` \| `foreign` | Use for box styling/icon |
| `item` | string | Label under the name, e.g. "Thermal coal" |
| `confidence` | `HIGH` \| `MEDIUM` \| `LOW` | How sure the data is |
| `sourceUrl` | string \| null | Where it was found (mostly null for demo rows) |
| `tappable` | boolean | `true` → user can tap to open that company's graph |

**Tap behaviour:** only when `tappable` is `true`, call this same endpoint with that node's `symbol`. Non-tappable nodes are plain boxes.

Example: `GET /api/supply-chain/NTPC`

```json
{
  "company": {
    "name": "NTPC Ltd",
    "symbol": "NTPC",
    "companyType": "listed"
  },
  "suppliers": [
    {
      "name": "Bharat Heavy Electricals Ltd",
      "symbol": "BHEL",
      "companyType": "listed",
      "item": "Boilers, turbines, generators",
      "confidence": "HIGH",
      "sourceUrl": "https://electricalmirror.net/bhel-secures-%e2%82%b913500-crore-ntpc-order-for-telangana-stage-ii-supercritical-thermal-power-project/",
      "tappable": false
    },
    {
      "name": "Coal India Ltd",
      "symbol": "COALINDIA",
      "companyType": "listed",
      "item": "Thermal coal",
      "confidence": "HIGH",
      "sourceUrl": "https://themachinemaker.com/news/ntpc-secures-3-million-tonnes-of-coal-from-private-sector-suppliers/",
      "tappable": true
    },
    {
      "name": "Indian Railways",
      "symbol": null,
      "companyType": "government",
      "item": "Rail freight for coal",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": false
    },
    {
      "name": "Larsen & Toubro Ltd",
      "symbol": "LT",
      "companyType": "listed",
      "item": "Power plant construction (EPC)",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": true
    },
    {
      "name": "Singareni Collieries Co Ltd",
      "symbol": null,
      "companyType": "government",
      "item": "Thermal coal",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": false
    }
  ],
  "customers": [
    {
      "name": "Bihar State Power Holding Co Ltd",
      "symbol": null,
      "companyType": "government",
      "item": "Electricity (PPA)",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": false
    },
    {
      "name": "Madhya Pradesh Power Management Co Ltd",
      "symbol": null,
      "companyType": "government",
      "item": "Electricity (PPA)",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": false
    },
    {
      "name": "UltraTech Cement Ltd",
      "symbol": "ULTRACEMCO",
      "companyType": "listed",
      "item": "Fly ash for cement",
      "confidence": "MEDIUM",
      "sourceUrl": null,
      "tappable": true
    },
    {
      "name": "Uttar Pradesh Power Corporation Ltd (UPPCL)",
      "symbol": null,
      "companyType": "government",
      "item": "Electricity (PPA)",
      "confidence": "MEDIUM",
      "sourceUrl": "https://powerline.net.in/2025/06/09/ntpc-rel-signs-ppa-for-1000-mw-solar-project-with-uppcl/",
      "tappable": false
    },
    {
      "name": "Maharashtra State Electricity Distribution Co (MSEDCL)",
      "symbol": null,
      "companyType": "government",
      "item": "Electricity (PPA)",
      "confidence": "LOW",
      "sourceUrl": "https://nvvn.co.in/assets/files/Dec-20-CERC.pdf",
      "tappable": false
    }
  ]
}
```

### Errors

All errors use the app's standard `{ message, code, severity }` shape.

| Status | `code` | When | What the UI should do |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed symbol | Treat as a bug |
| 401 | `UNAUTHORIZED` / `SESSION_EXPIRED` | Missing or expired token | Existing re-login flow |
| 404 | `NOT_FOUND` | Stock has no graph data | Show an empty state, not an error |
| 500 | `UNKNOWN_ERROR` | Server problem | Generic retry message |

## Demo coverage

Full graphs (5 suppliers + 5 customers): `COALINDIA`, `NTPC`, `TATASTEEL`, `LT`, `ULTRACEMCO`.
Other nodes reached by tapping (e.g. `BPCL`, `RELIANCE`) may have only one side filled, or return 404, so handle both.
