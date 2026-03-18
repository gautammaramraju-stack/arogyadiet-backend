# Order Assignment System v2

A modular, production-ready order assignment backend with PIN-based routing, driver accept/decline flow, and automatic reassignment.

## Architecture

```
/backend
├── config/           # Configuration (PIN range, timeouts, status enums)
├── models/           # Data structures (Driver, Order, DriverPincodeMapping)
├── services/         # Business logic
│   ├── pincodeDistributionService.js   # PIN allocation & rebalance
│   ├── orderAssignmentService.js      # Assign, accept, decline, timeout
│   └── driverService.js               # Driver registration & status
├── controllers/      # API request handlers
├── routes/           # Express route definitions
├── middlewares/      # Auth (getReqUser, requireDriver, requireAdmin)
├── utils/            # Logger, storage layer
└── server.js         # Main entry (mounts /api/v2 routes)
```

## Core Flow

1. **Order placed** → Subscription creates orders → `assignOrderOnCreate()` assigns to driver
2. **Assignment** → PIN-based: find driver for order's pincode; fallback: round-robin
3. **Driver receives** → Order status: `pending_acceptance`, 30s timeout starts
4. **Accept** → Status: `accepted`, driver set to `busy`, timeout cleared
5. **Decline / Timeout** → Add driver to `declinedByDriverIds`, reassign to next driver
6. **Repeat** until accepted or no available drivers

## PIN Code Distribution

- **Range:** 500001–501510 (1510 PINs)
- **Distribution:** Equal among drivers per franchise
- **Rebalance:** Auto on driver add/remove; manual via Admin API

## Driver States

| Status    | Description                    |
|-----------|--------------------------------|
| available | Can receive new orders         |
| busy      | Has accepted order, delivering |
| offline   | Not available                  |

## API Summary

See `API_ROUTES.md` for full list.

- **Driver:** Register, update status, accept/decline orders, get my PINs
- **Order:** Create (auto-assign), list, manual assign/reassign
- **Admin:** Rebalance PINs, view allocations

## Configuration

Edit `config/index.js`:

- `ORDER_ASSIGNMENT.ACCEPT_TIMEOUT_SECONDS` — Default: 30
- `PIN_CODE.MIN` / `PIN_CODE.MAX` — Service area

## Database

Uses JSON file (`data.json`). Schema in `SCHEMA.md`. Migrate to MySQL/PostgreSQL by replacing `utils/storage.js`.
