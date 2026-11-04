import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  manipulateAsync,
  SaveFormat,
} from 'expo-image-manipulator';

type CropRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Edge = 'top' | 'bottom' | 'left' | 'right';

type ImageCropEditorProps = {
  visible: boolean;
  imageUri: string | null;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => Promise<void> | void;
};

type EdgeHandleProps = {
  edge: Edge;
  onGrant: (edge: Edge) => void;
  onMove: (edge: Edge, dx: number, dy: number) => void;
  onRelease: () => void;
};

const MIN_CROP_SIZE = 48;
const CROP_INSET = 0.06;

function EdgeHandle({
  edge,
  onGrant,
  onMove,
  onRelease,
}: EdgeHandleProps) {
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: () => {
          onGrant(edge);
        },

        onPanResponderMove: (_, gesture) => {
          onMove(edge, gesture.dx, gesture.dy);
        },

        onPanResponderRelease: onRelease,
        onPanResponderTerminate: onRelease,
      }),
    [edge, onGrant, onMove, onRelease],
  );

  const isHorizontal = edge === 'top' || edge === 'bottom';

  return (
    <View
      {...panResponder.panHandlers}
      style={[
        styles.handleTouchArea,
        isHorizontal
          ? styles.horizontalHandle
          : styles.verticalHandle,
        edge === 'top' && styles.topHandle,
        edge === 'bottom' && styles.bottomHandle,
        edge === 'left' && styles.leftHandle,
        edge === 'right' && styles.rightHandle,
      ]}
    >
      <View
        style={
          isHorizontal
            ? styles.horizontalGrip
            : styles.verticalGrip
        }
      />
    </View>
  );
}

export function ImageCropEditor({
  visible,
  imageUri,
  onCancel,
  onConfirm,
}: ImageCropEditorProps) {
  const { width: screenWidth, height: screenHeight } =
    useWindowDimensions();

  const [sourceSize, setSourceSize] = useState({
    width: 0,
    height: 0,
  });

  const [crop, setCrop] = useState<CropRect | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragStart = useRef<CropRect | null>(null);
  const cropRef = useRef<CropRect | null>(null);

  // Keep the latest crop available without changing callback identity.
  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const viewportWidth = Math.max(1, screenWidth - 32);
  const viewportHeight = Math.max(220, screenHeight - 230);

  const imageRect = useMemo(() => {
    if (!sourceSize.width || !sourceSize.height) {
      return null;
    }

    const scale = Math.min(
      viewportWidth / sourceSize.width,
      viewportHeight / sourceSize.height,
    );

    const width = sourceSize.width * scale;
    const height = sourceSize.height * scale;

    return {
      left: (viewportWidth - width) / 2,
      top: (viewportHeight - height) / 2,
      width,
      height,
    };
  }, [
    sourceSize.width,
    sourceSize.height,
    viewportWidth,
    viewportHeight,
  ]);

  useEffect(() => {
    if (!visible || !imageUri) {
      return;
    }

    setSourceSize({ width: 0, height: 0 });
    setCrop(null);
    cropRef.current = null;
    dragStart.current = null;
    setError(null);
    setProcessing(false);
  }, [visible, imageUri]);

  useEffect(() => {
    if (!imageRect) {
      return;
    }

    const initialCrop: CropRect = {
      left: imageRect.width * CROP_INSET,
      top: imageRect.height * CROP_INSET,
      right: imageRect.width * (1 - CROP_INSET),
      bottom: imageRect.height * (1 - CROP_INSET),
    };

    cropRef.current = initialCrop;
    setCrop(initialCrop);
  }, [imageRect]);

  const handleImageLoad = useCallback(
    (event: {
      nativeEvent: {
        source: {
          width: number;
          height: number;
        };
      };
    }) => {
      const { width, height } = event.nativeEvent.source;

      console.log('Crop image loaded:', { width, height });

      if (width > 0 && height > 0) {
        setSourceSize({ width, height });
        setError(null);
      } else {
        setError('Unable to read this photo. Please select another.');
      }
    },
    [],
  );

  const handleImageError = useCallback(
    (event: { nativeEvent: { error: string } }) => {
      console.error(
        'Crop image failed to load:',
        event.nativeEvent.error,
      );

      setError('Unable to load this photo. Please select another.');
    },
    [],
  );

  // Capture the crop position once, at the beginning of the gesture.
  const handleDragGrant = useCallback((_edge: Edge) => {
    const currentCrop = cropRef.current;

    if (currentCrop) {
      dragStart.current = { ...currentCrop };
    }
  }, []);

  // Update only the selected edge using the original gesture position.
  const handleDragMove = useCallback(
    (edge: Edge, dx: number, dy: number) => {
      const start = dragStart.current;

      if (!start || !imageRect) {
        return;
      }

      const next = { ...start };

      switch (edge) {
        case 'top':
          next.top = Math.max(
            0,
            Math.min(
              start.top + dy,
              start.bottom - MIN_CROP_SIZE,
            ),
          );
          break;

        case 'bottom':
          next.bottom = Math.min(
            imageRect.height,
            Math.max(
              start.bottom + dy,
              start.top + MIN_CROP_SIZE,
            ),
          );
          break;

        case 'left':
          next.left = Math.max(
            0,
            Math.min(
              start.left + dx,
              start.right - MIN_CROP_SIZE,
            ),
          );
          break;

        case 'right':
          next.right = Math.min(
            imageRect.width,
            Math.max(
              start.right + dx,
              start.left + MIN_CROP_SIZE,
            ),
          );
          break;
      }

      cropRef.current = next;
      setCrop(next);
    },
    [imageRect],
  );

  const handleDragRelease = useCallback(() => {
    dragStart.current = null;
  }, []);

  const handleConfirm = useCallback(async () => {
    if (
      !imageUri ||
      !imageRect ||
      !crop ||
      processing ||
      !sourceSize.width ||
      !sourceSize.height
    ) {
      return;
    }

    try {
      setProcessing(true);
      setError(null);

      const scaleX = sourceSize.width / imageRect.width;
      const scaleY = sourceSize.height / imageRect.height;

      const originX = Math.max(
        0,
        Math.floor(crop.left * scaleX),
      );

      const originY = Math.max(
        0,
        Math.floor(crop.top * scaleY),
      );

      const cropWidth = Math.min(
        sourceSize.width - originX,
        Math.max(
          1,
          Math.ceil((crop.right - crop.left) * scaleX),
        ),
      );

      const cropHeight = Math.min(
        sourceSize.height - originY,
        Math.max(
          1,
          Math.ceil((crop.bottom - crop.top) * scaleY),
        ),
      );

      const result = await manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX,
              originY,
              width: cropWidth,
              height: cropHeight,
            },
          },
        ],
        {
          compress: 0.9,
          format: SaveFormat.JPEG,
        },
      );

      await onConfirm(result.uri);
    } catch (err) {
      console.error('Image cropping failed:', err);
      setError('Could not crop this image. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [
    imageUri,
    imageRect,
    crop,
    processing,
    sourceSize,
    onConfirm,
  ]);

  if (!visible || !imageUri) {
    return null;
  }

  const frameWidth = crop ? crop.right - crop.left : 0;
  const frameHeight = crop ? crop.bottom - crop.top : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={processing ? () => {} : onCancel}
    >
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onCancel}
            disabled={processing}
            style={styles.headerButton}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Adjust Photo</Text>

          <View style={styles.headerButton} />
        </View>

        <Text style={styles.instruction}>
          Drag any edge to adjust your crop area.
        </Text>

        <View
          style={[
            styles.viewport,
            {
              width: viewportWidth,
              height: viewportHeight,
            },
          ]}
        >
          <Image
            source={{ uri: imageUri }}
            resizeMode="contain"
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={StyleSheet.absoluteFill}
          />

          {imageRect && crop && (
            <>
              {/* Dark area outside the crop selection */}
              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: imageRect.left,
                    top: imageRect.top,
                    width: imageRect.width,
                    height: crop.top,
                  },
                ]}
              />

              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: imageRect.left,
                    top: imageRect.top + crop.bottom,
                    width: imageRect.width,
                    height: imageRect.height - crop.bottom,
                  },
                ]}
              />

              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: imageRect.left,
                    top: imageRect.top + crop.top,
                    width: crop.left,
                    height: frameHeight,
                  },
                ]}
              />

              <View
                pointerEvents="none"
                style={[
                  styles.shade,
                  {
                    left: imageRect.left + crop.right,
                    top: imageRect.top + crop.top,
                    width: imageRect.width - crop.right,
                    height: frameHeight,
                  },
                ]}
              />

              {/* Crop frame */}
              <View
                pointerEvents="none"
                style={[
                  styles.cropFrame,
                  {
                    left: imageRect.left + crop.left,
                    top: imageRect.top + crop.top,
                    width: frameWidth,
                    height: frameHeight,
                  },
                ]}
              />

              {/* Top edge */}
              <View
                style={[
                  styles.handlePosition,
                  {
                    left: imageRect.left + crop.left,
                    top: imageRect.top + crop.top - 13,
                    width: frameWidth,
                  },
                ]}
              >
                <EdgeHandle
                  edge="top"
                  onGrant={handleDragGrant}
                  onMove={handleDragMove}
                  onRelease={handleDragRelease}
                />
              </View>

              {/* Bottom edge */}
              <View
                style={[
                  styles.handlePosition,
                  {
                    left: imageRect.left + crop.left,
                    top: imageRect.top + crop.bottom - -13,
                    width: frameWidth,
                  },
                ]}
              >
                <EdgeHandle
                  edge="bottom"
                  onGrant={handleDragGrant}
                  onMove={handleDragMove}
                  onRelease={handleDragRelease}
                />
              </View>

              {/* Left edge */}
              <View
                style={[
                  styles.handlePosition,
                  {
                    left: imageRect.left + crop.left - 13,
                    top: imageRect.top + crop.top,
                    height: frameHeight,
                  },
                ]}
              >
                <EdgeHandle
                  edge="left"
                  onGrant={handleDragGrant}
                  onMove={handleDragMove}
                  onRelease={handleDragRelease}
                />
              </View>

              {/* Right edge */}
              <View
                style={[
                  styles.handlePosition,
                  {
                    left: imageRect.left + crop.right - -13,
                    top: imageRect.top + crop.top,
                    height: frameHeight,
                  },
                ]}
              >
                <EdgeHandle
                  edge="right"
                  onGrant={handleDragGrant}
                  onMove={handleDragMove}
                  onRelease={handleDragRelease}
                />
              </View>
            </>
          )}

          {!sourceSize.width && !error && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator
                size="large"
                color="#4D8DFF"
              />
              <Text style={styles.loadingText}>
                Loading photo...
              </Text>
            </View>
          )}

          {error && (
            <View style={styles.loadingOverlay}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.helperText}>
            Your original photo will remain unchanged.
          </Text>

          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!crop || processing || !sourceSize.width || !!error) &&
                styles.disabledButton,
            ]}
            onPress={handleConfirm}
            disabled={
              !crop ||
              processing ||
              !sourceSize.width ||
              !!error
            }
          >
            {processing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmText}>
                Use This Photo
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#080D18',
    alignItems: 'center',
    paddingTop: 55,
    paddingBottom: 24,
  },

  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },

  headerButton: {
    width: 65,
    minHeight: 40,
    justifyContent: 'center',
  },

  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },

  cancelText: {
    color: '#AFC8F8',
    fontSize: 15,
    fontWeight: '600',
  },

  instruction: {
    color: '#A0AABD',
    fontSize: 13,
    marginTop: 18,
    marginBottom: 16,
    textAlign: 'center',
  },

  viewport: {
    position: 'relative',
    overflow: 'hidden',
    alignSelf: 'center',
  },

  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },

  cropFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  handlePosition: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  handleTouchArea: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  horizontalHandle: {
    width: '100%',
    height: 28,
  },

  verticalHandle: {
    width: 28,
    height: '100%',
  },

  topHandle: {
    top: 0,
  },

  bottomHandle: {
    bottom: 0,
  },

  leftHandle: {
    left: 0,
  },

  rightHandle: {
    right: 0,
  },

  horizontalGrip: {
    width: 20,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#4D8DFF',
  },

  verticalGrip: {
    width: 5,
    height: 20,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#4D8DFF',
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#080D18',
  },

  loadingText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 13,
  },

  errorText: {
    color: '#FF7777',
    textAlign: 'center',
    fontSize: 13,
    paddingHorizontal: 20,
  },

  footer: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 'auto',
  },

  helperText: {
    color: '#8995A8',
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 14,
  },

  confirmButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#276FE8',
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabledButton: {
    opacity: 0.5,
  },

  confirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});