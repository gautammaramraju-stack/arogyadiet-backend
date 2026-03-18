# Database Schema (JSON Storage)

## Drivers

| Field | Type | Description |
|-------|------|-------------|
| id | number | Unique driver ID |
| name | string | Driver name |
| phone | string | Contact phone |
| email | string | Login email |
| vehicle | string | Bike, Scooter, Car |
| status | string | `available` \| `busy` \| `offline` \| `active` (legacy) |
| franchiseId | number | Franchise ID |
| franchiseName | string | Franchise name |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

## Orders

| Field | Type | Description |
|-------|------|-------------|
| id | number | Unique order ID |
| subscriptionId | number | Linked subscription (optional) |
| customerName | string | Customer name |
| email | string | Customer email |
| phone | string | Customer phone |
| address | string | Delivery address |
| pincode | string | Delivery PIN (500001-501510) |
| delivery_date | string | YYYY-MM-DD |
| status | string | `pending` \| `pending_acceptance` \| `assigned` \| `accepted` \| `declined` \| `reassigning` \| `delivered` \| `failed` |
| driverId | number | Assigned driver ID |
| driverName | string | Assigned driver name |
| driverPhone | string | Assigned driver phone |
| franchiseId | number | Franchise ID |
| assignedAt | string | When assigned to current driver |
| acceptedAt | string | When driver accepted |
| declinedAt | string | When driver declined |
| declinedByDriverIds | number[] | Driver IDs who declined |
| createdAt | string | ISO timestamp |

## DriverPincodeMapping

| Field | Type | Description |
|-------|------|-------------|
| driverId | number | Driver ID |
| pincode | number | PIN code (500001-501510) |
| franchiseId | number | Franchise ID |
| createdAt | string | ISO timestamp |

## PIN Code Range

- **Min:** 500001
- **Max:** 501510
- **Total:** 1510 PIN codes
- Distributed equally among drivers per franchise
