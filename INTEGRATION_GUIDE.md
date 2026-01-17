# Technical Integration Guide: NielsAutoTrade Executor

This document defines how the **AutoTrade Executor** agent should handle incoming requests from the **VIP Signal AI** (Master Bot).

## 1. Authentication
Every request from the Master Bot includes:
- **Header**: `X-Admin-Secret`
- **Expected Value**: `1234ea1` (Match with your `.env`)

---

## 2. Endpoint: Create Signal
**URL**: `POST /api/signals/create`

### Request Payload
```json
{
  "ticker": "EURUSD", 
  "signal": "buy",
  "price": 1.0845,
  "time": 300 
}
```
- **ticker**: Hardcoded to `EURUSD` for Real Market (OTC stripped).
- **signal**: `"buy"` (Call) or `"sell"` (Put).
- **time**: Precise expiry in seconds (e.g., 300 for 5 minutes).

### Expected Response
Return a unique `signalId` for result tracking.
```json
{
  "status": "success",
  "signalId": "SIG_EURUSD_172083321" 
}
```

---

## 3. Endpoint: Update Result (Outcome)
**URL**: `POST /api/signals/result`

### Request Payload
```json
{
  "signalId": "SIG_EURUSD_172083321",
  "signal": "WIN"
}
```
- **signalId**: The ID generated in the `/create` step.
- **signal**: `"WIN"` or `"LOSS"`.

---

## 4. Execution Logic Requirements
- **Simultaneous Execution**: Place trades for ALL active users immediately on `/create`.
- **Pre-set Charts**: Clients must have the `EURUSD` chart open in Pocket Option.
- **Stealth**: Use human-like timing and headers.

## 5. Master Bot Routing
The Master Bot only forwards signals coming through the legacy route: `/webhook/tradingview`. All other routes (e.g., `/webhook/gold`, `/webhook/silver`) are broadcast to Telegram ONLY and will not hit these endpoints.
