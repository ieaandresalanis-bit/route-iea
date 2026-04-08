# IEA Growth Intelligence Mobile

React Native (Expo) mobile app for field operators and drivers.

## Setup

```bash
npx create-expo-app@latest . --template blank-typescript
npx expo install react-native-maps expo-location expo-camera expo-secure-store socket.io-client
npx expo install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context
```

## Structure

```
src/
├── navigation/AppNavigator.tsx    # Auth check + tab navigation
├── screens/
│   ├── LoginScreen.tsx            # Email + password
│   ├── HomeScreen.tsx             # Map + trip status
│   ├── TripStartScreen.tsx        # Trip start wizard (5 steps)
│   ├── ActiveTripScreen.tsx       # Live tracking + controls
│   ├── TripEndScreen.tsx          # Trip completion wizard
│   ├── FuelLogScreen.tsx          # Camera OCR or manual
│   └── ProfileScreen.tsx          # User info + logout
├── services/
│   ├── api.ts                     # REST API client
│   ├── socket.ts                  # WebSocket for GPS
│   └── location.ts                # expo-location wrapper
├── constants/config.ts            # URLs, colors, GPS config
└── types/index.ts                 # Shared TypeScript types
```

## Key Features

- Real-time GPS tracking (sends position every 15s)
- Trip start/end mandatory flows with odometer capture
- Fuel logging with camera OCR
- Google Maps embedded with route visualization
- Geofencing for automatic arrival detection
