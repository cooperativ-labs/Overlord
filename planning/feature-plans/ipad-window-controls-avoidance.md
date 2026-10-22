# iPad window controls (traffic lights) avoidance — OverlordMobile

Mission: coo:1170 / objective coo:1170.t286
Status: investigation + recommendation (no code changed)

## Problem

In iPadOS 26 windowed mode (Windowed Apps / Stage Manager), the system draws the
window controls (close / minimize / tile "traffic lights") in the top-leading
corner of every app window. In the mission detail screen they sit directly on top
of our custom back button (screenshot 2026-10-22: the `chevron.left` glass circle
to the left of the "Implement Document Requests Sidebar" pill is covered).

### Root cause in OverlordMobile

- `MissionDetailScreen.swift:262` hides the system navigation bar when pushed
  (`.toolbar(presentation == .stack ? .hidden : .automatic, for: .navigationBar)`)
  and draws `MissionDetailHeaderBar` in a `ZStack(alignment: .top)` instead.
- `MissionDetailHeaderView.swift` lays out `[back button][pill]` in an `HStack`
  with only `.padding(.horizontal, 8)`. Nothing tells it about the controls.
- The system only moves content out of the way of the window controls for
  **system bars** (`NavigationStack` / `NavigationSplitView` toolbars,
  `UINavigationBar`). The top **safe area does not** include the controls'
  horizontal footprint, so custom chrome laid out from the leading edge gets
  covered.
- The same pattern (hidden nav bar + custom top chrome) exists in
  `HomeScreen.swift:119`, `MissionsScreen.swift:211` (search bar's leading
  magnifying glass / field) and `QueueScreen.swift:75`. These are lower risk
  (text and search fields rather than a primary button) but can still be clipped.

## Apple's guidance (best practices)

1. **Prefer system navigation chrome.** `NavigationStack` / `NavigationSplitView`
   toolbars (and `UINavigationController` in UIKit) automatically shift leading
   items to clear the window controls, and they stay correct across full screen,
   windowed, and Slide Over. This is the approach WWDC25 session 208 ("Elevate the
   design of your iPad app") recommends first.
2. **For custom chrome, adapt to the container's corner insets — don't hard-code
   padding.** The controls' size and presence depend on window state (absent in
   full screen, present in windowed mode, and their position differs by style),
   so a fixed `padding(.leading, 80)` is wrong in both directions.
   - SwiftUI (iOS 26+): `.containerCornerOffset(.leading, sizeToFit: true)` on the
     leading-anchored element/row. It offsets the view away from corner insets —
     which include system UI such as window controls — and, with `sizeToFit`,
     shrinks it to fit the remaining width. Apply it to the row that should
     shrink, not to a full-width container whose trailing items would be pushed
     off screen.
   - SwiftUI geometry: `GeometryProxy.containerCornerInsets` exposes the same
     insets for custom layout math.
   - UIKit: `view.layoutGuide(for: .margins(cornerAdaptation: .horizontal))` for
     Auto Layout, or `edgeInsets(for:)` / `directionalEdgeInsets(for:)` for frame
     layout (`UIView.LayoutRegion`).
3. **Choose horizontal vs vertical adaptation deliberately.** Horizontal
   adaptation keeps the header row at the top and slides the leading item
   right (best for a bar like ours). Vertical adaptation pushes content down
   below the controls (better for a leading sidebar or a tall top-leading
   palette).
4. **Control style is an opt-in, not a fix.** `UIWindowSceneDelegate.preferredWindowingControlStyle(for:)`
   can request `.minimal` (legacy-like, smaller footprint) vs `.unified`. It needs
   a scene-delegate lifecycle in a SwiftUI app and still doesn't guarantee a
   clear top-leading corner, so it isn't a substitute for (1)/(2).
5. **Never rely on `UIDesignRequiresCompatibility`** to dodge this. It only
   applies to apps not built against the iOS 26 SDK and is being phased out.
6. **Test matrix:** full screen, Windowed Apps at several widths, Stage Manager,
   Slide Over, split with another app, both orientations, and the transition from
   windowed to full screen (the inset must go back to zero).

## Recommendation for OverlordMobile

Smallest correct fix (keeps the custom glass header):

```swift
// MissionDetailHeaderBar.body — on the HStack that holds [back][pill]
HStack(spacing: 8) { ... }
    .padding(.horizontal, 8)
    .avoidingWindowControls()      // new shared modifier
    .frame(height: 52)
```

```swift
extension View {
    /// Shifts leading content clear of the iPadOS window controls (traffic
    /// lights) and shrinks the row to fit; a no-op before iOS 26 and in full screen.
    @ViewBuilder
    func avoidingWindowControls() -> some View {
        if #available(iOS 26.0, *) {
            containerCornerOffset(.leading, sizeToFit: true)
        } else {
            self
        }
    }
}
```

- Deployment target is iOS 18.6, so the `#available` gate is required.
- `sizeToFit: true` keeps the trailing `ellipsis` in the pill on screen. The pill
  already has `maxWidth: .infinity`, so it just gets narrower.
- `MorphingGlassMenu` expands from the header pill. Check that its anchor follows
  the offset frame. If it doesn't, apply the same modifier to the expanded panel.
- Apply the same shared modifier to the top rows of Home (greeting block), Missions
  (search bar) and Queue so every custom top bar behaves the same way.

Alternative (larger change, most future-proof): move the pushed mission detail
back onto the system navigation bar. The back button goes in
`ToolbarItem(placement: .navigation)` and the pill in `.principal`. That way the
system handles window controls, Liquid Glass bar styling and future iPadOS
chrome changes. It costs us the custom morphing-menu header anchor, so treat it
as a follow-up design decision.

## Verification steps

1. Run on an iPad (or iPad simulator, iPadOS 26) with Multitasking set to
   "Windowed Apps".
2. Open a mission from Missions so the detail is pushed (`presentation == .stack`).
3. Confirm the back chevron sits to the right of the traffic lights and the pill's
   `ellipsis` stays visible. Resize the window narrow and wide.
4. Go to full screen and confirm the header goes back to its original 8pt leading padding.
5. Repeat on iPhone. It should be unchanged, because there are no corner insets.

## Sources

- Apple: `containerCornerOffset(_:sizeToFit:)` — https://developer.apple.com/documentation/swiftui/view/containercorneroffset(_:sizetofit:)
- Apple: `GeometryProxy` (`containerCornerInsets`) — https://developer.apple.com/documentation/swiftui/geometryproxy
- WWDC25 208, Elevate the design of your iPad app — https://developer.apple.com/videos/play/wwdc2025/208/
- Developer Forums — https://developer.apple.com/forums/thread/789303 , https://developer.apple.com/forums/thread/792611 , https://developer.apple.com/forums/thread/787227
- Adopting the New Window Controls in iPadOS 26 — https://juniperphoton.substack.com/p/adopting-the-new-window-controls
