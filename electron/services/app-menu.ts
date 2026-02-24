import { app, Menu, MenuItemConstructorOptions } from 'electron';

import { AppUpdaterService, AppUpdateStatus } from './app-updater';

type RegisterAppMenuOptions = {
  appUpdater: AppUpdaterService;
  isDev: boolean;
};

type UpdateAction = 'check' | 'download' | 'install' | 'none';

export function registerAppMenu({ appUpdater, isDev }: RegisterAppMenuOptions): () => void {
  let signature = '';

  return appUpdater.onStatusChange(status => {
    const nextSignature = getMenuSignature(status);
    if (nextSignature === signature) return;
    signature = nextSignature;

    const updateItem = createUpdateMenuItem(status, appUpdater);
    const template = createMenuTemplate({ updateItem, isDev });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });
}

function createUpdateMenuItem(
  status: AppUpdateStatus,
  appUpdater: AppUpdaterService
): MenuItemConstructorOptions {
  const label = getUpdateLabel(status);
  const action = getUpdateAction(status);

  return {
    label,
    enabled: action !== 'none',
    click: () => {
      const current = appUpdater.getStatus();
      const currentAction = getUpdateAction(current);
      if (currentAction === 'download') {
        void appUpdater.downloadUpdate();
        return;
      }
      if (currentAction === 'install') {
        appUpdater.quitAndInstall();
        return;
      }
      if (currentAction === 'check') {
        void appUpdater.checkForUpdates();
      }
    }
  };
}

function createMenuTemplate(options: {
  updateItem: MenuItemConstructorOptions;
  isDev: boolean;
}): MenuItemConstructorOptions[] {
  const { updateItem, isDev } = options;
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        updateItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  } else {
    template.push({
      label: 'File',
      submenu: [updateItem, { type: 'separator' }, { role: 'quit' }]
    });
  }

  template.push({
    label: 'Edit',
    submenu: createEditSubmenu()
  });

  template.push({
    label: 'View',
    submenu: createViewSubmenu(isDev)
  });

  template.push({
    label: 'Window',
    submenu: createWindowSubmenu()
  });

  return template;
}

function getUpdateLabel(status: AppUpdateStatus): string {
  if (status.phase === 'available') {
    const version = status.availableVersion ?? 'latest';
    return `Update to Version ${version}`;
  }
  if (status.phase === 'downloaded') {
    const version = status.availableVersion ?? 'latest';
    return `Restart to Install Version ${version}`;
  }
  if (status.phase === 'checking') return 'Checking for Updates...';
  if (status.phase === 'downloading') return 'downloading...';
  if (status.phase === 'unsupported') return 'Check for Updates (Unavailable)';
  return 'Check for Updates';
}

function getUpdateAction(status: AppUpdateStatus): UpdateAction {
  if (status.phase === 'available') return 'download';
  if (status.phase === 'downloaded') return 'install';
  if (
    status.phase === 'checking' ||
    status.phase === 'downloading' ||
    status.phase === 'unsupported'
  ) {
    return 'none';
  }
  return 'check';
}

function getMenuSignature(status: AppUpdateStatus): string {
  return `${status.phase}:${status.availableVersion ?? ''}`;
}

function createEditSubmenu(): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' }
  ];

  if (process.platform === 'darwin') {
    submenu.push({ role: 'pasteAndMatchStyle' });
  }

  submenu.push({ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' });

  return submenu;
}

function createViewSubmenu(isDev: boolean): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [{ role: 'reload' }, { role: 'forceReload' }];

  if (isDev) {
    submenu.push({ role: 'toggleDevTools' });
  }

  submenu.push(
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  );

  return submenu;
}

function createWindowSubmenu(): MenuItemConstructorOptions[] {
  const submenu: MenuItemConstructorOptions[] = [{ role: 'minimize' }, { role: 'zoom' }];

  if (process.platform === 'darwin') {
    submenu.push({ role: 'front' });
  }

  submenu.push({ role: 'close' });

  return submenu;
}
