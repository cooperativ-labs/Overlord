import { execFile } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export class SupabaseManager {
  private running = false;
  private projectDir: string;

  constructor() {
    const cwd = process.cwd();
    const cwdHasSupabaseConfig = fs.existsSync(path.join(cwd, 'supabase', 'config.toml'));

    if (cwdHasSupabaseConfig) {
      // Preferred for local packaged runs: user launches the app from the repository root.
      this.projectDir = cwd;
      return;
    }

    if (!app.isPackaged) {
      // Dev Electron process runs from `<repo>/apps/desktop/dist-electron/services`.
      this.projectDir = path.resolve(__dirname, '..', '..');
      return;
    }

    // Packaged app fallback: use a real directory outside app.asar to avoid ENOTDIR.
    this.projectDir = app.getPath('userData');
  }

  async start(): Promise<void> {
    // Check if Docker is running first
    await this.checkDocker();

    return new Promise((resolve, reject) => {
      execFile(
        'supabase',
        ['start'],
        { cwd: this.projectDir, timeout: 180_000 },
        (err, stdout, stderr) => {
          if (err) {
            console.error('Supabase start error:', stderr);
            return reject(new Error(`Failed to start Supabase: ${stderr || err.message}`));
          }
          if (stdout?.trim()) {
            console.warn('Supabase started:', stdout);
          }
          this.running = true;
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      execFile('supabase', ['stop'], { cwd: this.projectDir, timeout: 30_000 }, err => {
        if (err) {
          console.error('Supabase stop error:', err);
        }
        this.running = false;
        resolve();
      });
    });
  }

  async getStatus(): Promise<{ running: boolean; url: string }> {
    return {
      running: this.running,
      url: 'http://127.0.0.1:54321'
    };
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private checkDocker(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('docker', ['info'], { timeout: 10_000 }, err => {
        if (err) {
          reject(new Error('Docker is not running. Please start Docker Desktop and try again.'));
        } else {
          resolve();
        }
      });
    });
  }
}
