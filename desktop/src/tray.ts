import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

let tray: Tray | null = null;

export interface TrayActions {
  showWindow: () => void;
  quit: () => void;
}

// The glyph is a template image: macOS tints it white on a dark menu bar and
// black on a light one. The @2x variant is picked up automatically by name.
export function installTray({ showWindow, quit }: TrayActions): void {
  if (process.platform !== 'darwin' || tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  if (icon.isEmpty()) return;
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Overlord');
  tray.on('click', showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Overlord', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Overlord', click: quit }
    ])
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
