import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DocumentAttachmentsSection,
  type PickedFile
} from '@/components/DocumentAttachmentsSection';
import { ProjectAgentSelector } from '@/components/ProjectAgentSelector';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type { CreateTicketForm } from '@/lib/use-create-ticket-form';

type CollapsibleSectionProps = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  defaultExpanded?: boolean;
  badge?: string | null;
};

function CollapsibleSection({
  title,
  icon,
  children,
  colors,
  styles,
  defaultExpanded = false,
  badge
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotateAnim = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  function toggle() {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.spring(rotateAnim, {
      toValue,
      useNativeDriver: true,
      tension: 120,
      friction: 10
    }).start();
  }

  const chevronRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']
  });

  return (
    <View style={styles.collapsibleSection}>
      <Pressable
        style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.75 }]}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.collapsibleHeaderLeft}>
          <Ionicons name={icon} size={16} color={colors.mutedForeground} />
          <Text style={styles.collapsibleTitle}>{title}</Text>
          {badge ? (
            <View style={styles.collapsibleBadge}>
              <Text style={styles.collapsibleBadgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Animated.View>
      </Pressable>
      {expanded ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

type Props = {
  form: CreateTicketForm;
  autoFocus?: boolean;
};

/**
 * The field stack shared by the Create tab and the QuickCreateTicketModal:
 * objective, project/agent selector, acceptance criteria, tags, and documents.
 * Tags replace the old free-text "tools" field.
 */
export function CreateTicketFormFields({ form, autoFocus = false }: Props) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  const {
    projects,
    loadingProjects,
    projectId,
    setProjectId,
    openSelectorPanel,
    setOpenSelectorPanel,
    agentSelection,
    setAgentSelection,
    setResolvedAgentSelection,
    objective,
    setObjective,
    acceptanceCriteria,
    setAcceptanceCriteria,
    tagDefinitions,
    loadingTags,
    selectedTagIds,
    toggleTag,
    pendingDocuments,
    addDocument,
    removeDocument,
    submitting
  } = form;

  return (
    <>
      <TextInput
        style={styles.objectiveInput}
        value={objective}
        onChangeText={setObjective}
        placeholder="What needs to be done?"
        placeholderTextColor={colors.mutedForeground}
        multiline
        autoFocus={autoFocus}
        textAlignVertical="top"
      />

      <ProjectAgentSelector
        openPanel={openSelectorPanel}
        onOpenPanelChange={setOpenSelectorPanel}
        project={{
          options: projects,
          value: projectId,
          loading: loadingProjects,
          disabled: submitting,
          onChange: setProjectId
        }}
        agent={{
          value: agentSelection,
          onChange: setAgentSelection,
          onResolvedSelectionChange: setResolvedAgentSelection,
          disabled: submitting
        }}
      />

      <View style={styles.collapsibleStack}>
        <CollapsibleSection
          title="Acceptance Criteria"
          icon="checkmark-circle-outline"
          colors={colors}
          styles={styles}
        >
          <TextInput
            style={styles.sectionInput}
            value={acceptanceCriteria}
            onChangeText={setAcceptanceCriteria}
            placeholder="Define when this ticket is complete..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Tags"
          icon="pricetag-outline"
          colors={colors}
          styles={styles}
          defaultExpanded={selectedTagIds.length > 0}
          badge={selectedTagIds.length > 0 ? String(selectedTagIds.length) : null}
        >
          {loadingTags ? (
            <Text style={styles.tagsHint}>Loading tags…</Text>
          ) : tagDefinitions.length === 0 ? (
            <Text style={styles.tagsHint}>No tags defined for this project.</Text>
          ) : (
            <View style={styles.tagWrap}>
              {tagDefinitions.map(tag => {
                const selected = selectedTagIds.includes(tag.id);
                const accent = tag.color ?? colors.primary;
                return (
                  <Pressable
                    key={tag.id}
                    disabled={submitting}
                    onPress={() => toggleTag(tag.id)}
                    style={({ pressed }) => [
                      styles.tagChip,
                      selected && { borderColor: accent, backgroundColor: `${accent}22` },
                      pressed && { opacity: 0.8 }
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.tagDot, { backgroundColor: accent }]} />
                    <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>
                      {tag.label}
                    </Text>
                    {selected ? <Ionicons name="checkmark" size={13} color={accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Documents"
          icon="document-text-outline"
          colors={colors}
          styles={styles}
        >
          <DocumentAttachmentsSection
            documents={pendingDocuments}
            onPickFile={(file: PickedFile) => addDocument(file)}
            onRemove={removeDocument}
          />
        </CollapsibleSection>
      </View>
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    objectiveInput: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      color: colors.foreground,
      fontSize: 17,
      lineHeight: 24,
      minHeight: 120
    },
    collapsibleStack: {
      gap: 1,
      borderRadius: 14,
      overflow: 'hidden'
    },
    collapsibleSection: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    },
    collapsibleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10
    },
    collapsibleHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    collapsibleTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '600'
    },
    collapsibleBadge: {
      minWidth: 18,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center'
    },
    collapsibleBadgeText: {
      color: colors.primaryForeground,
      fontSize: 11,
      fontWeight: '700'
    },
    collapsibleBody: {
      paddingHorizontal: 14,
      paddingBottom: 14
    },
    sectionInput: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 80
    },
    tagsHint: {
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 20
    },
    tagWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6
    },
    tagChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.secondary
    },
    tagDot: {
      width: 8,
      height: 8,
      borderRadius: 999
    },
    tagChipText: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontWeight: '600'
    },
    tagChipTextSelected: {
      color: colors.foreground
    }
  });
