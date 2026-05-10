# Implementation Plan: Update to Datetime-Based Versioning

## Overview
Transition from sequential versioning (`[major].[minor].x`) to timestamp-based versioning (`[major].[UTCdatetime].x`) where:
- `major`: Starts at 0, incremented for major breaking changes
- `datetime`: Format `yymmddhhmm` (10 digits representing year, month, day, hour, minute) SHOULD BE UTC
- `x`: Defaults to 0, reserved for special indicators or hotfixes on same-minute builds

**Example versions:**
- `0.2605101430.0` → v0 built May 10, 2026 at 2:30 PM
- `0.2605101430.1` → hotfix on same timestamp

## Files to Modify

### 1. **lib/helpers/cli-versioning.mjs** (Version Parsing & Derivation)
**Location:** `/Users/jake/Development/Cooperativ/Overlord/lib/helpers/cli-versioning.mjs`

**Current:**
```javascript
export function parseVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map(part => Number.parseInt(part, 10));
  if ([major, minor, patch].some(Number.isNaN)) return null;
  return { major, minor, patch };
}
```

**Changes needed:**
- Replace `parseVersion()` to handle new format
- Validate major is 0+ and datetime is exactly 10 digits, x is 0+
- Create `generateDatetimeComponent()` to produce `yymmddhhmm` from current time
- Update `deriveCliVersion()` to ensure CLI version matches app version exactly (no major.minor extraction)

**Pseudocode:**
```javascript
export function parseNewVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) return null;
  const [major, datetime, x] = parts;
  const majorNum = Number.parseInt(major, 10);
  const datetimeStr = datetime;
  const xNum = Number.parseInt(x, 10);
  
  if (Number.isNaN(majorNum) || Number.isNaN(xNum)) return null;
  if (!/^\d{10}$/.test(datetimeStr)) return null;
  
  return { major: majorNum, datetime: datetimeStr, x: xNum };
}

export function generateDatetimeComponent(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}${hh}${min}`;
}

export function deriveCliVersion(appVersion, cliVersion) {
  const app = parseNewVersion(appVersion);
  if (!app) return cliVersion;
  // CLI version must match app version exactly
  return appVersion;
}
```

### 2. **scripts/upload-electron-release.mjs** (Version Bumping)
**Location:** `/Users/jake/Development/Cooperativ/Overlord/scripts/upload-electron-release.mjs`

**Current:**
```javascript
const VERSION_BUMP = {
  patch: (v) => {
    const [major, minor, patch] = v.split('.').map(Number);
    return `${major}.${minor}.${(patch || 0) + 1}`;
  },
  minor: (v) => {
    const [major, minor] = v.split('.').map(Number);
    return `${major}.${(minor || 0) + 1}.0`;
  },
  major: (v) => {
    const [major] = v.split('.').map(Number);
    return `${(major || 0) + 1}.0.0`;
  }
};
```

**Changes needed:**
- `--no-bump`: Keep current version unchanged
- `--patch`: Increment `x` component (hotfix on same datetime)
- `--minor`: Don't use for this scheme (remove or deprecate)
- `--major`: Increment `major`, reset datetime to current time, reset `x` to 0
- Default (no flag): Use current datetime, reset `x` to 0

**Pseudocode:**
```javascript
const VERSION_BUMP = {
  patch: (v) => {
    const parsed = parseNewVersion(v);
    if (!parsed) throw new Error(`Invalid version: ${v}`);
    // Hotfix: same datetime, increment x
    return `${parsed.major}.${parsed.datetime}.${parsed.x + 1}`;
  },
  major: (v) => {
    const parsed = parseNewVersion(v);
    if (!parsed) throw new Error(`Invalid version: ${v}`);
    // Major bump: increment major, reset datetime and x
    const newDatetime = generateDatetimeComponent();
    return `${parsed.major + 1}.${newDatetime}.0`;
  }
};

function bumpVersion(version, mode = 'default') {
  if (mode === 'no-bump') return version;
  if (mode === 'patch') return VERSION_BUMP.patch(version);
  if (mode === 'major') return VERSION_BUMP.major(version);
  
  // default: Use new datetime, keep major, reset x
  const parsed = parseNewVersion(version);
  if (!parsed) throw new Error(`Invalid version: ${version}`);
  const newDatetime = generateDatetimeComponent();
  return `${parsed.major}.${newDatetime}.0`;
}
```

### 3. **scripts/sync-cli-package.mjs** (CLI Sync Logic)
**Location:** `/Users/jake/Development/Cooperativ/Overlord/scripts/sync-cli-package.mjs`

**Changes needed:**
- Update to use new version parsing
- Simplify: CLI version must exactly match app version (no partial matching)

**Current logic to replace:**
```javascript
const nextVersion = deriveCliVersion(appPkg.version, cliPkg.version);
```

**New logic:**
```javascript
const nextVersion = appPkg.version; // Always sync exactly
```

### 4. **package.json Files**
**Locations:**
- `/Users/jake/Development/Cooperativ/Overlord/package.json`
- `/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/package.json`

**Changes:**
- Set version to first new-format version: `0.2605101430.0` (May 10, 2026, 14:30)
- Or keep current at `5.19.0` and bump to new format on next release

**Decision needed:** Migration strategy
- Option A: Change root versions immediately to `0.2605101430.0`
- Option B: Keep current versions and change on next scheduled release
- **Recommendation: Option B** — safer, allows for testing

### 5. **Documentation Updates (Optional)**
**Consider adding:**
- Comment in version bumping script explaining new scheme
- Update build/release docs
- Document the datetime component format and timezone handling

## Implementation Steps

### Phase 1: Core Version Utilities (lib/helpers/cli-versioning.mjs)
1. ✅ Add `generateDatetimeComponent(date)` function
2. ✅ Add `parseNewVersion(version)` function with validation
3. ✅ Add backward compatibility check (detect old format, warn/error)
4. ✅ Update `deriveCliVersion()` to use exact match
5. ✅ Update/deprecate `parseVersion()` (keep for backward compat reference)

### Phase 2: Update Upload Script (scripts/upload-electron-release.mjs)
1. ✅ Import new version functions
2. ✅ Replace VERSION_BUMP object
3. ✅ Update `parseBumpMode()` to handle new flags or keep existing flags with new behavior
4. ✅ Update version bumping logic in `main()`
5. ✅ Update `syncCliPackageVersion()` call to sync exactly

### Phase 3: Update CLI Sync Script (scripts/sync-cli-package.mjs)
1. ✅ Import new version functions
2. ✅ Simplify `syncCliVersion()` to always use app version

### Phase 4: Update Package Versions
1. ✅ Decide on initial version (0.2605101430.0 vs. keep current)
2. ✅ Update root `package.json`
3. ✅ Update CLI `package.json`

### Phase 5: Testing & Validation
1. ✅ Test version parsing with various inputs
2. ✅ Test datetime generation (verify format, timezone handling)
3. ✅ Test version bumping (major, patch, no-bump, default)
4. ✅ Test CLI sync logic
5. ✅ Run existing build/upload scripts with test flags
6. ✅ Verify version appears correctly in app and CLI

## Risk Mitigation

**Backward Compatibility:**
- Maintain old `parseVersion()` function for reference
- Add clear comments on when old format was used
- Test with version validation to catch malformed versions early

**Timezone Handling:**
- Use local time or UTC? (Recommend: **UTC** for consistency)
- Document clearly in generateDatetimeComponent()

**Version Sorting:**
- New format sorts correctly as strings (yymmddhhmm is sortable)
- semver comparison will fail — may need custom comparator for release management
- Check `scripts/upload-electron-release.mjs` line 356 where `semver.valid()` is used
- **Action:** Replace semver validation with custom validation using new parser

**Migration Path:**
- Current version is 5.19.0 (incompatible)
- First new version will be 0.x (major reset!)
- This is a breaking change semantically
- Consider communication plan for end users

## Questions for Clarification

1. **Timezone:** Should datetime be in UTC or local time? (Recommend: UTC) : UTC IS CORRECT
2. **Initial Major Version:** Start at 0 for all, or preserve some meaning? : START AT 0 FOR ALL
3. **Release Timing:** Apply immediately or on next scheduled release? : APPLY IMMEDIATELY
4. **Version Display:** How should this appear to users (in app About dialog, CLI --version)? : DISPLAY AS written in the format

## Success Criteria

- ✅ All version formats parse correctly with new parser
- ✅ Datetime component generates correct yymmddhhmm format
- ✅ Version bumping works for all modes (major, patch, no-bump, default)
- ✅ CLI package version always syncs to match app version exactly
- ✅ Release scripts work with new version format
- ✅ Version sorting/retention logic works (update semver usage)
- ✅ Tests pass for version parsing and generation
- ✅ No breakage in existing build/upload workflows
