
import React from 'react';
import {
  MaterialIcons,
  FontAwesome5,
  Feather,
  FontAwesome6,
} from '@expo/vector-icons';

type TabIconName = 'Dashboard' | 'Rides' | 'Parts' | 'Settings';

type TabIconProps = {
  name: TabIconName;
  focused: boolean;
  size?: number;
};

const MUTED = '#A3A4B1';
const ACTIVE = '#4D8DFF';

export function TabIcon({
  name,
  focused,
  size = 25,
}: TabIconProps) {
  const color = focused ? ACTIVE : MUTED;

  switch (name) {
    case 'Dashboard':
      return (
        <MaterialIcons
          name="space-dashboard"
          size={size}
          color={color}
        />
      );

    case 'Rides':
      return (
        <FontAwesome5
          name="map-marked-alt"
          size={size}
          color={color}
        />
      );

    case 'Parts':
      return (
        <Feather
          name="tool"
          size={size}
          color={color}
        />
      );

    case 'Settings':
      return (
        <FontAwesome6
          name="gear"
          size={size}
          color={color}
        />
      );
  }
}

export function RecordRiderIcon({
  size = 30,
}: {
  size?: number;
}) {
  return (
    <MaterialIcons
      name="directions-bike"
      size={size}
      color="#FFFFFF"
    />
  );
}
