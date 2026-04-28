---
name: expo-native-tabs
description: Guide for using Expo Router native tabs with platform-native system tab bars. Apply when implementing or modifying native tab layouts, tab items, or platform-specific tab bar behavior.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# Expo Native Tabs

Guide for using `expo-router/unstable-native-tabs` with Expo Router.

## Overview

- **Package**: `expo-router/unstable-native-tabs`
- **Purpose**: render platform-native system tabs instead of JavaScript tabs
- **Status**: available in Expo SDK 55+ and still subject to API changes
- **Platforms**: Android, iOS, tvOS, Web
- **Use when**: the app wants system tab bars, native tab behaviors, SF Symbols on iOS, or Material-style tab items on Android

## Installation

Install Expo Router if it is not already configured:

```bash
npx expo install expo-router
```

If the project was not created from the default Expo Router template, ensure the config plugin is enabled:

```json
{
 "expo": {
  "plugins": ["expo-router"]
 }
}
```

## Core Rules

1. Use `_layout.tsx` to define the native tabs container.
2. Add every tab explicitly with `NativeTabs.Trigger`.
3. Match each `Trigger` `name` to a route file in the same directory, such as `index.tsx` or `settings.tsx`.
4. Keep tab content in route files and tab bar configuration in the layout file.
5. Prefer the SDK 55+ nested API:
   `NativeTabs.Trigger.Icon`, `NativeTabs.Trigger.Label`, `NativeTabs.Trigger.Badge`.

## Basic Layout

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gear" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

### Route Structure

```text
app/
  _layout.tsx
  index.tsx
  settings.tsx
```

`index.tsx` is the default selected tab when the app first loads.

## Trigger Configuration

Each tab is declared with `NativeTabs.Trigger name="routeName"`.

- `name` must point at an existing route file
- tabs are **not** auto-added the way Stack routes are discovered
- use children to define icon, label, and badge

Example:

```tsx
<NativeTabs.Trigger name="inbox">
  <NativeTabs.Trigger.Icon sf="tray" md="inbox" />
  <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
  <NativeTabs.Trigger.Badge>3</NativeTabs.Trigger.Badge>
</NativeTabs.Trigger>
```

## Icons

Use `NativeTabs.Trigger.Icon` for per-tab icons.

- `sf`: SF Symbols name for iOS
- `md`: Android Material icon name
- `src`: custom image source
- `drawable`: Android drawable resource
- `renderingMode`: iOS custom image rendering, usually `template` or `original`

### Recommended Pattern

```tsx
<NativeTabs.Trigger.Icon
  sf={{ default: 'house', selected: 'house.fill' }}
  md="home"
/>
```

Use `{ default, selected }` for iOS selected-state icon changes. Android does not support the same selected asset swap behavior for `sf`/`src`.

### Custom Image Icons

```tsx
<NativeTabs.Trigger.Icon
  src={require('../assets/colorful-icon.png')}
  renderingMode="original"
/>
```

Use `renderingMode="original"` only when you need the asset's original colors preserved.

## Labels

Use `NativeTabs.Trigger.Label` for the visible tab text:

```tsx
<NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
```

For global styling, use `labelStyle` on `NativeTabs`.

## Badges

Use `NativeTabs.Trigger.Badge` for unread counts or status markers:

```tsx
<NativeTabs.Trigger.Badge>12</NativeTabs.Trigger.Badge>
```

For shared badge colors across tabs, use `badgeBackgroundColor` and `badgeTextColor` on `NativeTabs`.

## NativeTabs Props That Matter Most

Use these first before reaching for custom wrappers:

- `tintColor`: selected icon tint
- `labelStyle`: label styling
- `backgroundColor`: tab bar background
- `hidden`: hide the entire tab bar
- `badgeBackgroundColor`: badge background color
- `badgeTextColor`: badge text color
- `iconColor`: default/selected icon colors
- `blurEffect`: iOS tab bar blur/material style
- `disableTransparentOnScrollEdge`: prevents iOS scroll-edge transparency
- `minimizeBehavior`: iOS 26+ minimize behavior
- `sidebarAdaptable`: iOS 18+ sidebar-adaptable style on iPadOS/macOS
- `backBehavior`: Android back behavior for tab history
- `screenListeners`: cross-tab `tabPress`, `focus`, and `blur` listeners

## Liquid Glass / Dynamic iOS Coloring

On iOS, native tabs can adapt visually to background brightness. When you need explicit colors, prefer `DynamicColorIOS` or `PlatformColor` instead of hard-coded colors:

```tsx
import { DynamicColorIOS } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs
      labelStyle={{
        color: DynamicColorIOS({
          light: 'black',
          dark: 'white',
        }),
      }}
      tintColor={DynamicColorIOS({
        light: 'black',
        dark: 'white',
      })}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

## Platform-Specific Notes

### iOS

- Prefer `sf` icons for the cleanest native result.
- `blurEffect`, `shadowColor`, `disableTransparentOnScrollEdge`, `minimizeBehavior`, and `sidebarAdaptable` are iOS-specific.
- `minimizeBehavior` requires iOS 26+.
- `sidebarAdaptable` applies on iPadOS/macOS and has no effect on iPhone.

### Android

- Prefer `md` or `drawable` icons.
- `backBehavior`, `labelVisibilityMode`, `indicatorColor`, `rippleColor`, and `disableIndicator` are especially relevant.

## Common Patterns

### Hidden Tab Bar

```tsx
<NativeTabs hidden>
  <NativeTabs.Trigger name="index" />
</NativeTabs>
```

### Tab Event Listeners

```tsx
<NativeTabs
  screenListeners={{
    tabPress: () => {
      console.log('A tab was pressed');
    },
  }}
>
  <NativeTabs.Trigger name="index" />
</NativeTabs>
```

### iOS Minimize Behavior

```tsx
<NativeTabs minimizeBehavior="onScrollDown">
  <NativeTabs.Trigger name="index" />
</NativeTabs>
```

## Common Mistakes To Avoid

- Do not assume tabs are auto-generated from files. Each tab needs a `NativeTabs.Trigger`.
- Do not put tab bar config inside individual route files unless the option truly belongs to the screen content.
- Do not use custom image icons with template tinting if the asset needs multiple original colors.
- Do not hard-code only iOS icon props for Android builds; provide `md` or `drawable` when Android support matters.
- Do not over-customize if the design goal is "native". Start with system defaults and override only what you need.
- Do not rely on this API being fully stable across SDK upgrades; verify against the current Expo docs when updating Expo.

## When To Use Another Tabs Approach

Use JavaScript tabs instead when:

- you need a highly custom tab bar layout
- you already rely on React Navigation tab APIs not exposed here
- you need behavior not supported by the system tab bar

Use custom tabs instead when:

- the design intentionally does not look native
- you need bespoke animations, floating bars, or unusual interaction patterns

## References

- https://docs.expo.dev/versions/latest/sdk/router/native-tabs/
- https://docs.expo.dev/router/advanced/native-tabs/
