import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import { FilterChip } from './FilterChip';
import {
  ALL_PROJECTS_LABEL,
  formatStatusName,
  formatTagFilterLabel,
  sortLabels,
  type SortMode,
  type StatusFilter,
  type TagFilterOption,
  type ViewMode
} from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';
import { ViewModeMenuButton } from './ViewModeMenuButton';

type TicketsScreenFiltersProps = {
  projectName: string;
  projectColor: string;
  viewMode: ViewMode;
  viewMenuOpen: boolean;
  showViewMenu: boolean;
  projectMenuOpen: boolean;
  sortMenuOpen: boolean;
  statusMenuOpen: boolean;
  tagMenuOpen: boolean;
  sortMode: SortMode;
  statusFilter: StatusFilter;
  statusFilterLabel: string;
  statusFilterOptions: string[];
  selectedTagIds: string[];
  tagOptions: TagFilterOption[];
  projects: { id: string; name: string; color: string }[];
  filterProjectId: string | null;
  allStatusesSelected: boolean;
  onToggleProjectMenu: () => void;
  onToggleSortMenu: () => void;
  onToggleStatusMenu: () => void;
  onToggleTagMenu: () => void;
  onToggleViewMenu: () => void;
  onSelectView: (mode: ViewMode) => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectSort: (mode: SortMode) => void;
  onSelectStatus: (status: string) => void;
  onSelectAllStatuses: () => void;
  onSelectTag: (tagId: string) => void;
  onSelectAllTags: () => void;
};

export function TicketsScreenFilters({
  projectName,
  projectColor,
  viewMode,
  viewMenuOpen,
  showViewMenu,
  projectMenuOpen,
  sortMenuOpen,
  statusMenuOpen,
  tagMenuOpen,
  sortMode,
  statusFilter,
  statusFilterLabel,
  statusFilterOptions,
  selectedTagIds,
  tagOptions,
  projects,
  filterProjectId,
  allStatusesSelected,
  onToggleProjectMenu,
  onToggleSortMenu,
  onToggleStatusMenu,
  onToggleTagMenu,
  onToggleViewMenu,
  onSelectView,
  onSelectProject,
  onSelectSort,
  onSelectStatus,
  onSelectAllStatuses,
  onSelectTag,
  onSelectAllTags
}: TicketsScreenFiltersProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <>
      <View style={styles.projectHeader}>
        <View style={[styles.projectSquare, { backgroundColor: projectColor }]} />
        <Text style={styles.projectHeaderName} numberOfLines={1}>
          {projectName}
        </Text>
        <Pressable
          hitSlop={8}
          style={styles.projectFilterButton}
          onPress={onToggleProjectMenu}
          accessibilityLabel="Filter by project"
        >
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {projectMenuOpen && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={() => onSelectProject(null)}>
            <Text style={styles.menuItemText}>{ALL_PROJECTS_LABEL}</Text>
            {filterProjectId === null && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
          {projects.map(project => (
            <Pressable
              key={project.id}
              style={styles.menuItem}
              onPress={() => onSelectProject(project.id)}
            >
              <View style={styles.projectMenuLabel}>
                <View style={[styles.projectMenuDot, { backgroundColor: project.color }]} />
                <Text style={styles.menuItemText}>{project.name}</Text>
              </View>
              {filterProjectId === project.id && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.filterRow}>
        <View style={styles.filterChips}>
          <FilterChip
            icon="swap-vertical-outline"
            label={sortLabels[sortMode]}
            onPress={onToggleSortMenu}
            active={sortMenuOpen}
          />
          <FilterChip
            icon="funnel-outline"
            label={statusFilterLabel}
            onPress={onToggleStatusMenu}
            active={statusMenuOpen}
          />
          <FilterChip
            icon="pricetag-outline"
            label={formatTagFilterLabel(selectedTagIds, tagOptions)}
            onPress={onToggleTagMenu}
            active={tagMenuOpen}
          />
        </View>
        {showViewMenu && (
          <View style={styles.viewMenuWrap}>
            <ViewModeMenuButton
              value={viewMode}
              open={viewMenuOpen}
              onPress={onToggleViewMenu}
              onSelect={onSelectView}
            />
          </View>
        )}
      </View>

      {sortMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(sortLabels) as SortMode[]).map(mode => (
            <Pressable key={mode} style={styles.menuItem} onPress={() => onSelectSort(mode)}>
              <Text style={styles.menuItemText}>{sortLabels[mode]}</Text>
              {sortMode === mode && <Ionicons name="checkmark" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      {statusMenuOpen && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={onSelectAllStatuses}>
            <Text style={styles.menuItemText}>All statuses</Text>
            {allStatusesSelected && <Ionicons name="checkmark" size={14} color={colors.primary} />}
          </Pressable>
          {statusFilterOptions.map(status => {
            const selected = allStatusesSelected || statusFilter.includes(status);
            return (
              <Pressable
                key={status}
                style={styles.menuItem}
                onPress={() => onSelectStatus(status)}
              >
                <Text style={styles.menuItemText}>{formatStatusName(status)}</Text>
                {selected && <Ionicons name="checkmark" size={14} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {tagMenuOpen && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={onSelectAllTags}>
            <Text style={styles.menuItemText}>All tags</Text>
            {selectedTagIds.length === 0 && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
          {tagOptions.map(tag => {
            const selected = selectedTagIds.includes(tag.id);
            return (
              <Pressable key={tag.id} style={styles.menuItem} onPress={() => onSelectTag(tag.id)}>
                <View style={styles.projectMenuLabel}>
                  {tag.color ? (
                    <View style={[styles.projectMenuDot, { backgroundColor: tag.color }]} />
                  ) : null}
                  <Text style={styles.menuItemText}>{tag.label}</Text>
                </View>
                {selected && <Ionicons name="checkmark" size={14} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
}
