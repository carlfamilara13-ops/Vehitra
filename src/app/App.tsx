import React from 'react';
import { StatusBar } from 'expo-status-bar';
import RideDebugScreen from '../features/rides/RideDebugScreen';

// Placeholder shell: shows the ride-tracking dev screen until the real navigation exists.
export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <RideDebugScreen />
    </>
  );
}
