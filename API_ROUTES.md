# Order Assignment System API Routes

Base path: `/api/v2`

## Driver APIs

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /drivers/register | - | Register new driver (auto-rebalances PINs) |
| PATCH | /drivers/:id/status | Driver/Admin | Update status: `available`, `busy`, `offline` |
| POST | /drivers/orders/:orderId/accept | Driver | Accept order (locks to driver) |
| POST | /drivers/orders/:orderId/decline | Driver | Decline order (triggers reassign) |
| GET | /drivers/me/pincodes | Driver | Get PIN codes assigned to logged-in driver |

## Order APIs

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /orders | - | Create order (auto-assigns to driver) |
| GET | /orders | - | List orders (query: deliveryDate, franchiseId, driverId, status) |
| PATCH | /orders/:id/assign | Admin | Manually assign order to driver |
| PATCH | /orders/:id/reassign | Admin | Reassign to next available driver |

## Admin APIs

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /admin/pincodes/rebalance | Admin | Rebalance PIN distribution |
| GET | /admin/pincodes/allocations | Admin | View driver PIN allocations |

## Headers (for auth)

- `X-User-Email`: User email
- `X-User-Role`: `admin` | `master` | `driver` | `customer`
- `X-User-Franchise-Id`: Franchise ID (admin)
- `X-User-Driver-Id`: Driver ID (driver)
