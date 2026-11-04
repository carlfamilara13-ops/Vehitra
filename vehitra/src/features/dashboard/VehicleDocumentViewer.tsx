import React, { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../ui/neu/NeuText';
import {
  VEHICLE_DOCUMENT_DEFINITIONS,
  type VehicleDocumentKind,
} from '../../domain/vehicleDocuments/documents';
import { spacing, typography } from '../../ui/theme';

export type VehicleDocumentViewerTarget = {
  kind: VehicleDocumentKind;
  uri: string;
};

type Props = {
  document: VehicleDocumentViewerTarget | null;
  onClose: () => void;
};

// Full-screen document viewer. The dark backdrop keeps the surrounding dashboard out of the way;
// the image is always contained so a landscape OR/CR is never cropped or stretched.
export default function VehicleDocumentViewer({ document, onClose }: Props) {
  const [failed, setFailed] = useState(false);
  const definition = document ? VEHICLE_DOCUMENT_DEFINITIONS[document.kind] : null;

  useEffect(() => {
    setFailed(false);
  }, [document?.uri]);

  return (
    <Modal
      visible={!!document}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.root}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close document viewer"
        />
        <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']} pointerEvents="box-none">
          <View style={s.header}>
            <Text style={s.title} numberOfLines={1}>
              {definition?.title ?? 'Document'}
            </Text>
            <TouchableOpacity
              style={s.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close document viewer"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={25} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <View style={s.body} pointerEvents="none">
            {document && !failed ? (
              <Image
                source={{ uri: document.uri }}
                style={s.image}
                resizeMode="contain"
                onError={() => setFailed(true)}
                accessibilityLabel={`${definition?.title ?? 'Vehicle document'} photo`}
              />
            ) : (
              <Text style={s.errorText}>
                This photo could not be loaded. Close the viewer and replace the image.
              </Text>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.9)' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  safe: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.label,
    color: '#FFFFFF',
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  errorText: {
    ...typography.body,
    color: '#FFFFFF',
    textAlign: 'center',
    maxWidth: 280,
  },
});
