/**
 * LoginScreen — Email + password authentication.
 *
 * Flow:
 * 1. User enters email + password
 * 2. Calls POST /api/auth/login
 * 3. Stores JWT in expo-secure-store
 * 4. Navigates to HomeScreen
 *
 * Default credentials for testing:
 *   admin@iea.com / Admin123!
 */

import React from 'react';

// TODO: Implement with React Native components
// - TextInput for email
// - TextInput for password (secureTextEntry)
// - TouchableOpacity for login button
// - Brand colors from CONFIG.COLORS
// - Error display

export default function LoginScreen() {
  // TODO: useState for email, password, loading, error
  // TODO: handleLogin() -> api.post('/auth/login', { email, password })
  // TODO: setToken() -> navigate to Home

  return null; // Placeholder — implement with RN components
}
