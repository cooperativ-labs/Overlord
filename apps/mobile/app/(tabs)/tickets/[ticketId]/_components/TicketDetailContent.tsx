import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';

import type { PickedFile } from '@/components/DocumentAttachmentsSection';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type {
  AgentModelSelection,
  Objective,
  Server,
  TicketDetail,
  TicketEvent
} from '@/lib/types';

import {
  formatStatusName,
  getStatusColors,
  type TicketStatusDefinition
} from '../../components/shared';

import {
  eventLabels,
  getEventIcons,
  getObjectiveStateColors,
  type ObjectiveAttachmentItem,
  type Project,
  statusPillColor
} from './ticket-detail-shared';
import { createStyles } from './ticket-detail-styles';

export function TicketDetailContent({
  ticket,
  ticketId,
  titleDraft,
  editingTitle,
  dueLabel,
  currentProject,
  projects,
  selectedProjectId,
  showProjectPicker,
  statusDefinitions,
  showStatusPicker,
  savingProject,
  onToggleProjectPicker,
  onToggleStatusPicker,
  onChangeProject,
  onChangeStatus,
  objectiveDraft,
  setObjectiveDraft,
  executedObjectives,
  expandedObjectiveIds,
  toggleObjectiveExpanded,
  canSaveObjective,
  objectiveActionLabel,
  savingObjective,
  onSaveObjective,
  promptForServerLaunch,
  isSSHSupported,
  loadingServers,
  launchingServerId,
  resolvedAssignedSelection,
  allServers,
  availableServers,
  objectiveAttachments,
  uploadingAttachment,
  onAttachToObjective,
  onOpenAttachment,
  draftObjectiveId,
  hasEverhourApiKey,
  showAcceptanceCriteria,
  onToggleAcceptanceCriteria,
  acceptanceCriteriaDraft,
  setAcceptanceCriteriaDraft,
  canSaveAcceptanceCriteria,
  savingAcceptanceCriteria,
  onSaveAcceptanceCriteria,
  showCliQuickstart,
  onToggleCliQuickstart,
  onCopyCliCommand,
  filteredEvents,
  eventProfiles,
  activityFilter,
  onToggleActivityFilter,
  onBeginTitleEdit,
  onTitleChange,
  onTitleSubmit,
  onTitleBlur,
  onBackgroundPress
}: {
  ticket: TicketDetail;
  ticketId: string;
  titleDraft: string;
  editingTitle: boolean;
  dueLabel: string | null;
  currentProject: Project | null;
  projects: Project[];
  selectedProjectId: string | null;
  showProjectPicker: boolean;
  statusDefinitions: TicketStatusDefinition[];
  showStatusPicker: boolean;
  savingProject: boolean;
  onToggleProjectPicker: () => void;
  onToggleStatusPicker: () => void;
  onChangeProject: (nextProjectId: string) => Promise<void>;
  onChangeStatus: (nextStatus: string) => Promise<void>;
  objectiveDraft: string;
  setObjectiveDraft: (value: string) => void;
  executedObjectives: Objective[];
  expandedObjectiveIds: string[];
  toggleObjectiveExpanded: (objectiveId: string) => void;
  canSaveObjective: boolean;
  objectiveActionLabel: string;
  savingObjective: boolean;
  onSaveObjective: () => void;
  promptForServerLaunch: () => void;
  isSSHSupported: boolean;
  loadingServers: boolean;
  launchingServerId: string | null;
  resolvedAssignedSelection: AgentModelSelection | null;
  allServers: Server[];
  availableServers: Server[];
  objectiveAttachments: ObjectiveAttachmentItem[];
  uploadingAttachment: boolean;
  onAttachToObjective: (file: PickedFile) => void | Promise<void>;
  onOpenAttachment: (attachment: ObjectiveAttachmentItem) => void;
  draftObjectiveId: string | null;
  hasEverhourApiKey: boolean;
  showAcceptanceCriteria: boolean;
  onToggleAcceptanceCriteria: () => void;
  acceptanceCriteriaDraft: string;
  setAcceptanceCriteriaDraft: (value: string) => void;
  canSaveAcceptanceCriteria: boolean;
  savingAcceptanceCriteria: boolean;
  onSaveAcceptanceCriteria: () => void;
  showCliQuickstart: boolean;
  onToggleCliQuickstart: () => void;
  onCopyCliCommand: () => void;
  filteredEvents: TicketEvent[];
  eventProfiles: Record<string, { name: string; image_url: string }>;
  activityFilter: 'all' | 'completed';
  onToggleActivityFilter: () => void;
  onBeginTitleEdit: () => void;
  onTitleChange: (value: string) => void;
  onTitleSubmit: () => void;
  onTitleBlur: () => void;
  onBackgroundPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const objectiveStateColors = getObjectiveStateColors(colors);
  const eventIcons = getEventIcons(colors);
  const statusColors = getStatusColors(colors);
  const currentStatusDefinition =
    statusDefinitions.find(
      status => status.name.trim().toLowerCase() === ticket.status.trim().toLowerCase()
    ) ?? null;
  return (
    <>
      <Pressable style={styles.scroll} onPress={onBackgroundPress} accessible={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {hasEverhourApiKey && (
            <View style={styles.tracker}>
              <View style={styles.trackerTextWrap}>
                <View style={styles.trackerHeaderRow}>
                  <Text style={styles.trackerLabel}>TIME TRACKING</Text>
                  <Ionicons
                    name="information-circle-outline"
                    size={13}
                    color={colors.mutedForeground}
                  />
                </View>
                <Text style={styles.trackerSub}>Track time on this ticket.</Text>
              </View>
              <Pressable
                hitSlop={8}
                style={styles.trackerButton}
                onPress={() => Alert.alert('Time tracking', 'Time tracking starts soon.')}
              >
                <Ionicons name="play" size={12} color={colors.foreground} />
                <Text style={styles.trackerButtonText}>Start</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.titleBlock}>
            <Text style={styles.sequence}>#{ticket.ticket_sequence}</Text>
            {editingTitle ? (
              <TextInput
                value={titleDraft}
                onChangeText={onTitleChange}
                onBlur={onTitleBlur}
                onSubmitEditing={onTitleSubmit}
                style={styles.titleInput}
                underlineColorAndroid="transparent"
                cursorColor={colors.foreground}
                selectionColor={colors.primary}
                returnKeyType="done"
                blurOnSubmit
                autoCorrect={false}
                autoCapitalize="sentences"
                autoFocus
                accessibilityLabel="Edit ticket title"
              />
            ) : (
              <Pressable
                hitSlop={8}
                onPress={onBeginTitleEdit}
                accessibilityRole="button"
                accessibilityLabel="Edit ticket title"
                style={styles.titlePressable}
              >
                <Text style={styles.titleText}>{ticket.title || 'Untitled'}</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.pillRow}>
            <Pressable
              style={({ pressed }) => [styles.selectPill, pressed && styles.pressed]}
              onPress={onToggleProjectPicker}
              disabled={savingProject}
            >
              {currentProject && (
                <View
                  style={[
                    styles.pillDot,
                    { backgroundColor: currentProject.color || colors.primary }
                  ]}
                />
              )}
              <Text style={styles.selectPillText} numberOfLines={1}>
                {currentProject?.name ?? 'No project'}
              </Text>
              {savingProject ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.selectPill, pressed && styles.pressed]}
              onPress={onToggleStatusPicker}
            >
              <View
                style={[
                  styles.pillDot,
                  {
                    backgroundColor: currentStatusDefinition
                      ? statusColors[currentStatusDefinition.status_type]
                      : statusPillColor(ticket.status, colors)
                  }
                ]}
              />
              <Text style={styles.selectPillText}>{formatStatusName(ticket.status)}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.scheduleRow}>
            <Pressable
              style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
              onPress={() =>
                Alert.alert(
                  'Due date',
                  dueLabel ? `Due ${dueLabel}` : 'Due date picker coming soon.'
                )
              }
            >
              <Ionicons name="calendar-outline" size={13} color={colors.foreground} />
              <Text style={styles.scheduleText}>
                {dueLabel ? `Due ${dueLabel}` : 'Set due date'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
              onPress={() => Alert.alert('Schedule', 'Scheduling coming soon.')}
            >
              <Ionicons name="time-outline" size={13} color={colors.foreground} />
              <Text style={styles.scheduleText}>Add schedule</Text>
            </Pressable>
          </View>

          {executedObjectives.length > 0 && (
            <View style={styles.objectivesBlock}>
              {executedObjectives.map(obj => {
                const expanded = expandedObjectiveIds.includes(obj.id);
                return (
                  <View key={obj.id} style={styles.objectiveRow}>
                    <Pressable
                      onPress={() => toggleObjectiveExpanded(obj.id)}
                      style={({ pressed }) => [
                        styles.objectiveRowHeader,
                        pressed && styles.pressed
                      ]}
                    >
                      <View style={styles.objectiveStatusIcon}>
                        <Ionicons
                          name={obj.state === 'complete' ? 'checkmark-circle' : 'radio-button-on'}
                          size={16}
                          color={objectiveStateColors[obj.state] ?? colors.mutedForeground}
                        />
                      </View>
                      <Text
                        style={styles.objectiveTitleText}
                        numberOfLines={expanded ? undefined : 1}
                      >
                        {obj.title ?? obj.objective}
                      </Text>
                      <Pressable hitSlop={6} onPress={() => toggleObjectiveExpanded(obj.id)}>
                        <Ionicons
                          name="ellipsis-horizontal"
                          size={16}
                          color={colors.mutedForeground}
                        />
                      </Pressable>
                    </Pressable>
                    {expanded && obj.title && obj.objective && (
                      <Text style={styles.objectiveBody}>{obj.objective}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.draftBlock}>
            <TextInput
              style={styles.draftInput}
              value={objectiveDraft}
              onChangeText={setObjectiveDraft}
              placeholder="Click to add an objective..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            <DraftObjectiveAttachments
              attachments={objectiveAttachments.filter(
                attachment => attachment.objectiveId === draftObjectiveId
              )}
              uploading={uploadingAttachment}
              canAttach={draftObjectiveId !== null || objectiveDraft.trim().length > 0}
              onAttach={onAttachToObjective}
              onOpen={onOpenAttachment}
              actionLabel={canSaveObjective ? objectiveActionLabel : null}
              onSave={onSaveObjective}
              savingObjective={savingObjective}
            />
          </View>

          <View style={styles.runSection}>
            <Pressable
              onPress={promptForServerLaunch}
              disabled={
                loadingServers ||
                launchingServerId !== null ||
                !isSSHSupported ||
                !resolvedAssignedSelection
              }
              style={({ pressed }) => [
                styles.launchServerButton,
                (loadingServers ||
                  launchingServerId !== null ||
                  !isSSHSupported ||
                  !resolvedAssignedSelection) &&
                  styles.launchServerButtonDisabled,
                pressed && styles.pressed
              ]}
            >
              {loadingServers || launchingServerId !== null ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Ionicons name="terminal-outline" size={14} color={colors.primaryForeground} />
              )}
              <Text style={styles.launchServerButtonText}>
                {launchingServerId !== null
                  ? 'Starting Remote Session…'
                  : loadingServers
                    ? 'Loading Servers…'
                    : 'Run on Server'}
              </Text>
            </Pressable>
            {!isSSHSupported && (
              <Text style={styles.runHint}>
                Remote SSH launch is currently available on iOS only.
              </Text>
            )}
            {isSSHSupported && availableServers.length === 0 && (
              <Text style={styles.runHint}>
                {allServers.length > 0
                  ? 'No connected SSH servers on this device.'
                  : 'Add a server from the Servers tab to launch remotely.'}
              </Text>
            )}
          </View>

          <CollapsibleSection
            label="ACCEPTANCE CRITERIA"
            open={showAcceptanceCriteria}
            onToggle={onToggleAcceptanceCriteria}
          >
            <TextInput
              style={styles.criteriaInput}
              value={acceptanceCriteriaDraft}
              onChangeText={setAcceptanceCriteriaDraft}
              placeholder="Define completion criteria for this ticket..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            {canSaveAcceptanceCriteria && (
              <Pressable
                style={({ pressed }) => [
                  styles.saveCriteriaButton,
                  savingAcceptanceCriteria && styles.documentActionButtonDisabled,
                  pressed && styles.pressed
                ]}
                onPress={() => onSaveAcceptanceCriteria()}
                disabled={savingAcceptanceCriteria}
              >
                {savingAcceptanceCriteria ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={styles.saveCriteriaButtonText}>Save acceptance criteria</Text>
                )}
              </Pressable>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            label="CLI QUICKSTART"
            open={showCliQuickstart}
            onToggle={onToggleCliQuickstart}
          >
            <Pressable
              style={({ pressed }) => [styles.cliCopy, pressed && styles.pressed]}
              onPress={onCopyCliCommand}
            >
              <Text style={styles.cliText} selectable>
                ovld protocol attach --ticket-id {ticketId}
              </Text>
              <Ionicons name="copy-outline" size={14} color={colors.mutedForeground} />
            </Pressable>
            <Text style={styles.cliHint}>
              Paste in a terminal already authenticated with Overlord to attach this session.
            </Text>
          </CollapsibleSection>

          <View style={styles.activityHeader}>
            <Text style={styles.sectionLabel}>ACTIVITY</Text>
            <Pressable
              style={({ pressed }) => [styles.activityFilter, pressed && styles.pressed]}
              onPress={onToggleActivityFilter}
            >
              <Text style={styles.activityFilterText}>
                {activityFilter === 'completed' ? 'Completed' : 'All'}
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {filteredEvents.length === 0 ? (
            <Text style={styles.noActivity}>No activity yet</Text>
          ) : (
            filteredEvents.map(event => {
              const isFollowUp = event.event_type === 'user_follow_up';
              const profile =
                isFollowUp && event.created_by ? eventProfiles[event.created_by] : null;
              const icon = eventIcons[event.event_type] ?? {
                name: 'ellipse',
                color: colors.primary
              };
              const label = eventLabels[event.event_type] ?? event.event_type.replace(/_/g, ' ');
              return (
                <View
                  key={event.id}
                  style={[styles.eventRow, event.is_blocking && styles.eventBlocking]}
                >
                  {isFollowUp ? (
                    <View style={styles.eventAvatarBadge}>
                      {profile?.image_url ? (
                        <Image
                          source={{ uri: profile.image_url }}
                          style={styles.eventAvatarImage}
                        />
                      ) : (
                        <Text style={styles.eventAvatarInitials}>
                          {(profile?.name ?? 'U').slice(0, 2).toUpperCase()}
                        </Text>
                      )}
                    </View>
                  ) : (
                    <View style={styles.eventIconBadge}>
                      <Ionicons
                        name={icon.name as keyof typeof Ionicons.glyphMap}
                        size={12}
                        color={icon.color}
                      />
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.eventHeader}>
                      <Text
                        style={[
                          styles.eventType,
                          isFollowUp && { color: '#f59e0b', fontWeight: '600' }
                        ]}
                      >
                        {isFollowUp && profile?.name ? profile.name : label}
                      </Text>
                      {event.phase && <Text style={styles.eventPhase}>{event.phase}</Text>}
                      <Text style={styles.eventTime}>
                        {new Date(event.created_at).toLocaleString(undefined, {
                          month: 'numeric',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </Text>
                    </View>
                    {event.summary && (
                      <Text style={styles.eventSummary} numberOfLines={4}>
                        {event.summary}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </Pressable>

      <SelectorModal visible={showProjectPicker} onClose={onToggleProjectPicker} title="Project">
        {projects.length === 0 ? (
          <Text style={styles.selectorEmpty}>No projects available.</Text>
        ) : (
          projects.map(project => {
            const isSelected = project.id === selectedProjectId;
            return (
              <Pressable
                key={project.id}
                style={({ pressed }) => [
                  styles.selectorItem,
                  isSelected && styles.selectorItemSelected,
                  pressed && styles.pressed
                ]}
                onPress={() => void onChangeProject(project.id)}
              >
                <View style={styles.selectorItemLeft}>
                  <View style={[styles.selectorDot, { backgroundColor: project.color }]} />
                  <Text
                    style={[styles.selectorItemText, isSelected && styles.selectorItemTextSelected]}
                  >
                    {project.name}
                  </Text>
                </View>
                {isSelected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
            );
          })
        )}
      </SelectorModal>

      <SelectorModal visible={showStatusPicker} onClose={onToggleStatusPicker} title="Status">
        {statusDefinitions.length === 0 ? (
          <Text style={styles.selectorEmpty}>No ticket statuses available.</Text>
        ) : (
          statusDefinitions.map(status => {
            const isSelected =
              status.name.trim().toLowerCase() === ticket.status.trim().toLowerCase();
            const statusColor = statusColors[status.status_type] ?? colors.mutedForeground;
            return (
              <Pressable
                key={`${status.organization_id}:${status.name}`}
                style={({ pressed }) => [
                  styles.selectorItem,
                  isSelected && styles.selectorItemSelected,
                  pressed && styles.pressed
                ]}
                onPress={() => void onChangeStatus(status.name)}
              >
                <View style={styles.selectorItemLeft}>
                  <View style={[styles.selectorDot, { backgroundColor: statusColor }]} />
                  <Text
                    style={[styles.selectorItemText, isSelected && styles.selectorItemTextSelected]}
                  >
                    {formatStatusName(status.name)}
                  </Text>
                </View>
                {isSelected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
            );
          })
        )}
      </SelectorModal>
    </>
  );
}

function DraftObjectiveAttachments({
  attachments,
  uploading,
  canAttach,
  onAttach,
  onOpen,
  actionLabel,
  onSave,
  savingObjective
}: {
  attachments: ObjectiveAttachmentItem[];
  uploading: boolean;
  canAttach: boolean;
  onAttach: (file: PickedFile) => void | Promise<void>;
  onOpen: (attachment: ObjectiveAttachmentItem) => void;
  actionLabel: string | null;
  onSave: () => void;
  savingObjective: boolean;
}) {
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
    await onAttach({
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
    await onAttach({
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
    await onAttach({
      uri: asset.uri,
      fileName: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileSize: asset.size ?? 0
    });
  }

  function showAttachOptions() {
    if (!canAttach) {
      Alert.alert('Objective required', 'Enter an objective before attaching files.');
      return;
    }
    Alert.alert('Attach to objective', undefined, [
      { text: 'Take photo', onPress: () => void handleTakePhoto() },
      { text: 'Choose from library', onPress: () => void handleSelectImage() },
      { text: 'Choose file', onPress: () => void handleSelectFile() },
      { text: 'Cancel', style: 'cancel' as const }
    ]);
  }

  return (
    <View style={styles.draftAttachmentsBlock}>
      {attachments.length > 0 && (
        <View style={styles.draftAttachmentsList}>
          {attachments.map(attachment => (
            <Pressable
              key={attachment.id}
              onPress={() => onOpen(attachment)}
              style={({ pressed }) => [styles.draftAttachmentRow, pressed && styles.pressed]}
            >
              <Ionicons
                name={
                  attachment.contentType.startsWith('image/') ? 'image-outline' : 'document-outline'
                }
                size={14}
                color={colors.mutedForeground}
              />
              <Text style={styles.draftAttachmentLabel} numberOfLines={1}>
                {attachment.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.draftActionsRow}>
        <Pressable
          onPress={showAttachOptions}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Attach file to objective"
          style={({ pressed }) => [
            styles.attachIconButton,
            uploading && styles.attachIconButtonDisabled,
            pressed && styles.pressed
          ]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Ionicons name="document-attach-outline" size={18} color={colors.foreground} />
          )}
        </Pressable>
        {actionLabel && (
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.saveObjective, pressed && styles.pressed]}
          >
            {savingObjective ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={styles.saveObjectiveText}>{actionLabel}</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CollapsibleSection({
  label,
  open,
  onToggle,
  children
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.collapsible}>
      <Pressable
        style={({ pressed }) => [styles.collapsibleHeader, pressed && styles.pressed]}
        onPress={onToggle}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}

function SelectorModal({
  visible,
  onClose,
  title,
  children
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.selectorBackdrop} onPress={onClose}>
        <Pressable style={styles.selectorCard} onPress={() => undefined}>
          <View style={styles.selectorHeader}>
            <Text style={styles.selectorTitle}>{title}</Text>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title.toLowerCase()}`}
              onPress={onClose}
              style={({ pressed }) => [styles.selectorCloseButton, pressed && styles.pressed]}
            >
              <Text style={styles.selectorCloseButtonText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.selectorScrollContent}
            style={styles.selectorScroll}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
