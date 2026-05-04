import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

export type DocumentItem = {
  id: string;
  label: string;
  fileType?: string;
  createdAt?: string;
};

export type PickedFile = {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

type Props<T extends DocumentItem> = {
  documents: T[];
  uploading?: boolean;
  onPickFile: (file: PickedFile) => void | Promise<void>;
  onOpenDocument?: (doc: T) => void;
  onRemove?: (id: string) => void;
};

export function DocumentAttachmentsSection<T extends DocumentItem>({
  documents,
  uploading = false,
  onPickFile,
  onOpenDocument,
  onRemove
}: Props<T>) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Enable camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await onPickFile({
      uri: asset.uri,
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileSize: asset.fileSize ?? 0
    });
  }

  async function handleSelectImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo library permission needed',
        'Enable photo library access to select images.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await onPickFile({
      uri: asset.uri,
      fileName: asset.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileSize: asset.fileSize ?? 0
    });
  }

  async function handleSelectFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await onPickFile({
      uri: asset.uri,
      fileName: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileSize: asset.size ?? 0
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            uploading && styles.actionButtonDisabled,
            pressed && styles.pressed
          ]}
          onPress={() => void handleTakePhoto()}
          disabled={uploading}
        >
          <Ionicons name="camera-outline" size={14} color={colors.foreground} />
          <Text style={styles.actionText}>Take image</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            uploading && styles.actionButtonDisabled,
            pressed && styles.pressed
          ]}
          onPress={() => void handleSelectImage()}
          disabled={uploading}
        >
          <Ionicons name="images-outline" size={14} color={colors.foreground} />
          <Text style={styles.actionText}>Select image</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            uploading && styles.actionButtonDisabled,
            pressed && styles.pressed
          ]}
          onPress={() => void handleSelectFile()}
          disabled={uploading}
        >
          <Ionicons name="document-attach-outline" size={14} color={colors.foreground} />
          <Text style={styles.actionText}>Select file</Text>
        </Pressable>
      </View>

      {uploading && (
        <View style={styles.uploadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.uploadingText}>Uploading document...</Text>
        </View>
      )}

      {documents.length > 0 && (
        <View style={styles.documentList}>
          {documents.map(doc => (
            <Pressable
              key={doc.id}
              style={({ pressed }) => [
                styles.documentRow,
                pressed && onOpenDocument && styles.pressed
              ]}
              onPress={() => onOpenDocument?.(doc)}
              disabled={!onOpenDocument}
            >
              <Ionicons
                name={doc.fileType?.startsWith('image/') ? 'image-outline' : 'document-outline'}
                size={15}
                color={colors.foreground}
              />
              <Text style={styles.documentName} numberOfLines={1}>
                {doc.label}
              </Text>
              {doc.createdAt ? (
                <Text style={styles.documentMeta}>
                  {new Date(doc.createdAt).toLocaleDateString()}
                </Text>
              ) : (
                <Text style={styles.documentMeta}>Pending</Text>
              )}
              {onRemove ? (
                <Pressable
                  onPress={() => onRemove(doc.id)}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                  accessibilityLabel={`Remove ${doc.label}`}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {documents.length === 0 && !uploading && (
        <Text style={styles.empty}>No documents attached.</Text>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 8
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border
    },
    actionButtonDisabled: {
      opacity: 0.55
    },
    actionText: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: '500'
    },
    uploadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4
    },
    uploadingText: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    documentList: {
      marginTop: 4,
      borderRadius: 8,
      overflow: 'hidden'
    },
    documentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      marginBottom: 6
    },
    documentName: {
      flex: 1,
      color: colors.foreground,
      fontSize: 13
    },
    documentMeta: {
      color: colors.mutedForeground,
      fontSize: 11
    },
    empty: {
      color: colors.mutedForeground,
      fontSize: 13,
      fontStyle: 'italic'
    },
    removeButton: {
      padding: 2
    },
    pressed: {
      opacity: 0.75
    }
  });
