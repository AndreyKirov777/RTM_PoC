import simpleGit, { type SimpleGit } from 'simple-git';
import { TRACKED_DIRS, type DiffResult, type FileEntry } from '../types.js';

export class DiffDetector {
  // Allows injection of a mock git instance in tests
  private gitFactory: (path: string) => SimpleGit;

  constructor(gitFactory?: (path: string) => SimpleGit) {
    this.gitFactory = gitFactory ?? ((path: string) => simpleGit(path));
  }

  /**
   * Returns files changed in the given commit range, filtered to tracked dirs.
   */
  async getChangedFiles(repoPath: string, commitRange: string): Promise<DiffResult> {
    const git = this.gitFactory(repoPath);
    const raw = await git.raw(['diff', '--name-status', commitRange]);

    const toUpsert: FileEntry[] = [];
    const toDelete: FileEntry[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const tabIdx = trimmed.indexOf('\t');
      if (tabIdx === -1) continue;

      const statusChar = trimmed.slice(0, tabIdx).trim();
      const filePath = trimmed.slice(tabIdx + 1).trim();

      if (!filePath.endsWith('.md')) continue;
      if (!this.isInTrackedDir(filePath)) continue;

      if (statusChar === 'A' || statusChar === 'M') {
        toUpsert.push({ filePath, status: statusChar as 'A' | 'M' });
      } else if (statusChar === 'D') {
        toDelete.push({ filePath, status: 'D' });
      }
    }

    return { toUpsert, toDelete };
  }

  /**
   * Returns all markdown files in tracked directories (full sync mode).
   */
  async getAllArtifactFiles(repoPath: string): Promise<FileEntry[]> {
    const git = this.gitFactory(repoPath);
    const raw = await git.raw(['ls-files', '--', '*.md']);

    const files: FileEntry[] = [];
    for (const line of raw.split('\n')) {
      const filePath = line.trim();
      if (!filePath) continue;
      if (!filePath.endsWith('.md')) continue;
      if (!this.isInTrackedDir(filePath)) continue;
      files.push({ filePath, status: 'full' });
    }

    return files;
  }

  private isInTrackedDir(filePath: string): boolean {
    return TRACKED_DIRS.some(dir => filePath.startsWith(dir + '/'));
  }
}
