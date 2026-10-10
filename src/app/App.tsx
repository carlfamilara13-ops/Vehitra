import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Placeholder shell. Real navigation and providers arrive in later Phase 1 steps.
export default function App() {
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <Text style={s.title}>Vehitra</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070D', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
});
