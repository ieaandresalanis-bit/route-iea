/**
 * Root navigation — checks auth state and routes accordingly.
 *
 * Structure:
 *
 * AppNavigator
 * ├── AuthStack (not logged in)
 * │   └── LoginScreen
 * └── MainTabs (logged in)
 *     ├── HomeTab (NativeStack)
 *     │   ├── HomeScreen        — map + "Iniciar Viaje"
 *     │   ├── TripStartScreen   — trip start wizard
 *     │   ├── ActiveTripScreen  — live tracking
 *     │   └── TripEndScreen     — trip completion wizard
 *     ├── FuelTab
 *     │   └── FuelLogScreen     — camera or manual fuel entry
 *     └── ProfileTab
 *         └── ProfileScreen     — user info + logout
 *
 * Dependencies needed:
 * - @react-navigation/native
 * - @react-navigation/native-stack
 * - @react-navigation/bottom-tabs
 * - react-native-screens
 * - react-native-safe-area-context
 *
 * TODO: Implement NavigationContainer with auth state check
 * TODO: Bottom tab bar with brand orange active color
 * TODO: HomeTab stack for trip sub-screens
 */

import React from 'react';

export default function AppNavigator() {
  // TODO: Check auth token
  // TODO: If authenticated -> MainTabs
  // TODO: If not -> AuthStack (LoginScreen)
  return null; // Placeholder
}
